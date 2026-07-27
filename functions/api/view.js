const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_ANSWER_MODEL = "gpt-5.6-terra";
const DEFAULT_ANALYSIS_MODEL = "gpt-5.4-mini";

const BANKER_PROFILE = {
  id: "friendly_junior",
  label: "Suggested response"
};

const VIEW_ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
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
    "responseBody",
    "shorterLiveBody",
    "view",
    "influences",
    "effects",
    "clientQuestion",
    "assumptionsMade",
    "verificationNeeded"
  ]
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

    const answer = await createViewAnswer({
      env,
      model: answerModel,
      marketContext,
      ...input
    });

    return json({
      answer,
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

async function createViewAnswer({
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

  const response = await openAI(env, {
    model,
    reasoning: { effort: "none" },
    input: [
      {
        role: "system",
        content: `You are helping a friendly junior banker with about one to two years of experience respond to a client.

The banker is building rapport, not trying to sound like a market expert. Take the client’s question at face value and treat it as a genuine invitation to share a useful thought. Assume there may be a personal, business or financial reason behind the question, but do not guess what that reason is, overstate its importance or assume the client already holds a particular market view.

Use VIEW as an internal guide:
- V: Give a simple and direct initial view in everyday language.
- I: Mention one important thing that could change the picture.
- E: Explain one practical way the topic could matter, using conditional language where the relevance is not yet clear.
- W: End with one friendly, topic-specific question that gently explores how the subject may connect to the client.

Conversation rules:
- Answer before asking a question.
- Use plain English that does not require financial-market knowledge.
- Explain any necessary market term in ordinary words.
- Do not correct, challenge or reframe the client’s premise.
- Do not imply that the client is wrong, overconfident, relying on a false floor, chasing a market move, or overlooking risk.
- Do not tell the client what they should do.
- Do not jump to a product, transaction or technical solution.
- A gentle relevance link is welcome, but phrase it as an invitation rather than a conclusion. Do not claim to know the client’s exposure, objective or decision.
- Avoid phrases such as “your base case”, “you may be assuming”, “rather than treating”, “you should allow for”, “the prudent approach”, or anything that sounds corrective or advisory.
- Do not sound like a strategist, economist, research note or official house view.
- Keep the tone warm, modest, natural and easy to say aloud.
- Do not invent facts, forecasts, figures or institutional views.`
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

Create one suggested response for the junior banker.

Output requirements:
- responseBody: 70–110 words. Give a simple answer, one main uncertainty, and a natural bridge. Do not include the final question.
- shorterLiveBody: 35–55 words. Keep the same friendly, accessible tone. Do not include the final question.
- view: a brief plain-English summary of the initial view.
- influences: the single most important factor that could change the picture, in plain English.
- effects: one practical way the topic could matter, stated without assuming the client’s exact situation.
- clientQuestion: one friendly, topic-specific question ending in a question mark. The question should gently test the relevance of the topic to the client and should be tailored to the subject. It may ask whether the topic connects to something the client is considering, planning or watching, while leaving room for simple curiosity. Do not use the same generic wording repeatedly. Do not ask “What have you been hearing?”, “What made you ask?”, or “Is there another angle you have in mind?”. Do not jump to a product or transaction.
- assumptionsMade: state any material interpretation used, or “None”.
- verificationNeeded: identify current facts that should be checked, or “None”.

Quality checks:
- Take the client’s wording at face value.
- Make a gentle relevance link without pretending to know the reason behind the question.
- Do not infer or comment on the client’s own view.
- Do not use language that sounds like correcting the client.
- Do not start with a disclaimer or a question.
- Do not use jargon where a common word will do.
- Do not mention VIEW, the prompt, the model or the source brief.
- Do not include markdown, citations, publisher names or URLs.`
      }
    ],
    text: {
      verbosity: "medium",
      ...jsonFormat("view_answer", VIEW_ANSWER_SCHEMA)
    },
    max_output_tokens: 1800,
    store: false
  });

  const parsed = parseJsonOutput(response, "VIEW answer");
  return normaliseAnswer(parsed, question, clientContext);
}

function normaliseAnswer(answer, question, clientContext) {
  const body = cleanSpeech(removeQuestions(answer.responseBody));
  let clientQuestion = normaliseClientQuestion(answer.clientQuestion);

  if (!clientQuestion || isGenericClientQuestion(clientQuestion)) {
    clientQuestion = topicSpecificFallback(question, clientContext);
  }

  return {
    personaId: BANKER_PROFILE.id,
    label: BANKER_PROFILE.label,
    response: assembleResponse(body, clientQuestion),
    shorterLiveVersion: assembleResponse(
      cleanSpeech(removeQuestions(answer.shorterLiveBody)),
      clientQuestion
    ),
    view: cleanSpeech(answer.view),
    influences: cleanSpeech(answer.influences),
    effects: cleanSpeech(answer.effects),
    whatMatters: clientQuestion,
    assumptionsMade: cleanSpeech(answer.assumptionsMade) || "None",
    verificationNeeded: cleanSpeech(answer.verificationNeeded) || "None"
  };
}

function assembleResponse(body, clientQuestion) {
  const cleanBody = cleanSpeech(removeQuestions(body));
  if (!cleanBody) return clientQuestion;
  const punctuation = /[.!]$/.test(cleanBody) ? "" : ".";
  return `${cleanBody}${punctuation} ${clientQuestion}`.replace(/\s+/g, " ").trim();
}

function removeQuestions(value) {
  const text = clean(value, 1800).trim();
  if (!text) return "";
  const firstQuestion = text.indexOf("?");
  return (firstQuestion >= 0 ? text.slice(0, firstQuestion) : text)
    .replace(/\s+/g, " ")
    .trim();
}

function topicSpecificFallback(question, clientContext) {
  const text = `${question} ${clientContext}`.toLowerCase();

  if (/\b(gold|silver|precious metal|commodity|commodities)\b/.test(text)) {
    return "Is this something you are looking at more closely at the moment, or are you mainly following the recent move?";
  }
  if (/\b(interest rate|rates|borrowing|loan|mortgage|funding)\b/.test(text)) {
    return "Are rates relevant to anything you are planning at the moment, or are you mainly interested in where they may head next?";
  }
  if (/\b(currency|foreign exchange|fx|exchange rate|sgd|myr|usd|eur|gbp|jpy|cny|thb)\b/.test(text)) {
    return "Is this exchange rate relevant to anything coming up for you, or are you mainly watching the direction?";
  }
  if (/\b(iran|war|conflict|geopolit|election|politic)\b/.test(text)) {
    return "Does this situation connect to anything you are watching more closely, such as markets or business conditions?";
  }

  return "Is this connected to something you are considering at the moment, or are you mainly interested in the broader picture?";
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
    "what matters most to you",
    "how does this affect you",
    "what decision is behind your question",
    "what decision are you considering",
    "would you like to know more"
  ].some((phrase) => text.includes(phrase));
}

function comparisonKey(value) {
  return clean(value, 400)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  let text = clean(value, 2200).trim();
  if (!text) return "";

  return text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, "$1")
    .replace(/\(\s*\[[^\]]+\]\s*\(https?:\/\/[^)]+\)\s*\)/gi, "")
    .replace(/\(\s*(?:https?:\/\/|www\.)[^)\s]+\s*\)/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\[[^\]]+\]\s*$/g, "")
    .replace(/\[\s*(?:source|sources|citation|\d+)\s*\]/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([.!?])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/[([\s]+$/, "")
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
