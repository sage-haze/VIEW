const OPENAI_URL = "https://api.openai.com/v1/responses";
const SOURCE_PREFIX = "source/";
const PROCESSED_PREFIX = "processed/";
const DEFAULT_EXTRACTION_MODEL = "gpt-5.4-mini";

const FX_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    report: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        periodStart: { type: "string" },
        periodEnd: { type: "string" },
        publicationDate: { type: "string" },
        disclaimerSummary: { type: "string" }
      },
      required: ["title", "periodStart", "periodEnd", "publicationDate", "disclaimerSummary"]
    },
    pairs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pair: { type: "string" },
          movementGuidance: {
            type: "object",
            additionalProperties: false,
            properties: {
              sourceLabel: { type: "string" },
              symbol: { type: "string" },
              direction: {
                type: "string",
                enum: ["up", "down", "flat", "mixed", "unclear"]
              },
              strength: {
                type: "string",
                enum: ["strong", "moderate", "mild", "flat", "not-stated"]
              },
              plainMeaning: { type: "string" }
            },
            required: ["sourceLabel", "symbol", "direction", "strength", "plainMeaning"]
          },
          marketMove: { type: "string" },
          principalDriver: { type: "string" },
          supportingDevelopments: { type: "array", items: { type: "string" } },
          domesticOrRegionalFactors: { type: "string" },
          baseCase: { type: "string" },
          confirmationConditions: { type: "array", items: { type: "string" } },
          challengeConditions: { type: "array", items: { type: "string" } },
          corporateRelevance: { type: "array", items: { type: "string" } },
          keyLevelsSummary: { type: "string" },
          sourceFaithfulCommentary: { type: "string" }
        },
        required: [
          "pair",
          "movementGuidance",
          "marketMove",
          "principalDriver",
          "supportingDevelopments",
          "domesticOrRegionalFactors",
          "baseCase",
          "confirmationConditions",
          "challengeConditions",
          "corporateRelevance",
          "keyLevelsSummary",
          "sourceFaithfulCommentary"
        ]
      }
    },
    economicCalendarSummary: { type: "array", items: { type: "string" } }
  },
  required: ["report", "pairs", "economicCalendarSummary"]
};

export async function getApprovedFxContext({ env, question, allowRefresh = true }) {
  if (!env.FX_REPORTS) {
    return { context: null, source: null, cacheStatus: "binding-missing" };
  }

  const result = await getOrRefreshFxReport({ env, allowRefresh });
  if (!result.report) {
    return { context: null, source: result.source || null, cacheStatus: result.status };
  }

  const selected = selectRelevantSections(question, result.report);
  if (!selected.length) {
    return {
      context: null,
      source: sourceSummary(result.report, result.source),
      cacheStatus: result.status
    };
  }

  return {
    context: formatApprovedContext(result.report, selected),
    source: sourceSummary(result.report, result.source, selected.map((item) => item.pair), selected),
    cacheStatus: result.status
  };
}

export async function getOrRefreshFxReport({ env, allowRefresh = true, force = false }) {
  if (!env.FX_REPORTS) {
    throw publicError("FX_REPORTS is not available to this Pages Function.", 500);
  }

  const source = await findSinglePdf(env.FX_REPORTS);
  if (!source) {
    return { status: "no-source-pdf", report: null, source: null, processedKey: null };
  }

  const processedKey = jsonKeyForPdf(source.key);
  const cachedObject = await env.FX_REPORTS.get(processedKey);

  if (cachedObject && !force) {
    try {
      const cached = await cachedObject.json();
      if (
        cached?.schemaVersion === 3 &&
        cached?.source?.key === source.key &&
        cached?.source?.etag === source.etag
      ) {
        return { status: "already-current", report: cached, source, processedKey };
      }
    } catch (error) {
      console.warn("Ignoring unreadable FX report cache", error);
    }
  }

  if (!allowRefresh) {
    return { status: "cache-missing-or-stale", report: null, source, processedKey };
  }

  const report = await extractAndStore({ env, source, processedKey });
  return { status: cachedObject ? "refreshed" : "created", report, source, processedKey };
}

async function findSinglePdf(bucket) {
  const listed = await bucket.list({ prefix: SOURCE_PREFIX, limit: 20 });
  const pdfs = listed.objects.filter((object) => object.key.toLowerCase().endsWith(".pdf"));

  if (pdfs.length === 0) return null;
  if (pdfs.length > 1) {
    throw publicError(
      `Expected one PDF in ${SOURCE_PREFIX}, but found ${pdfs.length}. Keep only one current report there.`,
      409
    );
  }
  return pdfs[0];
}

