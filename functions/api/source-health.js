function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function previousDate(daysBack) {
  return formatDate(new Date(Date.now() - Number(daysBack || 7) * 24 * 60 * 60 * 1000));
}

async function testJsonFetch(url, options = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      sample: summarizePayload(data || text)
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: error?.message || String(error)
    };
  }
}

function summarizePayload(payload) {
  if (payload === null || payload === undefined) return "No payload";
  if (typeof payload === "string") return payload.slice(0, 180);
  if (Array.isArray(payload)) return `Array(${payload.length})`;
  if (payload?.observations) return `observations: ${payload.observations.length}`;
  if (payload?.result?.data) return `result.data: ${Array.isArray(payload.result.data) ? payload.result.data.length : typeof payload.result.data}`;
  if (payload?.result?.series_details) return `result.series_details: ${Array.isArray(payload.result.series_details) ? payload.result.series_details.length : typeof payload.result.series_details}`;
  if (payload?.result?.series) return `result.series: ${Array.isArray(payload.result.series) ? payload.result.series.length : typeof payload.result.series}`;
  return Object.keys(payload).slice(0, 8).join(", ") || "Object";
}

function botHeaders(env) {
  return {
    "X-IBM-Client-Id": env.BOT_API_CLIENT_ID,
    "accept": "application/json",
    "User-Agent": "conversation-builder/1.0"
  };
}

async function checkFred(env) {
  if (!env.FRED_API_KEY) return { configured: false, ok: false, message: "Missing FRED_API_KEY" };
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", "DGS10");
  url.searchParams.set("api_key", env.FRED_API_KEY);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", "1");
  const result = await testJsonFetch(url.toString(), { headers: { "User-Agent": "conversation-builder/1.0" } });
  return { configured: true, ...result };
}

async function checkBot(env) {
  if (!env.BOT_API_CLIENT_ID) return { configured: false, ok: false, message: "Missing BOT_API_CLIENT_ID" };
  const start_period = previousDate(7);
  const end_period = formatDate(new Date());
  const checks = {};

  checks.exchange_rates = await testJsonFetch(
    `https://apigw1.bot.or.th/bot/public/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/?start_period=${start_period}&end_period=${end_period}`,
    { headers: botHeaders(env) }
  );

  checks.policy_rate = await testJsonFetch(
    "https://apigw1.bot.or.th/bot/public/PolicyRate/v2/policy_rate/",
    { headers: botHeaders(env) }
  );

  checks.bibor = await testJsonFetch(
    `https://apigw1.bot.or.th/bot/public/BIBOR/v2/bibor_rate/?start_period=${start_period}&end_period=${end_period}`,
    { headers: botHeaders(env) }
  );

  checks.statistics_search = await testJsonFetch(
    "https://apigw1.bot.or.th/bot/public/search-series/?keyword=exports",
    { headers: botHeaders(env) }
  );

  return {
    configured: true,
    ok: Object.values(checks).some(item => item.ok),
    checks
  };
}

async function checkTavily(env) {
  return { configured: Boolean(env.TAVILY_API_KEY), ok: Boolean(env.TAVILY_API_KEY), message: env.TAVILY_API_KEY ? "Configured" : "Missing TAVILY_API_KEY" };
}

async function checkOpenAI(env) {
  return { configured: Boolean(env.OPENAI_API_KEY), ok: Boolean(env.OPENAI_API_KEY), message: env.OPENAI_API_KEY ? "Configured" : "Missing OPENAI_API_KEY" };
}

async function checkAlphaVantage(env) {
  return { configured: Boolean(env.ALPHA_VANTAGE_API_KEY), ok: Boolean(env.ALPHA_VANTAGE_API_KEY), message: env.ALPHA_VANTAGE_API_KEY ? "Configured but not used in research flow" : "Missing ALPHA_VANTAGE_API_KEY" };
}

export async function onRequestGet(context) {
  const { env } = context;
  const [openai, tavily, fred, bot, alphaVantage] = await Promise.all([
    checkOpenAI(env),
    checkTavily(env),
    checkFred(env),
    checkBot(env),
    checkAlphaVantage(env)
  ]);

  return Response.json({
    checked_at: new Date().toISOString(),
    sources: {
      openai,
      tavily,
      fred,
      bot,
      alpha_vantage: alphaVantage,
      world_bank: { configured: true, ok: true, message: "No key required" },
      imf_datamapper: { configured: true, ok: true, message: "No key required" },
      gdelt: { configured: true, ok: true, message: "No key required" }
    }
  });
}
