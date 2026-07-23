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
- Prefer recent primary and authoritative sources. Use the relevant central bank or regulator directly for its own decisions and statements.
- When factual claims span more than one institution or market driver, use at least two independent authoritative sources where available.
- Use older sources only when they are necessary to explain a current rule or historical comparison.
- Separate observed facts from forecasts or expectations.
- Check the direction of every causal claim. If two factors have opposing effects, state them separately rather than implying they point the same way.
- Do not call something consensus unless the evidence supports that label.
- State a clear forecast horizon, but do not repeat today's date inside every section.
- Note the one or two developments most likely to change the baseline.
- Do not give personalised investment advice.
- Do not include markdown, URLs, citations, footnotes, source names, domains in brackets, or an offer to do more.

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
E — Explain the potential practical implication for the client's decision; do not merely repeat the forecast.
W — Connect the discussion to what might matter to the client with a bridging sentence to bring it closer to them, followed by an open-ended question inviting input from the client while demonstrating interest by the banker.

Write for a banker speaking naturally to a client. Prefer short, clear sentences and ordinary spoken language. Avoid academic wording, market-note language, jargon, product pitching and internal process language. Never pretend to predict with certainty. Do not recommend a transaction before the client's objective and constraints are understood.`
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
- Response body: 40–65 words.
- Lead with a direct answer.
- Use no more than one qualifying phrase.
- Make it sound easy to say aloud.
- Client question: ask about the concrete action or exposure behind the question, using topic-relevant choices where possible.

2. Balanced and consultative
- Response body: 75–110 words.
- Explain the baseline and the main alternative scenario.
- Include one practical planning implication, but do not recommend a specific transaction when client context is missing.
- Client question: ask which practical dimension matters most, such as timing, cost, certainty, liquidity, exposure or flexibility, tailored to the topic.

3. Cautious under uncertainty
- Response body: 65–100 words.
- Be explicit about what is uncertain and why exact timing cannot be known.
- Still give a usable baseline rather than avoiding the question.
- Client question: ask about the client's decision horizon and their ability to accommodate the relevant uncertainty or volatility.

Requirements for every answer:
- If the question uses an imprecise timeframe such as “soon”, briefly define a sensible horizon, for example “over the next few months”.
- Do not silently assume a country, currency or central bank. Use the supplied market/region or state the necessary market assumption naturally in a few words.
- The responseBody must contain no questions and no question marks.
- The clientQuestion must be exactly one short, question ending in a question mark to invite the client to share more.
- Each clientQuestion must be distinct, specific to the topic and useful for a real follow-up conversation.
- Do not use the generic phrase “What decision is behind your question?”
- Do not repeat the same wording or sentence structure across the three answers.
- Do not mention VIEW or announce its letters in the responseBody.
- Do not mention “the source brief”, “the analysis”, “the model”, “the assumption”, “the uncertain part” or “the usable baseline”.
- Do not include markdown, citations, URLs or unsupported figures.
- Check that each influence has the correct directional effect. State opposing forces separately.
- The effects field must describe a practical consequence for planning or decision-making, not restate the market direction.
- Avoid prescriptive phrases such as “you should buy”, “you should sell”, “stage the purchase” or “hedge now” unless the supplied client context clearly supports that discussion.
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
    answers: normaliseAnswers(parsed.answers, question, clientContext)
  };
}

function normaliseAnswers(answers, question, clientContext) {
  const fallbackQuestions = topicSpecificFallbacks(question, clientContext);
  const usedQuestions = new Set();

  return answers.map((answer, index) => {
    const body = cleanSpeech(answer.responseBody);
    let clientQuestion = normaliseClientQuestion(answer.clientQuestion);
    const key = comparisonKey(clientQuestion);

    if (
      !clientQuestion ||
      isGenericClientQuestion(clientQuestion) ||
      usedQuestions.has(key)
    ) {
      clientQuestion = fallbackQuestions[index];
    }

    usedQuestions.add(comparisonKey(clientQuestion));

    return {
      label: ANSWER_LABELS[index],
      response: `${body} ${clientQuestion}`.trim(),
      view: cleanSpeech(answer.view),
      influences: cleanSpeech(answer.influences),
      effects: cleanSpeech(answer.effects),
      whatMatters: clientQuestion
    };
  });
}

