const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_ANSWER_MODEL = "gpt-5.6-terra";
const DEFAULT_ANALYSIS_MODEL = "gpt-5.4-mini";

const MARKET_CONTEXT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { assumption:{type:"string"}, baseline:{type:"string"}, observed:{type:"string"}, watch:{type:"string"} },
  required:["assumption","baseline","observed","watch"]
};

const GUIDANCE_SCHEMA = {
  type:"object", additionalProperties:false,
  properties:{
    view:{type:"array",items:{type:"string"},minItems:3,maxItems:3},
    influences:{type:"array",items:{type:"string"},minItems:3,maxItems:3},
    effects:{type:"array",items:{type:"string"},minItems:3,maxItems:3},
    whatMatters:{type:"array",items:{type:"string"},minItems:3,maxItems:3}
  },
  required:["view","influences","effects","whatMatters"]
};

const REVIEW_SCHEMA = {
  type:"object", additionalProperties:false,
  properties:{
    feedback:{
      type:"object", additionalProperties:false,
      properties:{
        view:feedbackPart(), influences:feedbackPart(), effects:feedbackPart(), whatMatters:feedbackPart()
      },
      required:["view","influences","effects","whatMatters"]
    },
    refinedResponse:{type:"string"},
    verificationPrompt:{type:"string"}
  },
  required:["feedback","refinedResponse","verificationPrompt"]
};
function feedbackPart(){return {type:"object",additionalProperties:false,properties:{strength:{type:"string"},improvement:{type:"string"}},required:["strength","improvement"]};}

export async function onRequestPost({request,env}){
  try{
    requireApiKey(env);
    const body=await request.json();
    const action=clean(body.action,20);
    if(action==="start") return await startSession(body,env);
    if(action==="review") return await reviewDraft(body,env);
    return json({error:"Unsupported action."},400);
  }catch(error){
    console.error("VIEW coach API error",error);
    return json({error:error.publicMessage||error.message||"Unable to continue guided practice.",diagnostics:error.diagnostics||null},error.status||500);
  }
}

async function startSession(body,env){
  const question=clean(body.question,1500), clientContext=clean(body.clientContext,1000);
  if(!question) return json({error:"Please enter a client question."},400);
  const resolution=resolveMarketRegion(question,clean(body.marketRegion,120));
  const marketRegion=resolution.marketRegion;
  const analysisModel=modelFromEnv(env.OPENAI_ANALYSIS_MODEL,DEFAULT_ANALYSIS_MODEL);
  const answerModel=modelFromEnv(env.OPENAI_ANSWER_MODEL,DEFAULT_ANSWER_MODEL);
  const marketContext=body.useMarketContext ? await createMarketContext({env,model:analysisModel,question,clientContext,marketRegion}) : null;
  const guidance=await createGuidance({env,model:answerModel,question,clientContext,marketRegion,marketContext});
  return json({question,clientContext,marketRegion,marketContext,guidance,models:{analysis:body.useMarketContext?analysisModel:null,answer:answerModel}});
}

