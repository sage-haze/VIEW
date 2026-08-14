import { getApprovedFxContext } from "../_shared/fx-reports.js";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_ANSWER_MODEL = "gpt-5.6-terra";
const DEFAULT_ANALYSIS_MODEL = "gpt-5.4-mini";

const BANKER_PROFILE = {
  id: "friendly_junior",
  label: "One possible VIEW response"
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
      sourceMode: normaliseSourceMode(body.sourceMode),
      alternativeRequest: Boolean(body.alternativeRequest),
      previousResponse: clean(body.previousResponse, 1800),
      reusedMarketContext: normaliseReusedMarketContext(body.reusedMarketContext)
    };

    if (!input.question) {
      return json({ error: "Please enter a client question." }, 400);
    }

    const regionResolution = resolveMarketRegion(input.question, input.marketRegion);
    input.marketRegion = regionResolution.marketRegion;
    input.marketRegionWasDefaulted = regionResolution.wasDefaulted;

    const answerModel = modelFromEnv(
      env.OPENAI_ANSWER_MODEL,
      DEFAULT_ANSWER_MODEL
    );
    const analysisModel = modelFromEnv(
      env.OPENAI_ANALYSIS_MODEL,
      DEFAULT_ANALYSIS_MODEL
    );

    const usesInternalGuidance = input.sourceMode !== "market";
    const usesMarketSources = input.sourceMode !== "internal";

    const approvedFx = usesInternalGuidance
      ? await getApprovedFxContext({
          env,
          question: `${input.question} ${input.clientContext}`,
          allowRefresh: true,
          writeForLearner: !input.alternativeRequest
        }).catch((error) => {
          console.error("Approved FX source error", error);
          return {
            context: null,
            source: null,
            cacheStatus: "error",
            error: error.publicMessage || error.message || "Unable to process the internal FX guidance.",
            diagnostics: error.diagnostics || null
          };
        })
      : { context: null, source: null, cacheStatus: "not-requested", error: null, diagnostics: null };

    if (input.sourceMode === "internal" && !approvedFx.context) {
      return json({
        answer: null,
        marketContext: null,
        approvedFxSource: null,
        sourceUnavailable: {
          message: "Internal guidance is not available for this question. Please select another source."
        },
        approvedFxStatus: {
          status: approvedFx.cacheStatus,
          used: false,
          error: approvedFx.error || null,
          diagnostics: approvedFx.diagnostics || null
        },
        models: { answer: null, analysis: null }
      });
    }

    const marketContext = usesMarketSources
      ? (input.reusedMarketContext || await createMarketContext({ env, model: analysisModel, ...input }))
      : null;

    const answer = await createViewAnswer({
      env,
      model: answerModel,
      marketContext,
      approvedFxContext: approvedFx.context,
      ...input
    });

    return json({
      answer,
      marketContext,
      approvedFxSource: approvedFx.context ? {
        ...approvedFx.source,
        cacheStatus: approvedFx.cacheStatus
      } : null,
      approvedFxStatus: {
        status: approvedFx.cacheStatus,
        used: Boolean(approvedFx.context),
        error: approvedFx.error || null,
        diagnostics: approvedFx.diagnostics || null
      },
      models: {
        answer: answerModel,
        analysis: usesMarketSources && !input.reusedMarketContext ? analysisModel : null
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


function normaliseSourceMode(value) {
  return ["combined", "internal", "market"].includes(value) ? value : "combined";
}

function normaliseReusedMarketContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {
    assumption: clean(value.assumption, 500),
    baseline: clean(value.baseline, 800),
    observed: clean(value.observed, 1000),
    watch: clean(value.watch, 800),
    asOf: clean(value.asOf, 20),
    caution: clean(value.caution, 300),
    sources: Array.isArray(value.sources)
      ? value.sources.slice(0, 8).map((item) => ({
          title: clean(item?.title, 300),
          url: clean(item?.url, 1200)
        })).filter((item) => item.url)
      : []
  };
  return result.baseline || result.observed || result.watch ? result : null;
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
        content: `Prepare a compact, source-based market context for a junior corporate banker with about one to two years of experience who is preparing to answer a client question.

Use current, authoritative sources. Strongly prioritise official institutions, central banks, regulators, recognised international organisations, and reputable financial or general-news publishers with direct reporting. Prioritise sources from the market or country named in the question. Use global sources when they explain an important external influence. Use at least two independent high-quality sources whenever the topic permits.

Separate observed facts from the baseline outlook. State an explicit assumption only when the market, currency or jurisdiction is unclear. Keep the language plain and professional without oversimplifying the market logic. Do not give personalised advice.

Where the question concerns a clearly defined future event, you may consult reputable event or prediction markets only as a quiet secondary background signal. Use that signal solely to corroborate or challenge conclusions already supported by stronger evidence from official data, conventional financial-market pricing, professional surveys and reputable reporting. Never let it determine the baseline, supply an observed fact, or replace a reputable supporting source. Treat any implied probability as a rough participant expectation, not a fact, forecast, recommendation or definitive consensus. Ignore thin, stale, ambiguous or poorly matched contracts.

Do not mention bookmakers, betting, wagers, odds, strong bets, event markets or prediction markets in the four prose fields. Do not rely on them for any claim unless the same direction is independently supported by reputable sources. Translate any useful background signal into restrained language only when it materially improves the synthesis.

Return clean prose only in the structured fields. Do not include citations, publisher names, domains, URLs, markdown links, footnotes or source markers in assumption, baseline, observed or watch. Sources are collected separately by the application.`
      },
      {
        role: "user",
        content: `${formatClientInput({ question, marketRegion, clientContext })}

As of: ${asOf}

Return four short fields:
- assumption: one clear sentence or an empty string
- baseline: the likely direction and timeframe, no more than 40 words
- observed: the two most relevant current facts, no more than 45 words
- watch: one or two developments that could change the view, no more than 35 words

Check that each causal statement is accurate. Describe opposing forces separately rather than combining them into one dense sentence.`
      }
    ],
    text: jsonFormat("market_context", MARKET_CONTEXT_SCHEMA),
    max_output_tokens: 1500,
    store: false
  });

  const parsed = parseJsonOutput(response, "market context");

  return {
    assumption: sanitiseMarketProse(parsed.assumption),
    baseline: sanitiseMarketProse(parsed.baseline),
    observed: sanitiseMarketProse(parsed.observed),
    watch: sanitiseMarketProse(parsed.watch),
    asOf,
    sources: extractSources(response, { question, marketRegion }),
    caution: "This is a market view, not a guaranteed forecast or personalised advice."
  };
}