async function extractAndStore({ env, source, processedKey }) {
  if (!env.OPENAI_API_KEY) {
    throw publicError("OPENAI_API_KEY is required to process the FX report.", 500);
  }

  const pdfObject = await env.FX_REPORTS.get(source.key);
  if (!pdfObject) throw publicError("The source PDF disappeared before it could be processed.", 409);

  const bytes = await pdfObject.arrayBuffer();
  const model = clean(env.OPENAI_EXTRACTION_MODEL, 120) ||
    clean(env.OPENAI_ANALYSIS_MODEL, 120) || DEFAULT_EXTRACTION_MODEL;

  // Upload the PDF first instead of embedding a large base64 string in the
  // Responses request. This is more reliable in Pages Functions and makes
  // extraction failures easier to diagnose.
  const filename = source.key.split("/").pop() || "fx-report.pdf";
  const uploadedFile = await uploadOpenAIFile({ env, bytes, filename });

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: `Extract the attached approved FX report into the required JSON structure.

Rules:
- Use only information actually present in the document. Do not add current web information, external facts or your own market view.
- Preserve the stated date or validity period and keep each currency pair separate.
- Rewrite each pair in the voice of an experienced treasury adviser explaining the market to a corporate finance reader.
- Lead with the market conclusion: what moved, in which direction and the main cause.
- Rank drivers by importance. Clearly separate the principal driver from supporting, domestic and regional factors.
- Keep one main idea per sentence. Prefer direct causal wording and avoid decorative market language.
- Retain technical terms only when they add precision, such as yield differentials, core inflation, hedging demand and monetary easing. Replace trading shorthand such as caught a bid, did the heavy lifting, hawkish read, high-beta, fade, relief rally and repricing.
- Separate observation, interpretation and outlook. State the base case directly, then identify what would confirm it and what would challenge it.
- Keep corporate implications conditional and informative. Do not turn them into a transaction or hedging recommendation.
- sourceFaithfulCommentary should be concise but not compressed, normally 90–160 words in two or three short paragraphs. Preserve the source's analytical hierarchy, events, causal links and direction. Remove repetition and low-priority calendar detail rather than combining too many ideas.
- Extract the report's displayed movement guidance exactly where possible, including words and symbols such as Flat, Mild, arrows or other labels. Store the original wording in movementGuidance.sourceLabel and the visible symbol in movementGuidance.symbol.
- Normalise the displayed guidance into direction and strength without changing its meaning. Use unclear or not-stated when the display cannot be interpreted reliably.
- movementGuidance.plainMeaning should explain what the displayed direction means for the quoted currency pair in one short sentence. Do not infer beyond the source.
- Summarise levels rather than inventing missing values. Use an empty string or empty array where the document does not provide an item.`
              }
            ]
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: "Process this document for use as an approved background source." },
              { type: "input_file", file_id: uploadedFile.id }
            ]
          }
        ],
        text: {
          verbosity: "medium",
          format: {
            type: "json_schema",
            name: "fx_report",
            strict: true,
            schema: FX_REPORT_SCHEMA
          }
        },
        max_output_tokens: 7000,
        store: false
      })
    });

    const data = await response.json().catch(() => ({}));
    const requestId = response.headers.get("x-request-id");
    if (!response.ok) {
      const error = publicError(
        data?.error?.message || `OpenAI extraction failed with status ${response.status}.`,
        response.status
      );
      error.diagnostics = {
        stage: "extract-response",
        requestId,
        code: data?.error?.code || null,
        type: data?.error?.type || null,
        sourceKey: source.key,
        extractionModel: model
      };
      throw error;
    }

    let extracted;
    try {
      extracted = JSON.parse(outputText(data));
    } catch (cause) {
      const error = publicError("The FX report was read, but the structured JSON could not be parsed.", 502);
      error.diagnostics = {
        stage: "parse-extraction",
        requestId,
        sourceKey: source.key,
        extractionModel: model,
        cause: cause?.message || String(cause)
      };
      throw error;
    }

    const stored = {
      schemaVersion: 3,
      source: {
        key: source.key,
        etag: source.etag,
        version: source.version,
        uploaded: source.uploaded?.toISOString?.() || String(source.uploaded || ""),
        processedAt: new Date().toISOString(),
        extractionModel: model
      },
      ...extracted
    };

    await env.FX_REPORTS.put(processedKey, JSON.stringify(stored, null, 2), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        sourcePdfKey: source.key,
        sourcePdfEtag: source.etag,
        schemaVersion: "3"
      }
    });

    return stored;
  } finally {
    await deleteOpenAIFile(env, uploadedFile.id);
  }
}

async function uploadOpenAIFile({ env, bytes, filename }) {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);

  const response = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) {
    const error = publicError(
      data?.error?.message || `OpenAI file upload failed with status ${response.status}.`,
      response.status || 502
    );
    error.diagnostics = {
      stage: "upload-pdf",
      requestId: response.headers.get("x-request-id"),
      code: data?.error?.code || null,
      type: data?.error?.type || null,
      filename
    };
    throw error;
  }
  return data;
}

async function deleteOpenAIFile(env, fileId) {
  if (!fileId) return;
  try {
    await fetch(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }
    });
  } catch (error) {
    console.warn("Unable to delete temporary OpenAI file", error);
  }
}

