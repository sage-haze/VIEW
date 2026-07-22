const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_SIMPLE_MODEL = "gpt-5.4-mini";
const MAX_QUESTION_LENGTH = 1500;
const MAX_CONTEXT_LENGTH = 1000;

const VIEW_SCHEMA = {
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
        required: [
          "label",
          "response",
          "view",
          "influences",
          "effects",
          "whatMatters"
        ]
      }
    }
  },
  required: ["answers"]
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

export async function onRequestPost(context) {
  try {
    if (!context.env.OPENAI_API_KEY) {
      return jsonResponse({ error: "OPENAI_API_KEY is not configured." }, 500);
    }

    const body = await context.request.json();
    const question = cleanText(body.question, MAX_QUESTION_LENGTH);
    const clientContext = cleanText(body.clientContext, MAX_CONTEXT_LENGTH);
    const useMarketContext = Boolean(body.useMarketContext);

    if (!question) {
      return jsonResponse({ error: "Please enter a client question." }, 400);
    }

    const simpleModel =
      context.env.OPENAI_SIMPLE_MODEL || DEFAULT_SIMPLE_MODEL;
    const analysisModel =
      context.env.OPENAI_ANALYSIS_MODEL || "gpt-5.6-terra";

    let consensus = null;

    if (useMarketContext) {
      consensus = await getConsensusBrief({
        apiKey: context.env.OPENAI_API_KEY,
        model: analysisModel,
        question,
        clientContext
      });
    }

    const result = await generateViewAnswers({
      apiKey: context.env.OPENAI_API_KEY,
      model: simpleModel,
      question,
      clientContext,
      consensus
    });

    return jsonResponse({
      answers: result.answers,
      consensus,
      modelUsed: simpleModel
    });
  } catch (error) {
    console.error("VIEW endpoint error:", error);

    const status = Number.isInteger(error.status) ? error.status : 500;
    return jsonResponse(
      {
        error:
          status === 404
            ? "The configured OpenAI model was not found. Check OPENAI_SIMPLE_MODEL and OPENAI_ANALYSIS_MODEL in Cloudflare."
            : error.message || "Unable to generate VIEW responses."
      },
      status
    );
  }
}

async function getConsensusBrief({ apiKey, model, question, clientContext }) {
  const prompt = `
Research the current, broadly supported market or economic baseline relevant to
the client's question below.

CLIENT QUESTION:
${question}

CLIENT CONTEXT:
${clientContext || "Not provided."}

Requirements:
- Search the web.
- Prefer primary or authoritative sources such as central banks, official
  statistical agencies, exchanges, multilateral institutions, and clearly
  identified institutional research.
- Distinguish observed facts from market expectations.
- Do not claim there is a consensus when credible views differ.
- State the date or horizon attached to any expectation.
- Keep the brief under 180 words.
- End with a one-sentence caution about uncertainty.
`;

  const response = await callOpenAI({
    apiKey,
    payload: {
      model,
      reasoning: { effort: "medium" },
      tools: [{ type: "web_search" }],
      include: ["web_search_call.action.sources"],
      input: [
        {
          role: "system",
          content:
            "You create careful, source-based market context for a banking conversation coach."
        },
        { role: "user", content: prompt }
      ],
      max_output_tokens: 700
    }
  });

  const summary = extractOutputText(response);
  const sources = extractSources(response);

  return {
    summary,
    sources,
    caution:
      "This is a time-sensitive synthesis, not investment advice or a guaranteed forecast."
  };
}

async function generateViewAnswers({
  apiKey,
  model,
  question,
  clientContext,
  consensus
}) {
  const consensusText = consensus?.summary
    ? `CURRENT SOURCE-BASED CONTEXT:\n${consensus.summary}`
    : `CURRENT SOURCE-BASED CONTEXT:\nNot supplied. Do not invent current facts.
Use careful conditional language and make clear that the baseline should be verified.`;

  const prompt = `
CLIENT QUESTION:
${question}

CLIENT CONTEXT:
${clientContext || "Not provided."}

${consensusText}

Create exactly three distinct answers that a banker could say aloud.

All three answers must strongly follow VIEW:
V — Give a concise baseline view in appropriately cautious language.
I — Identify one or two factors that could change the view.
E — Explain practical business, financial, or decision implications.
W — End by connecting to what matters to this client, normally through one
    relevant and natural question.

Make the three versions meaningfully different:
1. "Concise and direct" — around 70–100 words.
2. "Balanced and consultative" — around 110–150 words.
3. "Cautious when uncertainty is high" — around 90–130 words.

Rules:
- Do not present forecasts as facts.
- Do not fabricate data, consensus, or sources.
- Do not give personalised investment advice.
- Do not jump immediately to a product.
- Do not use the literal letters V, I, E, W inside the spoken response.
- Make each spoken response natural, professional, and usable.
`;

  const response = await callOpenAI({
    apiKey,
    payload: {
      model,
      input: [
        {
          role: "system",
          content: `You are VIEW Coach.

VIEW means:
- View: give a clear baseline position.
- Influences: identify what could change it.
- Effects: explain practical implications.
- What matters: connect the discussion to the client's priorities.

Your goal is not to predict perfectly. Your goal is to help a user communicate
a balanced, transparent, client-relevant view.`
        },
        { role: "user", content: prompt }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "view_examples",
          strict: true,
          schema: VIEW_SCHEMA
        }
      },
      max_output_tokens: 1800
    }
  });

  const text = extractOutputText(response);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("OpenAI returned output that could not be parsed.");
  }
}

async function callOpenAI({ apiKey, payload }) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

function extractOutputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const parts = [];

  for (const item of response.output || []) {
    if (item.type !== "message") continue;

    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }

  if (!parts.length) {
    throw new Error("OpenAI returned no text output.");
  }

  return parts.join("\n").trim();
}

function extractSources(response) {
  const sourceMap = new Map();

  for (const item of response.output || []) {
    if (item.type === "web_search_call") {
      for (const source of item.action?.sources || []) {
        if (source.url) {
          sourceMap.set(source.url, {
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
            sourceMap.set(annotation.url, {
              title: annotation.title || annotation.url,
              url: annotation.url
            });
          }
        }
      }
    }
  }

  return [...sourceMap.values()].slice(0, 8);
}

function cleanText(value, maximumLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maximumLength);
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function corsHeaders() {
  return {
    // For production, replace * with your exact GitHub Pages origin if the
    // front end and Function are on different domains.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