async function createViewAnswer({
  env,
  model,
  question,
  clientContext,
  marketRegion,
  marketContext,
  approvedFxContext,
  alternativeRequest,
  previousResponse
}) {
  const context = marketContext
    ? JSON.stringify(pick(marketContext, ["assumption", "baseline", "observed", "watch", "asOf"]))
    : "No current market-source context was requested. Do not invent current facts, figures or market consensus.";

  const approvedContext = approvedFxContext ||
    "No relevant approved FX report section was found. Do not imply that an institutional FX report was consulted.";

  const response = await openAI(env, {
    model,
    reasoning: { effort: "none" },
    input: [
      {
        role: "system",
        content: `You are helping a friendly junior banker with about one to two years of experience respond to a client.

The banker is building rapport, not trying to sound like a market expert. Take the client's question at face value and treat it as a genuine invitation to share a useful thought. Assume there may be a personal, business or financial reason behind the question, but do not guess what that reason is, overstate its importance or assume the client already holds a particular market view.

Use VIEW as an internal guide:
- V — Give a baseline view: offer a simple and direct initial view in everyday language.
- I — Identify what may change the view: usually mention one important thing that could change the picture. Include a second only if leaving it out would materially distort the picture.
- E — Explain possible implications: explain one practical way the topic could matter, using conditional language where the relevance is not yet clear. Do not force every question into a financing or cash-flow decision.
- W — Welcome what matters to the client: end with one friendly, topic-specific question that gently explores how the subject may connect to the client while leaving room for something else.

Conversation rules:
- Answer before asking a question.
- Use plain English that does not require financial-market knowledge.
- Explain any necessary market term in ordinary words.
- Keep the tone warm, modest, professional, natural and easy for a junior banker to say aloud.
- Do not correct, challenge or reframe the client's premise.
- Do not imply that the client is wrong, overconfident, relying on a false floor, chasing a market move, or overlooking risk.
- Do not tell the client what they should do.
- Do not jump to a product, transaction or technical solution.
- A gentle relevance link is welcome, but phrase it as an invitation rather than a conclusion. Do not claim to know the client's exposure, objective or decision.
- Avoid phrases such as “your base case”, “you may be assuming”, “rather than treating”, “you should allow for”, “the prudent approach”, or anything that sounds corrective or advisory.
- Do not sound like a strategist, economist, research note, trading desk or official house view.
- Avoid market slogans, trader expressions, metaphors and compressed research-note wording.
- Do not invent facts, forecasts, figures or institutional views.
- If source-based context was partly informed by event-market pricing, do not mention that mechanism, odds, bets or implied probabilities in the spoken response unless the client specifically asks about the source.`
      },
      {
        role: "user",
        content: `${formatClientInput({
          question,
          marketRegion,
          clientContext
        })}

LIVE SOURCE-BASED CONTEXT:
${context}

APPROVED INSTITUTIONAL BACKGROUND:
${approvedContext}

Source handling:
- When approved institutional background is supplied and relevant, use it as the primary source for the baseline FX view.
- Keep any dated report view clearly conditional and do not imply it is current beyond its stated period.
- Live web context may update observed facts and developments, but it must not be described as an authorised bank view.
- Do not mention the report title or source details in the spoken response unless natural and necessary. The interface will disclose the source separately.

${alternativeRequest ? `ALTERNATIVE RESPONSE REQUEST:
Generate another valid VIEW response using the same underlying market context. Keep the factual direction consistent, but use a meaningfully different natural phrasing, sentence rhythm or emphasis. Do not simply replace a few words. The purpose is to demonstrate that VIEW is a guide rather than a script. Avoid repeating this earlier response closely:
${previousResponse || "No earlier response supplied."}
` : ""}
Create one suggested response.

Output requirements:
- responseBody: normally 40–75 words in three or four short sentences. Give a direct view, the main uncertainty and one possible practical relevance. Do not include the final question.
- shorterLiveBody: normally 20–40 words with the same meaning and tone. Do not include the final question.
- view: a brief summary of the initial view in everyday language.
- influences: the most important factor that could change the picture.
- effects: one practical way the topic could matter, using conditional language and without assuming the client's situation.
- clientQuestion: one friendly, natural, topic-specific and open question ending in a question mark. It should gently explore relevance rather than diagnose a decision.
- assumptionsMade: state any material interpretation used, or “None”.
- verificationNeeded: identify current facts that should be checked, or “None”.

Before returning the answer, check that it sounds believable for a friendly junior banker with about one to two years of experience and that a client who does not follow markets daily can understand it without further explanation. Do not mention VIEW, the prompt, the model or the source brief. Do not include markdown, citations, publisher names or URLs.`
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
    return "Is there a particular part of this move that interests you most, or is there another angle you are thinking about?";
  }
  if (/\b(interest rate|rates|borrowing|loan|mortgage|funding)\b/.test(text)) {
    return "Are you thinking about rates mainly in relation to funding or investment timing, or is there another angle that matters more?";
  }
  if (/\b(currency|foreign exchange|fx|exchange rate|sgd|myr|usd|eur|gbp|jpy|cny|thb)\b/.test(text)) {
    return "Is this exchange rate connected to anything you are looking at at the moment, or is there another part of the move you are interested in?";
  }
  if (/\b(iran|war|conflict|geopolit|election|politic)\b/.test(text)) {
    return "Is there a particular part of this situation that feels most relevant to you, whether for business, markets or something else?";
  }

  return "Is there a particular part of this that feels most relevant to you, or is there another angle you are thinking about?";
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

function resolveMarketRegion(question, marketRegion) {
  if (marketRegion) {
    return { marketRegion, wasDefaulted: false };
  }

  const text = clean(question, 1500).toLowerCase();
  const rateQuestion = /\b(interest rates?|policy rates?|mortgage rates?|home loans?|housing loans?|fixed rates?|floating rates?|borrowing rates?|deposit rates?|refinancing|refinance)\b/.test(text);
  const localeSignal = /\b(thailand|thai|thb|bangkok|singapore|sgd|sora|mas|malaysia|myr|bank negara|united states|u\.s\.|usa|usd|fed|federal reserve|united kingdom|uk|gbp|sterling|bank of england|euro area|eurozone|eur|ecb|japan|jpy|boj|china|cny|rmb|pboc|hong kong|hkd|hkma|indonesia|idr|philippines|php|vietnam|vnd|india|inr|australia|aud|canada|cad|new zealand|nzd)\b/.test(text);

  if (rateQuestion && !localeSignal) {
    return {
      marketRegion: "Thailand (application default because the rates question did not specify a locale)",
      wasDefaulted: true
    };
  }

  return { marketRegion: "", wasDefaulted: false };
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

function extractSources(response, { question = "", marketRegion = "" } = {}) {
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

  const context = `${question} ${marketRegion}`.toLowerCase();
  const ranked = [...sources.values()]
    .filter((source) => !isEventMarketSource(source))
    .map((source) => ({
      ...source,
      hostname: sourceHostname(source.url),
      score: sourcePriority(source) + regionalSourceBoost(source, context)
    }))
    .sort((a, b) => b.score - a.score);

  // Prefer distinct publishers and institutions before using a second page
  // from the same domain. This avoids a visible list of five near-identical
  // links while still allowing a second highly relevant primary source.
  const selected = [];
  const hostCounts = new Map();

  for (const source of ranked) {
    if (!source.hostname || hostCounts.has(source.hostname)) continue;
    selected.push(source);
    hostCounts.set(source.hostname, 1);
    if (selected.length === 5) break;
  }

  if (selected.length < 5) {
    for (const source of ranked) {
      if (selected.some((item) => item.url === source.url)) continue;
      const count = hostCounts.get(source.hostname) || 0;
      if (count >= 2) continue;
      selected.push(source);
      hostCounts.set(source.hostname, count + 1);
      if (selected.length === 5) break;
    }
  }

  return selected.map(({ title, url }) => ({ title, url }));
}

function sourceHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function regionalSourceBoost({ url, title }, context) {
  const hostname = sourceHostname(url);
  const text = `${hostname} ${title || ""}`.toLowerCase();
  let score = 0;

  const regions = [
    {
      match: /\b(singapore|sgd|sora|mas|association of banks in singapore)\b/,
      local: [
        "mas.gov.sg", "moneysense.gov.sg", "singstat.gov.sg", "abs.org.sg",
        "sora.org.sg", "channelnewsasia.com", "businesstimes.com.sg",
        "straitstimes.com", "sgx.com"
      ]
    },
    {
      match: /\b(thailand|thai|thb|bank of thailand|bot)\b/,
      local: [
        "bot.or.th", "nso.go.th", "mof.go.th", "thaibma.or.th",
        "bangkokpost.com", "nationthailand.com", "set.or.th"
      ]
    },
    {
      match: /\b(malaysia|myr|bank negara|bnm)\b/,
      local: ["bnm.gov.my", "dosm.gov.my", "bernama.com", "theedgemalaysia.com"]
    },
    {
      match: /\b(united kingdom|uk|sterling|gbp|bank of england)\b/,
      local: ["bankofengland.co.uk", "ons.gov.uk", "gov.uk", "ft.com", "bbc.co.uk"]
    },
    {
      match: /\b(euro area|eurozone|european union|eur|ecb)\b/,
      local: ["ecb.europa.eu", "eurostat.ec.europa.eu", "europa.eu"]
    },
    {
      match: /\b(united states|u\.s\.|usa|usd|federal reserve|fed)\b/,
      local: ["federalreserve.gov", "bls.gov", "bea.gov", "treasury.gov"]
    }
  ];

  for (const region of regions) {
    if (!region.match.test(context)) continue;
    if (region.local.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      score += 8;
    } else if (text.includes(context.trim())) {
      score += 1;
    }
  }

  // Reputable global reporting remains useful, but local primary evidence
  // should normally rank above it when a jurisdiction is specified.
  if (/reuters\.com|bloomberg\.com|ft\.com|apnews\.com|bbc\./.test(hostname)) {
    score += 1;
  }

  return score;
}

function isEventMarketSource({ url, title }) {
  const text = `${url} ${title}`.toLowerCase();
  return [
    "polymarket",
    "kalshi",
    "predictit",
    "betfair",
    "manifold.markets",
    "metaculus",
    "smarkets",
    "betting odds",
    "prediction market",
    "event market"
  ].some((term) => text.includes(term));
}

function sourcePriority({ url }) {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return 0;
  }

  const officialPatterns = [
    ".gov", ".gov.uk", ".europa.eu", "imf.org", "worldbank.org",
    "bis.org", "oecd.org", "un.org", "ecb.europa.eu", "federalreserve.gov",
    "bankofengland.co.uk", "mas.gov.sg", "bot.or.th"
  ];
  if (officialPatterns.some((pattern) => hostname.endsWith(pattern) || hostname.includes(pattern))) {
    return 4;
  }

  const topNews = [
    "reuters.com", "bloomberg.com", "ft.com", "wsj.com", "apnews.com",
    "bbc.com", "bbc.co.uk", "cnbc.com", "economist.com", "nikkei.com"
  ];
  if (topNews.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    return 3;
  }

  const establishedSources = [
    "spglobal.com", "moodys.com", "fitchratings.com", "morningstar.com",
    "marketwatch.com", "investing.com", "tradingeconomics.com"
  ];
  if (establishedSources.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    return 2;
  }

  return 1;
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
