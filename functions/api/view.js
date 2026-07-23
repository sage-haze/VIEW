const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_ANSWER_MODEL = "gpt-5.6-terra";
const DEFAULT_ANALYSIS_MODEL = "gpt-5.4-mini";

const PERSONAS = [
  {
    id: "relationship",
    label: "Relationship-led banker",
    guidance:
      "Give a simple, credible initial perspective using only the market detail needed to be useful. Bridge warmly to the client's situation and end with a broad, genuinely curious question about why the issue matters to them. Do not turn the question into an exposure checklist."
  },
  {
    id: "commercial",
    label: "Commercial planning partner",
    guidance:
      "Translate the outlook into one or two concrete planning considerations such as timing, costs, cash flow, liquidity, procurement or operational flexibility. End by exploring the decision or planning horizon affected. Avoid sounding like a formal strategy paper."
  },
  {
    id: "risk",
    label: "Risk-aware specialist",
    guidance:
      "State the base case, then identify the most important trigger that would make the outcome materially better or worse. Connect this to the client's decision date, resilience or tolerance for adverse movement. Use plain language and avoid listing every possible risk."
  }
];

const VIEW_ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answers: {
      type: "array",
      minItems: PERSONAS.length,
      maxItems: PERSONAS.length,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          personaId: { type: "string", enum: PERSONAS.map(({ id }) => id) },
          responseBody: { type: "string" },
          shorterLiveBody: { type: "string" },
          view: { type: "string" },
          influences: { type: "string" },
          effects: { type: "string" },
          clientQuestion: { type: "string" },
          assumptionsMade: { type: "string" },
          verificationNeeded: { type: "string" }
        },
        required: [
          "personaId",
          "responseBody",
          "shorterLiveBody",
          "view",
          "influences",
          "effects",
          "clientQuestion",
          "assumptionsMade",
          "verificationNeeded"
        ]
      }
    }
  },
  required: ["answers"]
};

const MARKET_CONTEXT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    assumption: { type: "string" },
    baseline: { type: "string" },
    observed: { type: "string" },
    watch: { type: "string" }
  },
  required: ["assumption", "baseline", "observed", "watch"]
};