async function reviewDraft(body,env){
  const question=clean(body.question,1500), clientContext=clean(body.clientContext,1000), marketRegion=clean(body.marketRegion,160);
  const draft={view:clean(body.draft?.view,800),influences:clean(body.draft?.influences,800),effects:clean(body.draft?.effects,800),whatMatters:clean(body.draft?.whatMatters,800)};
  if(!question || Object.values(draft).some(v=>!v)) return json({error:"Please complete all four VIEW parts."},400);
  const model=modelFromEnv(env.OPENAI_ANSWER_MODEL,DEFAULT_ANSWER_MODEL);
  const context=body.marketContext ? JSON.stringify(pick(body.marketContext,["assumption","baseline","observed","watch","asOf"])) : "No live context was requested.";
  const response=await openAI(env,{
    model, reasoning:{effort:"none"},
    input:[
      {role:"system",content:`You are a supportive coach for junior bankers practising VIEW. Diagnose before rewriting. Preserve the learner's wording and intent wherever possible. Give specific, encouraging feedback on judgement and relationship skill, not stylistic perfection. The banker has about one to two years of experience and should sound friendly, modest, clear and natural. Do not reward jargon or excessive certainty. Do not turn the response into a product pitch. The final W question may gently assume relevance, but must leave room for simple curiosity and must not sound intrusive or corrective. In every feedback item, acknowledge a genuine strength first. Phrase the improvement as a light, optional suggestion rather than a firm correction. Use gentle language such as 'If possible...', 'You might consider...', 'It may help to...', 'One small adjustment could be...', or 'Perhaps...'. Avoid commands such as 'Remove', 'Change', 'You need to', 'You should', 'Do not', or statements that imply the learner is simply wrong. Explain briefly why the adjustment may help. Keep each suggestion concise and encouraging.`},
      {role:"user",content:`CLIENT QUESTION:\n${question}\n\nMARKET OR REGION:\n${marketRegion||"Not provided"}\n\nCLIENT CONTEXT:\n${clientContext||"Not provided"}\n\nSOURCE CONTEXT:\n${context}\n\nLEARNER DRAFT:\nV: ${draft.view}\nI: ${draft.influences}\nE: ${draft.effects}\nW: ${draft.whatMatters}\n\nFor each part, state one genuine strength and one gently phrased, optional improvement. The improvement must begin with or naturally include softening language such as 'If possible', 'You might consider', 'It may help to', 'One small adjustment could be', or 'Perhaps'. Then assemble a lightly refined 75–130 word spoken response. Answer before asking. Use plain English. Keep only the most important uncertainty and relevance. End with exactly one friendly question. Do not invent facts. verificationPrompt should be one short sentence explaining what the banker should verify before using the response, or say "No additional verification beyond the current brief."`}
    ],
    text:{verbosity:"medium",...jsonFormat("view_review",REVIEW_SCHEMA)}, max_output_tokens:1800, store:false
  });
  return json(parseJsonOutput(response,"VIEW review"));
}

async function createGuidance({env,model,question,clientContext,marketRegion,marketContext}){
  const context=marketContext ? JSON.stringify(pick(marketContext,["assumption","baseline","observed","watch","asOf"])) : "No live context was requested. Hints must remain broad and must not invent current facts.";
  const response=await openAI(env,{
    model, reasoning:{effort:"none"},
    input:[
      {role:"system",content:`Create graduated hints for a junior banker practising VIEW. Do not write the full response. Each component needs exactly three levels: (1) a reflective prompt, (2) a focused directional hint tied to the question, and (3) a sentence opening or content option that still requires the learner to finish the thought. Keep the language plain and supportive. Do not introduce products or recommendations. W should gently explore possible relevance without assuming the client has an exposure or decision.`},
      {role:"user",content:`${formatClientInput({question,marketRegion,clientContext})}\n\nSOURCE-BASED CONTEXT:\n${context}\n\nCreate three increasingly specific hints for each of V, I, E and W. V should help the learner answer directly. I should help select only one key uncertainty. E should suggest possible relevance conditionally. W should help write one friendly, topic-specific question that may test relevance while leaving room for general interest.`}
    ],
    text:{verbosity:"low",...jsonFormat("view_guidance",GUIDANCE_SCHEMA)}, max_output_tokens:1300, store:false
  });
  return parseJsonOutput(response,"VIEW guidance");
}

async function createMarketContext({env,model,question,clientContext,marketRegion}){
  const asOf=new Date().toISOString().slice(0,10);
  const response=await openAI(env,{
    model, reasoning:{effort:"low"}, tools:[{type:"web_search"}], include:["web_search_call.action.sources"],
    input:[
      {role:"system",content:`Prepare a compact source-based market context for guided banker practice. Start with authoritative local sources for the country or market named. For an ambiguous rates question, Thailand may be supplied as the application default; state that clearly as a working assumption. Prioritise local central banks, regulators, official data and reputable local or regional news. Use global sources only for relevant external drivers. Use at least two independent high-quality institutions or publishers where possible. Event-market information may be consulted only as quiet corroboration, must not determine any conclusion, and must never appear in the visible source list or prose. Return clean prose without citations, URLs, domains or publisher names.`},
      {role:"user",content:`${formatClientInput({question,marketRegion,clientContext})}\n\nAs of: ${asOf}\n\nReturn: assumption (one sentence or blank), baseline (max 45 words), observed (two key facts, max 50 words), watch (one or two developments, max 40 words).`}
    ],
    text:jsonFormat("market_context",MARKET_CONTEXT_SCHEMA), max_output_tokens:1700, store:false
  });
  const parsed=parseJsonOutput(response,"market context");
  return {assumption:sanitiseMarketProse(parsed.assumption),baseline:sanitiseMarketProse(parsed.baseline),observed:sanitiseMarketProse(parsed.observed),watch:sanitiseMarketProse(parsed.watch),asOf,sources:extractSources(response,{question,marketRegion})};
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
