const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_ANSWER_MODEL = "gpt-5-mini";
const DEFAULT_ANALYSIS_MODEL = "gpt-5";

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answers: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          response: { type: "string" },
          view: { type: "string" },
          influences: { type: "string" },
          effects: { type: "string" },
          whatMatters: { type: "string" }
        },
        required: ["label", "response", "view", "influences", "effects", "whatMatters"]
      }
    }
  },
  required: ["answers"]
};

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.OPENAI_API_KEY) {
      return json({
        error:
          "OPENAI_API_KEY is not available to this Cloudflare Pages Function. " +
          "Add it under the Pages project's runtime Variables and Secrets, then redeploy."
      }, 500);
    }

    const body = await request.json();
    const question = clean(body.question, 1500);
    const clientContext = clean(body.clientContext, 1000);
    const useMarketContext = Boolean(body.useMarketContext);

    if (!question) {
      return json({ error: "Please enter a client question." }, 400);
    }

    const answerModel = env.OPENAI_ANSWER_MODEL || DEFAULT_ANSWER_MODEL;
    const analysisModel = env.OPENAI_ANALYSIS_MODEL || DEFAULT_ANALYSIS_MODEL;

    let marketContext = null;

    if (useMarketContext) {
      marketContext = await createMarketContext({
        env,
        model: analysisModel,
        question,
        clientContext
      });
    }

    const answerData = await createViewAnswers({
      env,
      model: answerModel,
      question,
      clientContext,
      marketContext
    });

    return json({
      answers: answerData.answers,
      marketContext,
      models: {
        answer: answerModel,
        analysis: useMarketContext ? analysisModel : null
      }
    });
  } catch (error) {
    console.error("VIEW API error", error);

    return json(
      {
        error: error.publicMessage || error.message || "Unable to generate responses."
      },
      error.status || 500
    );
  }
}

async function createMarketContext({ env, model, question, clientContext }) {
  const response = await openAI(env, {
    model,
    reasoning: { effort: "medium" },
    tools: [{ type: "web_search" }],
    include: ["web_search_call.action.sources"],
    input: [
      {
        role: "system",
        content:
          "Create a careful, source-based market context brief for a client-conversation coach."
      },
      {
        role: "user",
        content: `Research the current baseline relevant to this client question:

QUESTION:
${question}

CLIENT CONTEXT:
${clientContext || "Not provided."}

Requirements:
- Prefer primary and authoritative sources.
- Separate observed facts from forecasts or expectations.
- Do not call something consensus unless the evidence supports that label.
- State relevant dates and forecast horizons.
- Note credible disagreement.
- Keep the synthesis below 180 words.
- Do not give personalised investment advice.`
      }
    ],
    max_output_tokens: 700,
    store: false
  });

  return {
    summary: outputText(response),
    sources: extractSources(response),
    caution:
      "This is a time-sensitive synthesis, not a guaranteed forecast or personalised advice."
  };
}

async function createViewAnswers({
  env,
  model,
  question,
  clientContext,
  marketContext
}) {
  const suppliedContext = marketContext?.summary
    ? marketContext.summary
    : "No live market context was requested. Do not invent current facts or consensus.";

  const response = await openAI(env, {
    model,
    input: [
      {
        role: "system",
        content: `You are VIEW Coach.

VIEW means:
V — Give a clear but appropriately cautious baseline view.
I — Identify the main influences that could change the view.
E — Explain possible practical effects or implications.
W — Connect the discussion to what matters to the client.

Help users communicate with judgement. Do not pretend to predict with certainty.`
      },
      {
        role: "user",
        content: `CLIENT QUESTION:
${question}

CLIENT CONTEXT:
${clientContext || "Not provided."}

SOURCE-BASED CONTEXT:
${suppliedContext}

Create exactly three distinct answers a banker could say aloud:

1. Concise and direct — approximately 70–100 words.
2. Balanced and consultative — approximately 110–150 words.
3. Cautious under uncertainty — approximately 90–130 words.

Each answer must:
- state a baseline view;
- name one or two factors that could change it;
- explain practical implications;
- end by connecting to the client's priorities;
- avoid unsupported certainty and fabricated figures;
- avoid jumping immediately to a product;
- sound natural rather than announcing the VIEW letters.`
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "view_answers",
        strict: true,
        schema: OUTPUT_SCHEMA
      }
    },
    max_output_tokens: 1800,
    store: false
  });

  try {
    return JSON.parse(outputText(response));
  } catch {
    throw new Error("The model returned an invalid structured response.");
  }
}

async function openAI(env, payload) {
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data?.error?.message || `OpenAI request failed with status ${response.status}.`
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

function outputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const parts = [];
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }

  if (!parts.length) throw new Error("OpenAI returned no text.");
  return parts.join("\n").trim();
}

function extractSources(response) {
  const unique = new Map();

  for (const item of response.output || []) {
    if (item.type === "web_search_call") {
      for (const source of item.action?.sources || []) {
        if (source.url) {
          unique.set(source.url, {
            title: source.title || source.url,
            url: source.url
          });
        }
      }
    }

    if (item.type === "message") {
      for (const content of item.content || []) {
        for (const annotation of content.annotations || []) {
          if (annotation.type === "url_citation" && annotation.url) {
            unique.set(annotation.url, {
              title: annotation.title || annotation.url,
              url: annotation.url
            });
          }
        }
      }
    }
  }

  return [...unique.values()].slice(0, 8);
}

function clean(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
