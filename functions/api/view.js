const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_ANSWER_MODEL = "gpt-5.6-terra";
const DEFAULT_ANALYSIS_MODEL = "gpt-5.4-mini";

const ANSWER_LABELS = [
  "Concise and direct",
  "Balanced and consultative",
  "Cautious under uncertainty"
];

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
          responseBody: { type: "string" },
          view: { type: "string" },
          influences: { type: "string" },
          effects: { type: "string" },
          clientQuestion: { type: "string" }
        },
        required: [
          "responseBody",
          "view",
          "influences",
          "effects",
          "clientQuestion"
        ]
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
    const marketRegion = clean(body.marketRegion, 120);
    const useMarketContext = Boolean(body.useMarketContext);

    if (!question) {
      return json({ error: "Please enter a client question." }, 400);
    }

    const answerModel = clean(env.OPENAI_ANSWER_MODEL, 120) || DEFAULT_ANSWER_MODEL;
    const analysisModel = clean(env.OPENAI_ANALYSIS_MODEL, 120) || DEFAULT_ANALYSIS_MODEL;

    let marketContext = null;

    if (useMarketContext) {
      marketContext = await createMarketContext({
        env,
        model: analysisModel,
        question,
        clientContext,
        marketRegion
      });
    }

    const answerData = await createViewAnswers({
      env,
      model: answerModel,
      question,
      clientContext,
      marketRegion,
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
        error: error.publicMessage || error.message || "Unable to generate responses.",
        diagnostics: error.diagnostics || null
      },
      error.status || 500
    );
  }
}

async function createMarketContext({
  env,
  model,
  question,
  clientContext,
  marketRegion
}) {
  const today = new Date().toISOString().slice(0, 10);
  const response = await openAI(env, {
    model,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search" }],
    include: ["web_search_call.action.sources"],
    input: [
      {
        role: "system",
        content:
          "Create a brief, careful and source-based context note for a client-conversation coach. " +
          "Use plain language and current authoritative sources."
      },
      {
        role: "user",
        content: `CURRENT DATE:
${today}

CLIENT QUESTION:
${question}

MARKET OR REGION:
${marketRegion || "Not provided."}

CLIENT CONTEXT:
${clientContext || "Not provided."}

Research the current baseline relevant to the question.

Important rules:
- Do not silently assume a country, currency, central bank or market.
- If the relevant market is missing, either keep the brief genuinely general or state one explicit assumption.
- Prefer recent primary and authoritative sources.
- Use older sources only when they are necessary to explain a current rule or historical comparison.
- Separate observed facts from forecasts or expectations.
- Do not call something consensus unless the evidence supports that label.
- State the relevant date or forecast horizon.
- Note the one or two developments most likely to change the baseline.
- Do not give personalised investment advice.
- Do not include markdown, URLs, citations, footnotes, source names or an offer to do more.

Return plain text in exactly this format:
Assumption: [one short sentence, or None]
Baseline: [no more than 55 words]
Observed: [no more than 65 words]
Watch: [no more than 45 words]`
      }
    ],
    max_output_tokens: 2200,
    store: false
  });

  const parsed = parseMarketBrief(outputText(response));

  return {
    ...parsed,
    asOf: today,
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
  marketRegion,
  marketContext
}) {
  const suppliedContext = marketContext
    ? JSON.stringify({
        assumption: marketContext.assumption,
        baseline: marketContext.baseline,
        observed: marketContext.observed,
        watch: marketContext.watch,
        asOf: marketContext.asOf
      })
    : "No live market context was requested. Do not invent current facts, figures or consensus.";

  const response = await openAI(env, {
    model,
    reasoning: { effort: "none" },
    input: [
      {
        role: "system",
        content: `You are VIEW Coach.

VIEW means:
V — Give a clear but appropriately cautious baseline view.
I — Identify the main influences that could change the view.
E — Explain possible practical effects or implications.
W — connect the discussion to what matters to the client with one direct question.

Write for a banker speaking naturally to a client. Prefer short, clear sentences. Avoid academic wording, market-note language, jargon and product pitching. Never pretend to predict with certainty.`
      },
      {
        role: "user",
        content: `CLIENT QUESTION:
${question}

MARKET OR REGION:
${marketRegion || "Not provided."}

CLIENT CONTEXT:
${clientContext || "Not provided."}

SOURCE-BASED CONTEXT:
${suppliedContext}

Create exactly three distinct answers in this order:

1. Concise and direct
- Response body: 45–70 words.
- Lead with a direct answer.
- Use no more than one qualifying phrase.

2. Balanced and consultative
- Response body: 80–115 words.
- Explain the baseline and the main alternative scenario.
- Include one practical planning implication.

3. Cautious under uncertainty
- Response body: 70–105 words.
- Be explicit about what is uncertain and why exact timing cannot be known.
- Still give a usable baseline rather than avoiding the question.

Requirements for every answer:
- If the question uses an imprecise timeframe such as “soon”, briefly define a sensible horizon, for example “over the next few months”.
- Do not silently assume a country, currency or central bank. Use the supplied market/region or state the source brief's assumption in a few words.
- The responseBody must contain no questions and no question marks.
- The clientQuestion must be exactly one short, direct question ending in a question mark.
- Tailor the clientQuestion to the stated client context. If no context is supplied, ask what decision is behind the question.
- Do not repeat the same wording or sentence structure across the three answers.
- Do not mention VIEW or announce its letters in the responseBody.
- Do not include markdown, citations, URLs or unsupported figures.
- Avoid vague endings such as “it depends on your priorities”. Ask a concrete question instead.

The separate VIEW fields should be short summaries, not repetitions of the full response.`
      }
    ],
    text: {
      verbosity: "medium",
      format: {
        type: "json_schema",
        name: "view_answers",
        strict: true,
        schema: OUTPUT_SCHEMA
      }
    },
    max_output_tokens: 5200,
    store: false
  });

  const text = outputText(response);
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    const error = new Error("The model returned text, but it was not valid structured JSON.");
    error.diagnostics = {
      requestId: response._requestId || null,
      status: response.status || null,
      outputPreview: text.slice(0, 240)
    };
    throw error;
  }

  if (!Array.isArray(parsed.answers) || parsed.answers.length !== 3) {
    throw new Error("The model did not return exactly three VIEW answers.");
  }

  return {
    answers: parsed.answers.map((answer, index) =>
      normaliseAnswer(answer, index, clientContext)
    )
  };
}