function selectRelevantSections(question, report) {
  const text = clean(question, 2000).toUpperCase().replace(/[^A-Z0-9]+/g, " ");
  const pairs = Array.isArray(report?.pairs) ? report.pairs : [];
  const selected = [];

  const aliases = {
    USDTHB: ["USDTHB", "USD THB", "DOLLAR BAHT", "BAHT", "THB"],
    EURUSD: ["EURUSD", "EUR USD", "EURO DOLLAR", "EURO", "EUR"],
    GBPUSD: ["GBPUSD", "GBP USD", "STERLING DOLLAR", "POUND", "STERLING", "GBP"],
    AUDUSD: ["AUDUSD", "AUD USD", "AUSTRALIAN DOLLAR", "AUSSIE", "AUD"],
    USDJPY: ["USDJPY", "USD JPY", "DOLLAR YEN", "YEN", "JPY"],
    USDCNY: ["USDCNY", "USD CNY", "DOLLAR YUAN", "YUAN", "RENMINBI", "RMB", "CNY"]
  };

  for (const pair of pairs) {
    const code = String(pair.pair || "").toUpperCase().replace(/[^A-Z]/g, "");
    const terms = aliases[code] || [code];
    if (terms.some((term) => text.includes(term))) selected.push(pair);
  }

  const isBroadFx = /\b(FX|FOREIGN EXCHANGE|EXCHANGE RATE|CURRENC(Y|IES))\b/.test(text);
  if (!selected.length && isBroadFx && pairs.length <= 6) return pairs;
  return selected.slice(0, 3);
}

function formatApprovedContext(report, sections) {
  const header = report.report || {};
  const pairText = sections.map((item) => `PAIR: ${item.pair}
Displayed movement guidance: ${item.movementGuidance?.sourceLabel || "Not stated."}
Normalised direction: ${item.movementGuidance?.direction || "unclear"}; strength: ${item.movementGuidance?.strength || "not-stated"}
Plain meaning: ${item.movementGuidance?.plainMeaning || "Not stated."}
Market move: ${item.marketMove || "Not stated."}
Principal driver: ${item.principalDriver || "Not stated."}
Supporting developments: ${(item.supportingDevelopments || []).join("; ") || "Not stated."}
Domestic or regional factors: ${item.domesticOrRegionalFactors || "Not stated."}
Base case in the report: ${item.baseCase || "Not stated."}
What would confirm it: ${(item.confirmationConditions || []).join("; ") || "Not stated."}
What would challenge it: ${(item.challengeConditions || []).join("; ") || "Not stated."}
Possible corporate relevance: ${(item.corporateRelevance || []).join("; ") || "Not stated."}
Key levels: ${item.keyLevelsSummary || "Not stated."}`).join("\n\n");

  return `INTERNAL FX GUIDANCE
Title: ${header.title || "FX report"}
Publication date: ${header.publicationDate || "Not stated"}
Stated period: ${header.periodStart || "Not stated"} to ${header.periodEnd || "Not stated"}

${pairText}

Usage rules:
- Use this internal guidance as the primary source for the FX direction and analytical explanation.
- Keep the direction and causal story consistent with the report.
- Attribute any institutional view to the report, not to yourself.
- Do not present your own inference as an official bank view.
- Do not invent figures or extend the report beyond what it says.`;
}

function sourceSummary(report, source, pairs = [], sections = []) {
  const guidanceItems = sections
    .map((section) => ({
      pair: clean(section?.pair || "", 20),
      movementGuidance: {
        sourceLabel: clean(section?.movementGuidance?.sourceLabel || "", 60),
        symbol: clean(section?.movementGuidance?.symbol || "", 12),
        direction: clean(section?.movementGuidance?.direction || "unclear", 20),
        strength: clean(section?.movementGuidance?.strength || "not-stated", 20),
        plainMeaning: clean(section?.movementGuidance?.plainMeaning || "", 240)
      },
      summary: clean(
        section?.sourceFaithfulCommentary || section?.baseCase || section?.marketMove || "",
        1400
      )
    }))
    .filter((item) => item.pair && item.summary);

  const backgroundSummary = guidanceItems
    .map((item) => `${item.pair}: ${item.summary}`)
    .join(" ");

  return {
    title: report?.report?.title || "FX report",
    publicationDate: report?.report?.publicationDate || "",
    periodStart: report?.report?.periodStart || "",
    periodEnd: report?.report?.periodEnd || "",
    sourceKey: source?.key || report?.source?.key || "",
    processedAt: report?.source?.processedAt || "",
    pairs,
    guidanceItems,
    backgroundSummary
  };
}

function jsonKeyForPdf(pdfKey) {
  const filename = pdfKey.split("/").pop() || "fx-report.pdf";
  return `${PROCESSED_PREFIX}${filename.replace(/\.pdf$/i, ".json")}`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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
  if (parts.length) return parts.join("\n").trim();
  throw publicError("OpenAI returned no structured text while processing the FX report.", 502);
}

function clean(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function publicError(message, status = 500) {
  const error = new Error(message);
  error.publicMessage = message;
  error.status = status;
  return error;
}
