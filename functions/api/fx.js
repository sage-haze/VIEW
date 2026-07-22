const ALLOWED_CURRENCIES = ["THB", "USD", "JPY", "EUR", "CNY"];


function normalizeCurrencyList(currencies = []) {
  return [...new Set((Array.isArray(currencies) ? currencies : [])
    .map(currency => String(currency || "").toUpperCase().trim())
    .filter(currency => ALLOWED_CURRENCIES.includes(currency)))];
}

function normalizeCountryList(countries = []) {
  const seen = new Set();
  return (Array.isArray(countries) ? countries : [])
    .map(country => ({
      name: String(country?.name || "").trim(),
      code: String(country?.code || "").trim(),
      label: String(country?.label || country?.name || country?.code || "").trim()
    }))
    .filter(country => country.name || country.code || country.label)
    .filter(country => {
      const key = country.code || country.name || country.label;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeTradeFlow(raw = {}, fallbackCountries = [], fallbackCurrencies = []) {
  const fallbackCurrencyList = normalizeCurrencyList(fallbackCurrencies);
  return {
    purchase: {
      domestic: Boolean(raw?.purchase?.domestic),
      international: Boolean(raw?.purchase?.international),
      countries: normalizeCountryList(raw?.purchase?.countries || []),
      currencies: normalizeCurrencyList(raw?.purchase?.currencies || fallbackCurrencyList)
    },
    sales: {
      domestic: Boolean(raw?.sales?.domestic),
      international: Boolean(raw?.sales?.international),
      countries: normalizeCountryList(raw?.sales?.countries || []),
      currencies: normalizeCurrencyList(raw?.sales?.currencies || fallbackCurrencyList)
    },
    legacyCountries: normalizeCountryList(fallbackCountries)
  };
}



function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function getFxResearchBucket(env) {
  return env?.FX_REPORTS || env?.WEEKLY_FX_RESEARCH || env?.weeklyFxResearch || null;
}

async function getLatestFxResearchPdf(env) {
  const status = {
    attempted: true,
    found: false,
    used: false,
    bucket_binding: "",
    key: "",
    filename: "",
    size_bytes: 0,
    message: "PDF not checked yet."
  };

  try {
    const bucket = getFxResearchBucket(env);
    status.bucket_binding = env?.FX_REPORTS
      ? "FX_REPORTS"
      : env?.WEEKLY_FX_RESEARCH
        ? "WEEKLY_FX_RESEARCH"
        : env?.weeklyFxResearch
          ? "weeklyFxResearch"
          : "";

    if (!bucket) {
      status.message = "No R2 binding found. Create a Pages R2 binding named FX_REPORTS or WEEKLY_FX_RESEARCH and point it to the weekly-fx-research bucket.";
      console.warn(status.message);
      return { pdf: null, status };
    }

    let selectedKey = String(env.FX_RESEARCH_OBJECT_KEY || "").trim();

    if (!selectedKey) {
      const prefix = String(env.FX_RESEARCH_PREFIX || "").trim();
      const listed = await bucket.list({ prefix, limit: 100 });
      const pdfObjects = (listed?.objects || [])
        .filter(item => /\.pdf$/i.test(item.key || ""))
        .sort((a, b) => new Date(b.uploaded || 0) - new Date(a.uploaded || 0));

      selectedKey = pdfObjects[0]?.key || "";
    }

    if (!selectedKey) {
      status.message = "Connected to R2, but no PDF was found in the configured prefix.";
      return { pdf: null, status };
    }

    if (!/\.pdf$/i.test(selectedKey)) {
      status.key = selectedKey;
      status.message = "Configured FX research object is not a PDF.";
      return { pdf: null, status };
    }

    const object = await bucket.get(selectedKey);
    if (!object) {
      status.key = selectedKey;
      status.message = "PDF key was selected, but the object could not be read from R2.";
      return { pdf: null, status };
    }

    const size = Number(object.size || 0);
    const maxBytes = Number(env.FX_RESEARCH_MAX_BYTES || 12000000);
    status.found = true;
    status.key = selectedKey;
    status.filename = selectedKey.split("/").pop() || "weekly-fx-research.pdf";
    status.size_bytes = size;

    if (size > maxBytes) {
      status.message = `PDF found but skipped because it is ${size} bytes, above limit ${maxBytes}.`;
      console.warn(`FX research PDF ${selectedKey} skipped because it is ${size} bytes, above limit ${maxBytes}.`);
      return { pdf: null, status };
    }

    const arrayBuffer = await object.arrayBuffer();
    status.used = true;
    status.message = "PDF found in R2 and sent to OpenAI for currency-section extraction.";
    return {
      pdf: {
        key: selectedKey,
        filename: status.filename,
        fileData: `data:application/pdf;base64,${arrayBufferToBase64(arrayBuffer)}`
      },
      status
    };
  } catch (error) {
    console.error("FX research PDF retrieval failed:", error);
    status.message = `FX research PDF retrieval failed: ${error.message || "Unknown error"}`;
    return { pdf: null, status };
  }
}

function tradeFlowSummary(tradeFlow) {
  const list = countries => normalizeCountryList(countries).map(country => country.name || country.label || country.code).filter(Boolean).join(", ");
  return [
    `Purchase from: ${tradeFlow?.purchase?.domestic ? "Thailand domestic" : ""}${tradeFlow?.purchase?.domestic && tradeFlow?.purchase?.international ? "; " : ""}${tradeFlow?.purchase?.international ? list(tradeFlow.purchase.countries) || "international suppliers" : ""}`.trim(),
    `Purchase currencies: ${(tradeFlow?.purchase?.currencies || []).join(", ") || "not specified"}`,
    `Sales to: ${tradeFlow?.sales?.domestic ? "Thailand domestic" : ""}${tradeFlow?.sales?.domestic && tradeFlow?.sales?.international ? "; " : ""}${tradeFlow?.sales?.international ? list(tradeFlow.sales.countries) || "international buyers" : ""}`.trim(),
    `Sales currencies: ${(tradeFlow?.sales?.currencies || []).join(", ") || "not specified"}`
  ].join("\n");
}

async function fetchYahooSeries(pair, rangeDays = 30) {
  const safeRangeDays = [30, 90].includes(Number(rangeDays)) ? Number(rangeDays) : 30;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${pair}?interval=1d&range=${safeRangeDays}d`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`Yahoo Finance request failed for ${pair}: ${rawText.slice(0, 120)}`);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (_) {
    throw new Error(`Yahoo Finance returned invalid JSON for ${pair}: ${rawText.slice(0, 120)}`);
  }

  const result = data?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const prices = result?.indicators?.quote?.[0]?.close || [];

  return timestamps
    .map((ts, i) => {
      const rate = prices[i];
      if (typeof rate !== "number") return null;

      return {
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        rate
      };
    })
    .filter(Boolean);
}

function summarizeFxSeries({ base, pair, series, source, derivation = "" }) {
  if (!series.length) {
    throw new Error(`No usable FX points returned for ${pair}.`);
  }

  const roundedSeries = series.map(item => ({
    date: item.date,
    rate: Number(item.rate.toFixed(4))
  }));

  const latest = roundedSeries[roundedSeries.length - 1];
  const highest = roundedSeries.reduce((max, item) => item.rate > max.rate ? item : max, roundedSeries[0]);
  const lowest = roundedSeries.reduce((min, item) => item.rate < min.rate ? item : min, roundedSeries[0]);

  return {
    skip: false,
    base,
    quote: "THB",
    pair,
    series: roundedSeries,
    latest_rate: latest.rate.toFixed(4),
    highest_rate: highest.rate.toFixed(4),
    highest_date: highest.date,
    lowest_rate: lowest.rate.toFixed(4),
    lowest_date: lowest.date,
    source,
    derivation,
    retrieved_at: new Date().toISOString()
  };
}

async function fetchYahooFxRate(baseCurrency, rangeDays = 30) {
  if (baseCurrency === "THB") {
    return { skip: true, base: "THB" };
  }

  if (baseCurrency === "CNY") {
    const [usdThb, usdCny] = await Promise.all([
      fetchYahooSeries("USDTHB=X", rangeDays),
      fetchYahooSeries("USDCNY=X", rangeDays)
    ]);

    const usdCnyByDate = new Map(usdCny.map(item => [item.date, item.rate]));

    const derivedSeries = usdThb
      .map(item => {
        const cnyRate = usdCnyByDate.get(item.date);
        if (!cnyRate) return null;

        return {
          date: item.date,
          rate: item.rate / cnyRate
        };
      })
      .filter(Boolean);

    return summarizeFxSeries({
      base: "CNY",
      pair: "CNYTHB",
      series: derivedSeries,
      source: "Yahoo Finance prototype: USDTHB ÷ USDCNY",
      derivation: "Cross rate derived as USDTHB ÷ USDCNY",
      market_context_note: "Read alongside THB per USD: CNYTHB can reflect both Baht movement against USD and CNY movement against USD"
    });
  }

  const pair = `${baseCurrency}THB=X`;
  const series = await fetchYahooSeries(pair, rangeDays);

  const result = summarizeFxSeries({
    base: baseCurrency,
    pair,
    series,
    source: "Yahoo Finance (prototype)"
  });

  if (["EUR", "JPY"].includes(baseCurrency)) {
    result.market_context_note = `Read alongside THB per USD: ${baseCurrency}THB can reflect both Baht movement against USD and ${baseCurrency} movement against USD`;
  }

  return result;
}

function expandFxCurrencies(currencies) {
  const requested = [...new Set((currencies || []).map(currency => String(currency).toUpperCase()))];
  const needsUsdReference = requested.some(currency => ["CNY", "EUR", "JPY"].includes(currency));

  if (needsUsdReference && !requested.includes("USD")) {
    return ["USD", ...requested];
  }

  return requested;
}

async function fetchFxRates(currencies, rangeDays = 30) {
  const expandedCurrencies = expandFxCurrencies(currencies);

  return Promise.all(
    expandedCurrencies.map(currency =>
      fetchYahooFxRate(currency, rangeDays).catch(error => ({
        skip: false,
        base: currency,
        quote: "THB",
        error: error.message || "FX lookup failed."
      }))
    )
  );
}


function calculateFxMetrics(fx, fxTenor = 30) {
  const series = Array.isArray(fx?.series) ? fx.series : [];
  if (series.length === 0) return null;

  const rates = series
    .map(item => Number(item.rate))
    .filter(rate => Number.isFinite(rate));

  if (rates.length === 0) return null;

  const first = rates[0];
  const last = rates[rates.length - 1];
  const high = Math.max(...rates);
  const low = Math.min(...rates);
  const changePct = first ? ((last - first) / first) * 100 : 0;
  const rangePct = low ? ((high - low) / low) * 100 : 0;
  const firstDate = series[0]?.date || "";
  const lastDate = series[series.length - 1]?.date || "";

  const midpoint = (high + low) / 2;
  const latestPosition = high === low
    ? "flat range"
    : last >= midpoint
      ? "upper half of the observed range"
      : "lower half of the observed range";

  let direction = "broadly rangebound";
  if (Math.abs(changePct) >= 0.15) {
    direction = changePct > 0
      ? `${fx.base || "base currency"} strengthened against THB`
      : `${fx.base || "base currency"} weakened against THB`;
  }

  return {
    tenor_days: Number(fxTenor) || 30,
    first_date: firstDate,
    last_date: lastDate,
    first_rate: Number(first.toFixed(4)),
    latest_rate: Number(last.toFixed(4)),
    high_rate: Number(high.toFixed(4)),
    low_rate: Number(low.toFixed(4)),
    change_pct: Number(changePct.toFixed(2)),
    observed_range_pct: Number(rangePct.toFixed(2)),
    latest_position_in_range: latestPosition,
    objective_direction: direction,
    data_points: rates.length
  };
}

function extractOutputText(data) {
  if (data.output_text) return data.output_text;

  if (Array.isArray(data.output)) {
    let text = "";

    for (const item of data.output) {
      if (!item.content) continue;

      for (const contentItem of item.content) {
        if (contentItem.type === "output_text" && contentItem.text) {
          text += contentItem.text;
        }
      }
    }

    if (text) return text;
  }

  return "";
}

async function analyzeFxRates({ env, fxList, sector = "", subsector = "", industry = "", tradeRoles = [], countries = [], tradeFlow = null }) {
  const usableFx = fxList.filter(fx => !fx.skip && !fx.error && Array.isArray(fx.series) && fx.series.length > 0);

  if (usableFx.length === 0 || !env.OPENAI_API_KEY) {
    return { fx: fxList, fxResearch: null };
  }

  const compactFx = usableFx.map(fx => ({
    pair: fx.pair,
    base: fx.base,
    quote: fx.quote,
    recent_series: fx.series
  }));

  const countryText = countries.map(country => country.label || country.name || country.code).filter(Boolean).join(", ");
  const currencyList = usableFx.map(fx => fx.base).filter(Boolean);
  const internalFxResearchResult = await getLatestFxResearchPdf(env);
  const internalFxResearchPdf = internalFxResearchResult?.pdf || null;

  const prompt = `
You are preparing concise FX learning notes for relationship managers at a Thailand-based bank.

Client context:
- Sector: ${sector}
- Subsector: ${subsector}
- Specific industry: ${industry}
- Directional trade flow:
${tradeFlow ? tradeFlowSummary(tradeFlow) : `Client trade role: ${tradeRoles.join(", ")}
Exposure countries / markets: ${countryText}`}

Use the supplied 90-day FX series and the internal weekly FX research attachment if available.
For each selected currency, explain the most useful drivers of the observed movement in THB per unit of foreign currency.

Writing standard:
- Use the neutral heading "Key drivers"
- Provide 2 to 4 bullets
- Every driver must have a short boldable title and one clear explanatory sentence
- Driver titles must be specific and must not include generic section labels such as “Key drivers”, “Driver”, or “What to watch”
- Be specific about the transmission channel so the banker learns how policy rates, yields, capital flows, energy costs, trade, risk sentiment, or domestic activity can affect THB per unit of the selected currency
- Keep each driver explanation to one sentence of no more than 42 words
- Do not use vague filler such as "market uncertainty affected sentiment"
- Do not cite or name the internal analysis inside the driver bullets
- Do not claim a driver unless supported by the supplied research or clearly visible in the market series
- If evidence for a driver is weak, omit it
- Add 2 to 3 "What to watch" items. Each must have a short title and one practical sentence explaining what release, policy signal, or market indicator matters and why
- Include a specific upcoming announcement or release date only when it is stated in the supplied research or sources. Never invent a date
- For central-bank watch items, specify the guidance to monitor, such as the growth, inflation, rate-path, currency-stability, or liquidity language
- Do not make USD cross-rate mechanics the main explanation for every non-USD pair
- When EUR, JPY or CNY is selected, USDTHB is automatically included as a visible reference card
- Use USDTHB as a Thailand-side reference when it helps explain the selected cross rate, but do not imply it is the sole cause
- For each non-USD pair, distinguish clearly between (1) Baht-side movement visible in USDTHB and (2) movement in the foreign currency against USD
- For direct pairs such as JPYTHB or EURTHB, explain the THB-side and foreign-currency-side economic drivers directly. Mention USD only when it is a genuinely material transmission channel supported by the evidence
- For CNYTHB, the displayed market series is derived as USDTHB divided by USDCNY. Treat that as a data-construction note, not a key driver. Explain China-side and Thailand-side economic drivers in plain language
- For CNYTHB, prioritise China activity, PBOC policy, export demand, regional risk sentiment, and Thailand-side rates, capital flows, energy or trade factors when supported
- If the internal attachment contains a relevant currency section, return one short relevant excerpt or close paraphrase of no more than 55 words for display below the FX card. Otherwise return an empty string
- Do not forecast a precise rate

Return JSON only:
{
  "analyses": [
    {
      "pair": "USDTHB",
      "drivers": [
        { "title": "Higher US interest rates", "explanation": "..." }
      ],
      "watch_items": [
        { "title": "US CPI — date if supported", "explanation": "A stronger print could keep US yields elevated and support USD" },
        { "title": "Bank of Thailand guidance", "explanation": "Watch for changes in growth, inflation, rate-path or currency-stability language" }
      ],
      "research_excerpt": ""
    }
  ]
}

Selected currencies: ${currencyList.join(", ")}
FX series:
${JSON.stringify(compactFx, null, 2)}
`.trim();

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: env.OPENAI_FX_MODEL || env.OPENAI_ANALYSIS_MODEL || "gpt-4.1",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              ...(internalFxResearchPdf ? [{
                type: "input_file",
                filename: internalFxResearchPdf.filename,
                file_data: internalFxResearchPdf.fileData
              }] : [])
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "concise_fx_drivers",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                analyses: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      pair: { type: "string" },
                      drivers: {
                        type: "array",
                        minItems: 1,
                        maxItems: 4,
                        items: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            title: { type: "string" },
                            explanation: { type: "string" }
                          },
                          required: ["title", "explanation"]
                        }
                      },
                      watch_items: {
                        type: "array",
                        minItems: 1,
                        maxItems: 3,
                        items: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            title: { type: "string" },
                            explanation: { type: "string" }
                          },
                          required: ["title", "explanation"]
                        }
                      },
                      research_excerpt: { type: "string" }
                    },
                    required: ["pair", "drivers", "watch_items", "research_excerpt"]
                  }
                }
              },
              required: ["analyses"]
            }
          }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) return { fx: fxList, fxResearch: internalFxResearchResult?.status || null };

    const text = extractOutputText(data);
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1) return { fx: fxList, fxResearch: internalFxResearchResult?.status || null };

    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    const analysisByPair = new Map((parsed.analyses || []).map(item => [String(item.pair || "").replace(/=X$/i, ""), item]));

    const enrichedFx = fxList.map(fx => {
      const key = String(fx.pair || "").replace(/=X$/i, "");
      return { ...fx, driver_analysis: analysisByPair.get(key) || null, analysis: "" };
    });

    const researchStatus = internalFxResearchResult?.status || null;
    const excerpts = enrichedFx
      .map(fx => ({
        pair: String(fx.pair || "").replace(/=X$/i, ""),
        excerpt: String(fx.driver_analysis?.research_excerpt || "").trim()
      }))
      .filter(item => item.excerpt);

    return {
      fx: enrichedFx,
      fxResearch: researchStatus ? {
        ...researchStatus,
        url: researchStatus.key ? `/api/fx-research?key=${encodeURIComponent(researchStatus.key)}` : "",
        excerpts
      } : null
    };
  } catch (_) {
    return { fx: fxList, fxResearch: internalFxResearchResult?.status || null };
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    const legacyCurrencies = Array.isArray(body.currencies) ? body.currencies.map(c => String(c).toUpperCase()) : [];
    const legacyCountries = Array.isArray(body.countries) ? body.countries : [];
    const tradeFlow = normalizeTradeFlow(body.tradeFlow || {}, legacyCountries, legacyCurrencies);
    const currencies = [...new Set([...tradeFlow.purchase.currencies, ...tradeFlow.sales.currencies, ...normalizeCurrencyList(legacyCurrencies)])];
    const sector = (body.sector || "").trim();
    const subsector = (body.subsector || "").trim();
    const industry = (body.industry || "").trim();
    const tradeRoles = Array.isArray(body.tradeRoles)
      ? body.tradeRoles.map(role => String(role).toLowerCase()).filter(role => ["importer", "exporter"].includes(role))
      : [];
    const countries = normalizeCountryList([...tradeFlow.purchase.countries, ...tradeFlow.sales.countries, ...tradeFlow.legacyCountries]);
    const fxTenor = 90;

    if (currencies.length === 0) {
      return Response.json({ error: "Please select at least one currency." }, { status: 400 });
    }

    const unsupported = currencies.filter(currency => !ALLOWED_CURRENCIES.includes(currency));
    if (unsupported.length > 0) {
      return Response.json({ error: `Unsupported currency selected: ${unsupported.join(", ")}` }, { status: 400 });
    }

    const rawFx = await fetchFxRates(currencies, 90);
    const analyzed = await analyzeFxRates({ env, fxList: rawFx, sector, subsector, industry, tradeRoles, countries, tradeFlow, fxTenor });

    return Response.json({ fx: analyzed.fx || rawFx, fxResearch: analyzed.fxResearch || null });
  } catch (error) {
    return Response.json({
      error: error.message || "FX update failed."
    }, { status: 500 });
  }
}