function normaliseAnswer(answer, index, clientContext) {
  const body = cleanSpeech(answer.responseBody);
  const clientQuestion = normaliseClientQuestion(
    answer.clientQuestion,
    clientContext
  );

  return {
    label: ANSWER_LABELS[index],
    response: `${body} ${clientQuestion}`.trim(),
    view: cleanSpeech(answer.view),
    influences: cleanSpeech(answer.influences),
    effects: cleanSpeech(answer.effects),
    whatMatters: clientQuestion
  };
}

function cleanSpeech(value) {
  return clean(value, 1800)
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/\?/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseClientQuestion(value, clientContext) {
  const fallback = clientContext
    ? "Which part of that decision matters most: cost, timing, certainty, or flexibility?"
    : "What decision are you considering, and is the main concern cost, timing, or certainty?";

  let question = clean(value, 300)
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/^(W\s*[—–-]\s*)?(What matters|Client question)\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!question) return fallback;

  question = question.split("?")[0].replace(/[.!]+$/, "").trim();
  if (!question) return fallback;

  return `${question}?`;
}

function parseMarketBrief(text) {
  const cleaned = cleanMarketText(text);
  const fields = {
    assumption: "",
    baseline: "",
    observed: "",
    watch: ""
  };

  for (const line of cleaned.split(/\n+/)) {
    const match = line.match(/^\s*(Assumption|Baseline|Observed|Watch)\s*:\s*(.*)$/i);
    if (!match) continue;
    fields[match[1].toLowerCase()] = match[2].trim();
  }

  if (!fields.baseline) {
    const paragraphs = cleaned.split(/\n\s*\n/).filter(Boolean);
    fields.baseline = paragraphs[0] || cleaned;
    fields.observed = paragraphs[1] || "";
    fields.watch = paragraphs[2] || "";
  }

  if (/^none\.?$/i.test(fields.assumption)) fields.assumption = "";

  return fields;
}

function cleanMarketText(value) {
  return clean(value, 5000)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^If helpful,.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const requestId = response.headers.get("x-request-id");

  if (!response.ok) {
    const error = new Error(
      data?.error?.message || `OpenAI request failed with status ${response.status}.`
    );
    error.status = response.status;
    error.diagnostics = {
      requestId,
      status: response.status,
      type: data?.error?.type || null,
      code: data?.error?.code || null
    };
    throw error;
  }

  data._requestId = requestId;
  return data;
}

function outputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const parts = [];
  const refusals = [];

  for (const item of response.output || []) {
    if (item.type !== "message") continue;

    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }

      if (content.type === "refusal" && content.refusal) {
        refusals.push(content.refusal);
      }
    }
  }

  if (parts.length) return parts.join("\n").trim();

  const outputTypes = (response.output || []).map((item) => item.type);
  const incompleteReason = response.incomplete_details?.reason || null;
  const requestId = response._requestId || null;

  if (refusals.length) {
    const error = new Error(`OpenAI refused the request: ${refusals.join(" ")}`);
    error.diagnostics = { status: response.status, outputTypes, requestId };
    throw error;
  }

  const error = new Error(
    `OpenAI returned no text (status: ${response.status || "unknown"}; ` +
    `output types: ${outputTypes.join(", ") || "none"}).` +
    (requestId ? ` Request ID: ${requestId}.` : "")
  );
  error.diagnostics = {
    status: response.status || null,
    incompleteReason,
    outputTypes,
    requestId,
    usage: response.usage || null
  };
  throw error;
}

function extractSources(response) {
  const cited = new Map();
  const searched = new Map();

  for (const item of response.output || []) {
    if (item.type === "message") {
      for (const content of item.content || []) {
        for (const annotation of content.annotations || []) {
          if (annotation.type === "url_citation" && annotation.url) {
            addSource(cited, annotation.url, annotation.title);
          }
        }
      }
    }

    if (item.type === "web_search_call") {
      for (const source of item.action?.sources || []) {
        if (source.url) addSource(searched, source.url, source.title);
      }
    }
  }

  const preferred = cited.size ? [...cited.values()] : [...searched.values()];
  return preferred.slice(0, 5);
}

function addSource(map, rawUrl, rawTitle) {
  const url = normaliseUrl(rawUrl);
  if (!url || map.has(url)) return;

  map.set(url, {
    title: sourceTitle(rawTitle, url),
    url
  });
}

function normaliseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|ref$|source$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function sourceTitle(rawTitle, url) {
  const title = clean(rawTitle, 180);
  if (title && !/^https?:\/\//i.test(title)) return title;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const lastPart = parsed.pathname.split("/").filter(Boolean).pop() || "Source";
    const label = decodeURIComponent(lastPart)
      .replace(/[-_]+/g, " ")
      .replace(/\.(html?|pdf)$/i, "")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    return `${host} — ${label}`;
  } catch {
    return "Source";
  }
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