function cleanSpeech(value) {
  return clean(value, 1800)
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/^(Using|Based on) (?:the )?source(?:-based)? brief(?:[’']s)?[^,]*,\s*/i, "")
    .replace(/\bthe source(?:-based)? brief\b/gi, "current information")
    .replace(/\bthe uncertain part is\b/gi, "the timing is")
    .replace(/\bthe usable baseline\b/gi, "the practical baseline")
    .replace(/\?/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseClientQuestion(value) {
  let question = clean(value, 300)
    .replace(/\*\*/g, "")
    .replace(/[_`#]/g, "")
    .replace(/^(W\s*[—–-]\s*)?(What matters|Client question)\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!question) return "";

  question = question.split("?")[0].replace(/[.!]+$/, "").trim();
  if (!question) return "";

  return `${question}?`;
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

function topicSpecificFallbacks(question, clientContext) {
  const text = `${question} ${clientContext}`.toLowerCase();

  if (/\b(gold|silver|precious metal|commodity|commodities)\b/.test(text)) {
    return [
      "Are you considering buying, selling, or reviewing an existing exposure?",
      "Is your main concern the timing of a purchase, a sale, or managing price risk?",
      "How soon might you need to act, and how much short-term volatility could you accommodate?"
    ];
  }

  if (/\b(interest rate|rates|borrowing|loan|facility|refinanc|mortgage|funding)\b/.test(text)) {
    return [
      "Are you asking about an existing borrowing cost, a new facility, or an investment decision?",
      "Is your main concern cost, timing, certainty, or retaining flexibility?",
      "How soon do you need to decide, and how much rate uncertainty can you accommodate?"
    ];
  }

  if (/\b(currency|currencies|foreign exchange|fx|exchange rate)\b/.test(text)) {
    return [
      "Are you planning a payment, a receipt, or reviewing an existing currency exposure?",
      "Is your main concern the exchange rate, timing, or certainty of cash flow?",
      "How soon might you need to act, and how much exchange-rate movement could you tolerate?"
    ];
  }

  if (/\b(stock|stocks|share|shares|equity|equities|portfolio|investment market)\b/.test(text)) {
    return [
      "Are you considering buying, selling, or reviewing an existing position?",
      "Is your main concern timing, valuation, or managing downside risk?",
      "How soon might you need to act, and how much short-term volatility could you accommodate?"
    ];
  }

  if (/\b(inflation|economy|economic|recession|growth|gdp)\b/.test(text)) {
    return [
      "Is this mainly about pricing, funding, investment, or cash-flow planning?",
      "Which business decision is most exposed to this outlook?",
      "How soon do you need to decide, and what level of uncertainty can you plan around?"
    ];
  }

  return [
    "Are you considering acting now, waiting, or reviewing an existing position?",
    "Is your main concern cost, timing, certainty, or flexibility?",
    "How soon do you need to decide, and how much uncertainty can you accommodate?"
  ];
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
    .replace(/【[^】]+】/g, "")
    .replace(/\s*[([](?:www\.)?[a-z0-9.-]+\.(?:com|org|gov|edu|net|io|co|sg|uk|au)(?:\.[a-z]{2})?[)\]]/gi, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^If helpful,.*$/gim, "")
    .replace(/\s+([,.;:])/g, "$1")
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

  const combined = new Map();

  for (const source of cited.values()) {
    combined.set(source.url, source);
  }

  for (const source of searched.values()) {
    if (!combined.has(source.url)) combined.set(source.url, source);
  }

  return [...combined.values()].slice(0, 5);
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