export async function onRequestPost({ request, env }) {
  try {
    requireApiKey(env);

    const body = await request.json();
    const input = {
      question: clean(body.question, 1500),
      clientContext: clean(body.clientContext, 1000),
      marketRegion: clean(body.marketRegion, 120),
      useMarketContext: Boolean(body.useMarketContext)
    };

    if (!input.question) {
      return json({ error: "Please enter a client question." }, 400);
    }

    const answerModel = modelFromEnv(
      env.OPENAI_ANSWER_MODEL,
      DEFAULT_ANSWER_MODEL
    );
    const analysisModel = modelFromEnv(
      env.OPENAI_ANALYSIS_MODEL,
      DEFAULT_ANALYSIS_MODEL
    );

    const marketContext = input.useMarketContext
      ? await createMarketContext({ env, model: analysisModel, ...input })
      : null;

    const answers = await createViewAnswers({
      env,
      model: answerModel,
      marketContext,
      ...input
    });

    return json({
      answers,
      marketContext,
      models: {
        answer: answerModel,
        analysis: input.useMarketContext ? analysisModel : null
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
  const asOf = new Date().toISOString().slice(0, 10);

  const response = await openAI(env, {
    model,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search" }],
    include: ["web_search_call.action.sources"],
    input: [
      {
        role: "system",
        content: `Prepare a compact, source-based market context for a banker answering a client question.

Use current, authoritative sources. Separate observed facts from the baseline outlook. State an explicit assumption only when the market, currency or jurisdiction is unclear. Keep the language plain and avoid personalised advice.

Return clean prose only in the structured fields. Do not include citations, publisher names, domains, URLs, markdown links, footnotes or source markers in assumption, baseline, observed or watch. Sources are collected separately by the application.`
      },
      {
        role: "user",
        content: `${formatClientInput({
          question,
          marketRegion,
          clientContext
        })}

As of: ${asOf}

Return four short fields:
- assumption: one sentence or an empty string
- baseline: the likely direction and horizon, no more than 45 words
- observed: the two most relevant current facts, no more than 50 words
- watch: one or two developments that could change the view, no more than 40 words

Check the direction of causal claims and describe opposing forces separately.`
      }
    ],
    text: jsonFormat("market_context", MARKET_CONTEXT_SCHEMA),
    max_output_tokens: 1800,
    store: false
  });

  const parsed = parseJsonOutput(response, "market context");

  return {
    assumption: sanitiseMarketProse(parsed.assumption),
    baseline: sanitiseMarketProse(parsed.baseline),
    observed: sanitiseMarketProse(parsed.observed),
    watch: sanitiseMarketProse(parsed.watch),
    asOf,
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
  const context = marketContext
    ? JSON.stringify(pick(marketContext, ["assumption", "baseline", "observed", "watch", "asOf"]))
    : "No live context was requested. Do not invent current facts, figures or market consensus.";

  const personaInstructions = PERSONAS.map(
    ({ id, label, guidance }, index) =>
      `${index + 1}. ${label} (${id}): ${guidance}`
  ).join("\n");

  const response = await openAI(env, {
    model,
    reasoning: { effort: "none" },
    input: [
      {
        role: "system",
        content: `You are VIEW Coach. Help a junior banker respond as a reliable partner: calm, commercially aware, useful and genuinely interested in the client.

Use VIEW as a reasoning structure, not a spoken script:
- V — Give a clear baseline view.
- I — Identify only the one or two factors most likely to change it.
- E — Translate the view into relevant business or financial implications.
- W — Bridge from the broad picture to the client's situation, then ask one open and helpful question.

Important conversational principle: answer before asking. Do not begin with a clarifying question. Where the client's question is broad, use the most reasonable interpretation, state any material assumption lightly, provide a useful broad response, and only then invite the client to explain what matters most.

The final question should be open enough to reveal something unexpected and specific enough to answer. It may offer two or three plausible examples, but must leave space for “something else”, “another priority” or “a different angle”. Avoid binary, product-led or prematurely narrow questions.

Use ordinary spoken English and relatively short sentences. Avoid academic language, market-note phrasing, jargon, false certainty, excessive disclaimers and product pitching. Do not recommend a transaction until the client's objective and constraints are understood. Do not invent facts, forecasts, institutional views or current market data.`
      },
      {
        role: "user",
        content: `${formatClientInput({
          question,
          marketRegion,
          clientContext
        })}

SOURCE-BASED CONTEXT:
${context}

Create exactly one answer for each banker persona, in this order:
${personaInstructions}

For each persona:
- responseBody: 90–130 words containing the baseline view, main uncertainty, practical implications and a natural bridge. Do not include the final client question.
- shorterLiveBody: 35–60 words containing the baseline, main uncertainty, one implication and a short bridge. Do not include the final client question.
- view: a brief explanation of the baseline view.
- influences: the one or two factors most likely to change the view.
- effects: practical implications relevant to the likely client decision.
- clientQuestion: one open, topic-specific question ending in a question mark. Include helpful examples where useful and preserve an explicit opening for another concern or angle.
- assumptionsMade: state the reasonable interpretation used, or “None”.
- verificationNeeded: identify current facts, technical details or specialist input to check, or “None”.

Shared quality requirements:
- Do not start responseBody or shorterLiveBody with a question.
- Do not place any question in responseBody or shorterLiveBody; clientQuestion is the single final question and the application will append it once.
- Do not bury the baseline beneath caveats.
- Mention only material uncertainties; do not list every scenario.
- State a material assumption lightly in the response only when necessary.
- Keep implications practical and relevant; do not jump to a product recommendation.
- The bridge into W should acknowledge that relevance depends on the client's priorities or exposures.
- Do not silently assume a market, currency, country or central bank.
- Do not mention VIEW, the model, the prompt, the source brief or the analysis.
- Do not include markdown, citations, URLs or unsupported figures.
- The three answers must differ in banker purpose and emphasis, not merely in confidence, wording or length.
- Each persona may emphasise different parts of the shared analysis; do not force every answer to repeat every fact, risk and implication.
- The short VIEW fields should explain the structure rather than repeat the response verbatim.`
      }
    ],
    text: {
      verbosity: "medium",
      ...jsonFormat("view_answers", VIEW_ANSWER_SCHEMA)
    },
    max_output_tokens: 4200,
    store: false
  });

  const parsed = parseJsonOutput(response, "VIEW answers");
  return normaliseAnswers(parsed.answers, question, clientContext);
}

function normaliseAnswers(answers, question, clientContext) {
  const byId = new Map(answers.map((answer) => [answer.personaId, answer]));
  const fallbacks = topicSpecificFallbacks(question, clientContext);
  const usedQuestions = new Set();

  return PERSONAS.map((persona, index) => {
    const answer = byId.get(persona.id) || answers[index] || {};
    const body = cleanSpeech(answer.responseBody);
    let clientQuestion = normaliseClientQuestion(answer.clientQuestion);

    if (
      !clientQuestion ||
      isGenericClientQuestion(clientQuestion) ||
      usedQuestions.has(comparisonKey(clientQuestion))
    ) {
      clientQuestion = fallbacks[index];
    }

    usedQuestions.add(comparisonKey(clientQuestion));

    return {
      personaId: persona.id,
      label: persona.label,
      response: assembleResponse(body, clientQuestion),
      shorterLiveVersion: assembleResponse(
        cleanSpeech(answer.shorterLiveBody),
        clientQuestion
      ),
      view: cleanSpeech(answer.view),
      influences: cleanSpeech(answer.influences),
      effects: cleanSpeech(answer.effects),
      whatMatters: clientQuestion,
      assumptionsMade: cleanSpeech(answer.assumptionsMade) || "None",
      verificationNeeded: cleanSpeech(answer.verificationNeeded) || "None"
    };
  });
}

function assembleResponse(body, clientQuestion) {
  const cleanBody = cleanSpeech(stripTrailingQuestion(body));
  if (!cleanBody) return clientQuestion;

  const punctuation = /[.!]$/.test(cleanBody) ? "" : ".";
  return `${cleanBody}${punctuation} ${clientQuestion}`.replace(/\s+/g, " ").trim();
}

function stripTrailingQuestion(value) {
  const text = clean(value, 1800).trim();
  if (!text) return "";

  // Structured output should not contain a question here. If the model adds
  // one anyway, remove the final question before appending clientQuestion once.
  if (!text.endsWith("?")) return text;

  const sentenceBoundary = Math.max(
    text.lastIndexOf(". "),
    text.lastIndexOf("! "),
    text.lastIndexOf("? ", text.length - 2)
  );

  return sentenceBoundary >= 0
    ? text.slice(0, sentenceBoundary + 1).trim()
    : "";
}

function topicSpecificFallbacks(question, clientContext) {
  const text = `${question} ${clientContext}`.toLowerCase();

  const categories = [
    {
      pattern: /\b(currency|currencies|foreign exchange|fx|exchange rate|sgd|myr|usd|eur|gbp|jpy|cny|thb)\b/,
      questions: [
        "How are you looking at this in relation to your business: an upcoming payment, a receipt, an existing exposure, or something else?",
        "Which aspect matters most at the moment: the rate, timing, cash-flow certainty, or another priority?",
        "Are you working towards a particular decision date or risk limit, or looking at this from a different angle?"
      ]
    },
    {
      pattern: /\b(interest rate|rates|borrowing|loan|facility|refinanc|mortgage|funding)\b/,
      questions: [
        "How are you thinking about this: an existing facility, new borrowing, an investment decision, or something else?",
        "Which aspect matters most at the moment: cost, timing, certainty, flexibility, or another consideration?",
        "Are you working towards a particular refinancing or investment decision, or looking at this from another angle?"
      ]
    },
    {
      pattern: /\b(gold|silver|precious metal|commodity|commodities)\b/,
      questions: [
        "Are you considering a purchase, a sale, or reviewing an existing exposure?",
        "Which matters most here: timing, price certainty, or managing volatility?",
        "When might you act, and how much short-term price movement can you absorb?"
      ]
    }
  ];

  return (
    categories.find(({ pattern }) => pattern.test(text))?.questions || [
      "How are you looking at this in relation to your business: a particular exposure, a decision, or something else?",
      "Which practical consideration matters most: timing, cost, certainty, flexibility, or another priority?",
      "Are you working towards a particular decision or constraint, or looking at this from a different angle?"
    ]
  );
}

function formatClientInput({ question, marketRegion, clientContext }) {
  return `CLIENT QUESTION:\n${question}\n\nMARKET OR REGION:\n${
    marketRegion || "Not provided."
  }\n\nCLIENT CONTEXT:\n${clientContext || "Not provided."}`;
}

function jsonFormat(name, schema) {
  return {
    format: {
      type: "json_schema",
      name,
      strict: true,
      schema
    }
  };
}

function parseJsonOutput(response, description) {
  const text = outputText(response);

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error(`The model returned invalid structured ${description}.`);
    error.diagnostics = {
      requestId: response._requestId || null,
      outputPreview: text.slice(0, 240)
    };
    throw error;
  }
}

function sanitiseMarketProse(value) {
  return clean(value, 2200)
    // Remove markdown-style links, including spaces between ] and (.
    .replace(/\[([^\]]+)\]\s*\(\s*https?:\/\/[^)]+\)/gi, "")
    // Remove combined citation clusters such as ([publisher.com] (https://...)).
    .replace(/\(\s*\[[^\]]+\]\s*\(\s*https?:\/\/[^)]+\)\s*\)/gi, "")
    // Remove parenthesised and bare URLs that still remain.
    .replace(/\(\s*https?:\/\/[^)]+\)/gi, "")
    .replace(/https?:\/\/[^\s)]+/gi, "")
    // Remove leaked publisher/domain markers and simple footnote markers.
    .replace(/\[\s*(?:www\.)?[a-z0-9.-]+\.(?:com|org|net|gov|edu|co|io)\s*\]/gi, "")
    .replace(/\(\s*(?:www\.)?[a-z0-9.-]+\.(?:com|org|net|gov|edu|co|io)\s*\)/gi, "")
    .replace(/\[\s*(?:source|sources|citation|\d+)\s*\]/gi, "")
    // Tidy punctuation left behind by removed citations.
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([.!?])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSpeech(value) {
  return clean(value, 1800)
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/\?/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseClientQuestion(value) {
  const question = clean(value, 300)
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/^(W\s*[—–-]\s*)?(What matters|Client question)\s*:?\s*/i, "")
    .split("?")[0]
    .replace(/[.!]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  return question ? `${question}?` : "";
}

function isGenericClientQuestion(value) {
  const text = comparisonKey(value);
  return [
    "what decision is behind your question",
    "what decision are you considering",
    "what matters most to you",
    "how does this affect you",
    "would you like to know more"
  ].some((phrase) => text.includes(phrase));
}

function comparisonKey(value) {
  return clean(value, 400)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

function requireApiKey(env) {
  if (env.OPENAI_API_KEY) return;
  const error = new Error(
    "OPENAI_API_KEY is not available to this Cloudflare Pages Function. Add it under the Pages project's runtime Variables and Secrets, then redeploy."
  );
  error.status = 500;
  throw error;
}

function modelFromEnv(value, fallback) {
  return clean(value, 120) || fallback;
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

  const textParts = [];
  const refusals = [];

  for (const item of response.output || []) {
    if (item.type !== "message") continue;

    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        textParts.push(content.text);
      } else if (content.type === "refusal" && content.refusal) {
        refusals.push(content.refusal);
      }
    }
  }

  if (textParts.length) return textParts.join("\n").trim();

  const error = new Error(
    refusals.length
      ? `OpenAI refused the request: ${refusals.join(" ")}`
      : "OpenAI returned no text."
  );
  error.diagnostics = {
    requestId: response._requestId || null,
    status: response.status || null,
    incompleteReason: response.incomplete_details?.reason || null,
    outputTypes: (response.output || []).map((item) => item.type),
    usage: response.usage || null
  };
  throw error;
}

function extractSources(response) {
  const sources = new Map();

  for (const item of response.output || []) {
    if (item.type === "message") {
      for (const content of item.content || []) {
        for (const annotation of content.annotations || []) {
          if (annotation.type === "url_citation" && annotation.url) {
            addSource(sources, annotation.url, annotation.title);
          }
        }
      }
    }

    if (item.type === "web_search_call") {
      for (const source of item.action?.sources || []) {
        if (source.url) addSource(sources, source.url, source.title);
      }
    }
  }

  return [...sources.values()].slice(0, 5);
}

function addSource(map, rawUrl, rawTitle) {
  const url = normaliseUrl(rawUrl);
  if (!url || map.has(url)) return;
  map.set(url, { title: sourceTitle(rawTitle, url), url });
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
    return new URL(url).hostname.replace(/^www\./, "");
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
    headers: { "Cache-Control": "no-store" }
  });
}
