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
          recentMovement: { type: "string" },
          baselineView: { type: "string" },
          supportingFactors: { type: "array", items: { type: "string" } },
          changeFactors: { type: "array", items: { type: "string" } },
          possibleBusinessImplications: { type: "array", items: { type: "string" } },
          keyLevelsSummary: { type: "string" }
        },
        required: [
          "pair",
          "recentMovement",
          "baselineView",
          "supportingFactors",
          "changeFactors",
          "possibleBusinessImplications",
          "keyLevelsSummary"
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
    source: sourceSummary(result.report, result.source, selected.map((item) => item.pair)),
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
        cached?.schemaVersion === 1 &&
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
- Use only information actually present in the document.
- Preserve the stated date or validity period.
- Keep each currency pair separate.
- Distinguish the report's baseline view from factors that support it and factors that could change it.
- Possible business implications must remain conditional and must not become recommendations.
- Summarise levels rather than inventing missing values.
- Use an empty string or empty array where the document does not provide an item.
- Do not add current web information or your own market view.`
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
      schemaVersion: 1,
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
        schemaVersion: "1"
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
Recent movement: ${item.recentMovement || "Not stated."}
Baseline view in the report: ${item.baselineView || "Not stated."}
Supporting factors: ${(item.supportingFactors || []).join("; ") || "Not stated."}
What could change it: ${(item.changeFactors || []).join("; ") || "Not stated."}
Possible business implications: ${(item.possibleBusinessImplications || []).join("; ") || "Not stated."}
Key levels: ${item.keyLevelsSummary || "Not stated."}`).join("\n\n");

  return `APPROVED FX REPORT BACKGROUND
Title: ${header.title || "FX report"}
Publication date: ${header.publicationDate || "Not stated"}
Stated period: ${header.periodStart || "Not stated"} to ${header.periodEnd || "Not stated"}

${pairText}

Usage rules:
- Treat this as dated, approved background, not timeless fact.
- Attribute any institutional view to the report, not to yourself.
- Do not present your own inference as an official bank view.
- Do not invent figures or extend the report beyond what it says.
- Where the period has passed, state that current conditions should be checked.`;
}

function sourceSummary(report, source, pairs = []) {
  return {
    title: report?.report?.title || "FX report",
    publicationDate: report?.report?.publicationDate || "",
    periodStart: report?.report?.periodStart || "",
    periodEnd: report?.report?.periodEnd || "",
    sourceKey: source?.key || report?.source?.key || "",
    processedAt: report?.source?.processedAt || "",
    pairs
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
