const OPENAI_URL = "https://api.openai.com/v1/responses";
const SOURCE_PREFIX = "source/";
const PROCESSED_PREFIX = "processed/";
const DEFAULT_EXTRACTION_MODEL = "gpt-5.4-mini";
const DEFAULT_SIMPLIFICATION_MODEL = "gpt-5.4-mini";
const DEFAULT_GUIDANCE_MODEL = "gpt-5.4-mini";
const SCHEMA_VERSION = 5;

const MOVEMENT_GUIDANCE_SCHEMA = {
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
    }
  },
  required: ["sourceLabel", "symbol", "direction", "strength"]
};

const FX_REPORT_EXTRACT_SCHEMA = {
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
          movementGuidance: MOVEMENT_GUIDANCE_SCHEMA,
          marketMove: { type: "string" },
          principalDriver: { type: "string" },
          supportingDevelopments: { type: "array", items: { type: "string" } },
          domesticOrRegionalFactors: { type: "string" },
          baseCase: { type: "string" },
          confirmationConditions: { type: "array", items: { type: "string" } },
          challengeConditions: { type: "array", items: { type: "string" } },
          corporateRelevance: { type: "array", items: { type: "string" } },
          keyLevelsSummary: { type: "string" }
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
          "keyLevelsSummary"
        ]
      }
    },
    economicCalendarSummary: { type: "array", items: { type: "string" } }
  },
  required: ["report", "pairs", "economicCalendarSummary"]
};

const FX_REPORT_SIMPLIFIED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pairs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pair: { type: "string" },
          movementPlainMeaning: { type: "string" },
          marketMove: { type: "string" },
          principalDriver: { type: "string" },
          supportingDevelopments: { type: "array", items: { type: "string" } },
          domesticOrRegionalFactors: { type: "string" },
          baseCase: { type: "string" },
          confirmationConditions: { type: "array", items: { type: "string" } },
          challengeConditions: { type: "array", items: { type: "string" } },
          corporateRelevance: { type: "array", items: { type: "string" } },
          keyLevelsSummary: { type: "string" }
        },
        required: [
          "pair",
          "movementPlainMeaning",
          "marketMove",
          "principalDriver",
          "supportingDevelopments",
          "domesticOrRegionalFactors",
          "baseCase",
          "confirmationConditions",
          "challengeConditions",
          "corporateRelevance",
          "keyLevelsSummary"
        ]
      }
    },
    economicCalendarSummary: { type: "array", items: { type: "string" } }
  },
  required: ["pairs", "economicCalendarSummary"]
};

const JUNIOR_GUIDANCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    takeaway: { type: "string" },
    limitation: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pair: { type: "string" },
          summary: { type: "string" }
        },
        required: ["pair", "summary"]
      }
    }
  },
  required: ["takeaway", "limitation", "items"]
};

export async function getApprovedFxContext({ env, question, allowRefresh = true, writeForLearner = true }) {
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

  let learnerGuidance = null;
  if (writeForLearner) {
    try {
      learnerGuidance = await writeJuniorBankerGuidance({
        env,
        question,
        report: result.report,
        sections: selected
      });
    } catch (error) {
      // The stored simplified JSON is still usable if the learner-facing rewrite fails.
      console.error("Unable to create junior-banker internal guidance; using stored simplification.", error);
    }
  }

  return {
    context: formatApprovedContext(result.report, selected),
    source: sourceSummary(
      result.report,
      result.source,
      selected.map((item) => item.source.pair),
      selected,
      learnerGuidance
    ),
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
        cached?.schemaVersion === SCHEMA_VERSION &&
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

  const report = await extractSimplifyAndStore({ env, source, processedKey });
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

async function extractSimplifyAndStore({ env, source, processedKey }) {
  if (!env.OPENAI_API_KEY) {
    throw publicError("OPENAI_API_KEY is required to process the FX report.", 500);
  }

  const pdfObject = await env.FX_REPORTS.get(source.key);
  if (!pdfObject) throw publicError("The source PDF disappeared before it could be processed.", 409);

  const bytes = await pdfObject.arrayBuffer();
  const extractionModel = clean(env.OPENAI_EXTRACTION_MODEL, 120) ||
    clean(env.OPENAI_ANALYSIS_MODEL, 120) || DEFAULT_EXTRACTION_MODEL;
  const simplificationModel = clean(env.OPENAI_SIMPLIFICATION_MODEL, 120) ||
    clean(env.OPENAI_ANALYSIS_MODEL, 120) || DEFAULT_SIMPLIFICATION_MODEL;

  const filename = source.key.split("/").pop() || "fx-report.pdf";
  const uploadedFile = await uploadOpenAIFile({ env, bytes, filename });

  try {
    const extracted = await extractSourceJson({
      env,
      model: extractionModel,
      fileId: uploadedFile.id,
      sourceKey: source.key
    });

    const simplifiedCandidate = await simplifyExtractedJson({
      env,
      model: simplificationModel,
      extracted,
      sourceKey: source.key
    });
    const simplified = normaliseSimplifiedReport(extracted, simplifiedCandidate);

    const stored = {
      schemaVersion: SCHEMA_VERSION,
      source: {
        key: source.key,
        etag: source.etag,
        version: source.version,
        uploaded: source.uploaded?.toISOString?.() || String(source.uploaded || ""),
        processedAt: new Date().toISOString(),
        extractionModel,
        simplificationModel
      },
      report: extracted.report,
      sourceExtract: {
        pairs: extracted.pairs,
        economicCalendarSummary: extracted.economicCalendarSummary
      },
      simplified
    };

    await env.FX_REPORTS.put(processedKey, JSON.stringify(stored, null, 2), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        sourcePdfKey: source.key,
        sourcePdfEtag: source.etag,
        schemaVersion: String(SCHEMA_VERSION)
      }
    });

    return stored;
  } finally {
    await deleteOpenAIFile(env, uploadedFile.id);
  }
}

async function extractSourceJson({ env, model, fileId, sourceKey }) {
  return structuredOpenAI({
    env,
    model,
    name: "fx_report_source_extract",
    schema: FX_REPORT_EXTRACT_SCHEMA,
    maxOutputTokens: 7000,
    stage: "extract",
    sourceKey,
    input: [
      {
        role: "system",
        content: [{
          type: "input_text",
          text: `Extract the attached approved FX report into the required JSON structure.

This is a source-faithful extraction step, not a rewriting step.

Rules:
- Use only information actually present in the document. Do not add current web information, external facts, implications or your own market view.
- Preserve the report's stated dates, validity period, currency-pair boundaries and analytical hierarchy.
- Keep wording close to the source where practical. Do not simplify for an audience at this stage.
- Preserve direction, timeframe, degree of confidence, conditionality and causal priority. Do not strengthen or weaken the report's view.
- Distinguish what happened from the report's explanation and its forward-looking base case.
- Extract the report's displayed movement guidance exactly where possible, including words and symbols such as Flat, Mild, arrows or other labels. Store the original wording in movementGuidance.sourceLabel and the visible symbol in movementGuidance.symbol.
- Normalise that displayed guidance into direction and strength without changing its meaning. Use unclear or not-stated when it cannot be interpreted reliably.
- corporateRelevance must contain only relevance or implications actually stated in the document. Do not create new business implications.
- keyLevelsSummary must contain only levels actually supplied by the report. Do not calculate or invent missing levels.
- Use an empty string or empty array where the document does not provide an item.`
        }]
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Extract the key sections of this document for faithful internal storage." },
          { type: "input_file", file_id: fileId }
        ]
      }
    ]
  });
}

async function simplifyExtractedJson({ env, model, extracted, sourceKey }) {
  return structuredOpenAI({
    env,
    model,
    name: "fx_report_simplified",
    schema: FX_REPORT_SIMPLIFIED_SCHEMA,
    maxOutputTokens: 6500,
    stage: "simplify",
    sourceKey,
    input: [
      {
        role: "system",
        content: `Simplify the language in the supplied extracted FX-report JSON without changing its meaning.

This is controlled simplification for storage. It is not a fresh analysis and it is not client-facing copy.

Rules:
- Use only the supplied JSON. Do not add outside facts, current information, new implications or recommendations.
- Preserve every currency pair and keep fields aligned with the same pair.
- Preserve direction, timeframe, degree of confidence, conditionality, causal priority and distinctions between observed facts and the report's outlook.
- Do not turn an observation into a forecast, a possibility into a certainty, or a secondary factor into the main driver.
- Keep numbers, dates, thresholds and levels unchanged.
- Replace unnecessary market shorthand, trader expressions and compressed research wording with familiar professional language.
- Keep a technical term when it adds necessary precision; explain it briefly in ordinary words rather than deleting the concept.
- Shorten repetition and split dense wording where useful, but do not omit a qualification that changes the meaning.
- movementPlainMeaning should explain the stored movement direction in one short sentence without adding an inference.
- corporateRelevance must remain empty when the source extraction was empty. Do not manufacture a business implication.
- If a source field is empty, keep the corresponding simplified field empty.`
      },
      {
        role: "user",
        content: `SOURCE-FAITHFUL EXTRACTED JSON:\n${JSON.stringify(extracted)}`
      }
    ]
  });
}

async function writeJuniorBankerGuidance({ env, question, report, sections }) {
  if (!env.OPENAI_API_KEY) return null;

  const model = clean(env.OPENAI_GUIDANCE_MODEL, 120) ||
    clean(env.OPENAI_ANALYSIS_MODEL, 120) || DEFAULT_GUIDANCE_MODEL;

  const payload = sections.map(({ source, simplified }) => ({
    pair: source.pair,
    movementGuidance: source.movementGuidance,
    sourceExtract: source,
    simplified: simplified || null
  }));

  const result = await structuredOpenAI({
    env,
    model,
    name: "junior_banker_internal_guidance",
    schema: JUNIOR_GUIDANCE_SCHEMA,
    maxOutputTokens: 1800,
    stage: "junior-guidance",
    sourceKey: report?.source?.key || "",
    reasoningEffort: "low",
    input: [
      {
        role: "system",
        content: `Write a compact Internal Guidance explanation for a junior corporate banker with about one to two years of experience.

The supplied JSON has already been extracted from an approved report and simplified without changing its meaning. Your job is to help the banker understand what the selected internal material means for the user's question, while keeping the underlying report views and any synthesis clearly distinct.

Rules for the top takeaway:
- Use only the supplied stored JSON. Do not add current market facts, outside knowledge or a new market view.
- The first sentence must answer the user's question as directly as the selected internal guidance permits.
- If more than one supplied currency pair is needed, you may state a simple directional implication that follows directly from those supplied views. Make clear that this is what the selected internal guidance "points to" or "would imply"; do not present the cross-rate inference as wording from the report itself.
- Give only the main reason needed to understand the conclusion. Do not repeat all the supporting drivers.
- If the user's requested horizon is materially longer or otherwise different from the report's stated period, limitation must say so plainly. For example, a short-dated report must not be presented as a six-month forecast.
- If the stored material cannot answer the question directly, say that directly rather than stretching the source.
- Keep takeaway to one or two short sentences, normally no more than 55 words. If limitation is non-empty, do not repeat that caveat in takeaway.
- Keep limitation to one short sentence or return an empty string when there is no material source limitation to flag.

Rules for the supporting pair items:
- Preserve the report's direction, timeframe, uncertainty, conditions and causal priorities. Use sourceExtract to resolve any ambiguity; simplified is only a language aid.
- Do not imply that the dated report is more current than its stated period.
- Use plain professional language. Replace market shorthand with ordinary wording and briefly explain any necessary technical term.
- The interface already shows each pair's movement guidance separately. Do not repeat that movement sentence in the summary. Instead explain the main reason and the single most important condition or development that could support or challenge it.
- Keep cross-pair or question-specific synthesis in takeaway, not inside an individual pair summary.
- Mention a business implication only if it exists in the stored source. Phrase it as possible relevance, not as a fact about the client.
- Do not give advice, recommend a product, write a client script or add a final question.
- Keep each pair's summary concise, normally about 40–75 words in one short paragraph.
- Return one item for each supplied currency pair and keep the pair code unchanged.`
      },
      {
        role: "user",
        content: `USER QUESTION:\n${clean(question, 1800)}\n\nREPORT PERIOD:\n${report?.report?.periodStart || "Not stated"} to ${report?.report?.periodEnd || "Not stated"}\n\nSTORED INTERNAL JSON:\n${JSON.stringify(payload)}`
      }
    ]
  });

  return result && typeof result === "object" ? result : null;
}

async function structuredOpenAI({
  env,
  model,
  name,
  schema,
  input,
  maxOutputTokens,
  stage,
  sourceKey,
  reasoningEffort = "low"
}) {
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: reasoningEffort },
      input,
      text: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name,
          strict: true,
          schema
        }
      },
      max_output_tokens: maxOutputTokens,
      store: false
    })
  });

  const data = await response.json().catch(() => ({}));
  const requestId = response.headers.get("x-request-id");
  if (!response.ok) {
    const error = publicError(
      data?.error?.message || `OpenAI ${stage} failed with status ${response.status}.`,
      response.status
    );
    error.diagnostics = {
      stage: `${stage}-response`,
      requestId,
      code: data?.error?.code || null,
      type: data?.error?.type || null,
      sourceKey,
      model
    };
    throw error;
  }

  try {
    return JSON.parse(outputText(data));
  } catch (cause) {
    const error = publicError(`The FX report ${stage} step returned JSON that could not be parsed.`, 502);
    error.diagnostics = {
      stage: `parse-${stage}`,
      requestId,
      sourceKey,
      model,
      cause: cause?.message || String(cause)
    };
    throw error;
  }
}

function normaliseSimplifiedReport(extracted, simplified) {
  const simpleByPair = new Map(
    (Array.isArray(simplified?.pairs) ? simplified.pairs : []).map((item) => [pairCode(item?.pair), item])
  );

  return {
    pairs: (Array.isArray(extracted?.pairs) ? extracted.pairs : []).map((source) => {
      const simple = simpleByPair.get(pairCode(source.pair)) || {};
      return {
        pair: source.pair,
        movementPlainMeaning: clean(simple.movementPlainMeaning, 320),
        marketMove: simplifyStringField(source.marketMove, simple.marketMove, 1400),
        principalDriver: simplifyStringField(source.principalDriver, simple.principalDriver, 1400),
        supportingDevelopments: simplifyArrayField(source.supportingDevelopments, simple.supportingDevelopments),
        domesticOrRegionalFactors: simplifyStringField(source.domesticOrRegionalFactors, simple.domesticOrRegionalFactors, 1600),
        baseCase: simplifyStringField(source.baseCase, simple.baseCase, 1600),
        confirmationConditions: simplifyArrayField(source.confirmationConditions, simple.confirmationConditions),
        challengeConditions: simplifyArrayField(source.challengeConditions, simple.challengeConditions),
        corporateRelevance: simplifyArrayField(source.corporateRelevance, simple.corporateRelevance),
        keyLevelsSummary: simplifyStringField(source.keyLevelsSummary, simple.keyLevelsSummary, 1000)
      };
    }),
    economicCalendarSummary: cleanArray(
      simplified?.economicCalendarSummary,
      extracted?.economicCalendarSummary
    )
  };
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
  const sourcePairs = Array.isArray(report?.sourceExtract?.pairs) ? report.sourceExtract.pairs : [];
  const simplifiedPairs = Array.isArray(report?.simplified?.pairs) ? report.simplified.pairs : [];
  const simpleByPair = new Map(simplifiedPairs.map((item) => [pairCode(item?.pair), item]));
  const selected = [];

  const aliases = {
    USDTHB: ["USDTHB", "USD THB", "DOLLAR BAHT", "BAHT", "THB"],
    EURUSD: ["EURUSD", "EUR USD", "EURO DOLLAR", "EURO", "EUR"],
    GBPUSD: ["GBPUSD", "GBP USD", "STERLING DOLLAR", "POUND", "STERLING", "GBP"],
    AUDUSD: ["AUDUSD", "AUD USD", "AUSTRALIAN DOLLAR", "AUSSIE", "AUD"],
    USDJPY: ["USDJPY", "USD JPY", "DOLLAR YEN", "YEN", "JPY"],
    USDCNY: ["USDCNY", "USD CNY", "DOLLAR YUAN", "YUAN", "RENMINBI", "RMB", "CNY"]
  };

  for (const pair of sourcePairs) {
    const code = pairCode(pair.pair);
    const terms = aliases[code] || [code];
    if (terms.some((term) => text.includes(term))) {
      selected.push({ source: pair, simplified: simpleByPair.get(code) || null });
    }
  }

  const isBroadFx = /\b(FX|FOREIGN EXCHANGE|EXCHANGE RATE|CURRENC(Y|IES))\b/.test(text);
  if (!selected.length && isBroadFx && sourcePairs.length <= 6) {
    return sourcePairs.map((source) => ({
      source,
      simplified: simpleByPair.get(pairCode(source.pair)) || null
    }));
  }
  return selected.slice(0, 3);
}

function formatApprovedContext(report, sections) {
  const header = report.report || {};
  const pairText = sections.map(({ source, simplified }) => `PAIR: ${source.pair}
Displayed movement guidance: ${source.movementGuidance?.sourceLabel || "Not stated."}
Normalised direction: ${source.movementGuidance?.direction || "unclear"}; strength: ${source.movementGuidance?.strength || "not-stated"}
Stored plain-language meaning: ${simplified?.movementPlainMeaning || "Not stated."}

SOURCE-FAITHFUL EXTRACT
Market move: ${source.marketMove || "Not stated."}
Principal driver: ${source.principalDriver || "Not stated."}
Supporting developments: ${(source.supportingDevelopments || []).join("; ") || "Not stated."}
Domestic or regional factors: ${source.domesticOrRegionalFactors || "Not stated."}
Base case in the report: ${source.baseCase || "Not stated."}
What would confirm it: ${(source.confirmationConditions || []).join("; ") || "Not stated."}
What would challenge it: ${(source.challengeConditions || []).join("; ") || "Not stated."}
Corporate relevance stated by the report: ${(source.corporateRelevance || []).join("; ") || "Not stated."}
Key levels: ${source.keyLevelsSummary || "Not stated."}

STORED SIMPLIFIED COPY
Market move: ${simplified?.marketMove || "Not stated."}
Principal driver: ${simplified?.principalDriver || "Not stated."}
Supporting developments: ${(simplified?.supportingDevelopments || []).join("; ") || "Not stated."}
Domestic or regional factors: ${simplified?.domesticOrRegionalFactors || "Not stated."}
Base case: ${simplified?.baseCase || "Not stated."}
What would confirm it: ${(simplified?.confirmationConditions || []).join("; ") || "Not stated."}
What would challenge it: ${(simplified?.challengeConditions || []).join("; ") || "Not stated."}
Corporate relevance stated by the report: ${(simplified?.corporateRelevance || []).join("; ") || "Not stated."}
Key levels: ${simplified?.keyLevelsSummary || "Not stated."}`).join("\n\n");

  return `INTERNAL FX GUIDANCE
Title: ${header.title || "FX report"}
Publication date: ${header.publicationDate || "Not stated"}
Stated period: ${header.periodStart || "Not stated"} to ${header.periodEnd || "Not stated"}

${pairText}

Usage rules:
- This is approved internal background. Keep its direction, timeframe, conditions and causal story faithful to the stored source extract.
- Use the source-faithful extract to resolve any ambiguity; the simplified copy is only a language aid.
- Treat a dated report view as conditional within its stated period. Do not imply that it is current beyond that period.
- Do not present your own inference or current web information as an authorised institutional view.
- Do not invent figures, implications or recommendations.`;
}

function sourceSummary(report, source, pairs = [], sections = [], learnerGuidance = null) {
  const learnerItems = Array.isArray(learnerGuidance)
    ? learnerGuidance
    : (Array.isArray(learnerGuidance?.items) ? learnerGuidance.items : []);
  const guidanceByPair = new Map(
    learnerItems.map((item) => [pairCode(item?.pair), clean(item?.summary, 1800)])
  );

  const guidanceItems = sections
    .map(({ source: section, simplified }) => {
      const summary = guidanceByPair.get(pairCode(section?.pair)) || buildStoredSummary(simplified, section);
      return {
        pair: clean(section?.pair || "", 20),
        movementGuidance: {
          sourceLabel: clean(section?.movementGuidance?.sourceLabel || "", 60),
          symbol: clean(section?.movementGuidance?.symbol || "", 12),
          direction: clean(section?.movementGuidance?.direction || "unclear", 20),
          strength: clean(section?.movementGuidance?.strength || "not-stated", 20),
          plainMeaning: clean(simplified?.movementPlainMeaning || "", 320)
        },
        summary
      };
    })
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
    takeaway: clean(learnerGuidance?.takeaway || "", 900),
    limitation: clean(learnerGuidance?.limitation || "", 600),
    guidanceItems,
    backgroundSummary
  };
}

function buildStoredSummary(simplified, source) {
  const item = simplified || source || {};
  const parts = [
    item.baseCase,
    item.principalDriver ? `Main reason: ${item.principalDriver}` : "",
    Array.isArray(item.challengeConditions) && item.challengeConditions.length
      ? `What could challenge it: ${item.challengeConditions.slice(0, 2).join("; ")}`
      : ""
  ].filter(Boolean);
  return clean(parts.join(" "), 1800);
}

function pairCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z]/g, "");
}

function simplifyStringField(sourceValue, simplifiedValue, maxLength) {
  const source = clean(sourceValue, maxLength);
  if (!source) return "";
  return clean(simplifiedValue, maxLength) || source;
}

function simplifyArrayField(sourceValue, simplifiedValue) {
  const source = cleanArray(sourceValue);
  if (!source.length) return [];
  const simplified = cleanArray(simplifiedValue);
  return simplified.length ? simplified : source;
}

function cleanArray(primary, fallback = []) {
  const source = Array.isArray(primary) ? primary : Array.isArray(fallback) ? fallback : [];
  return source.map((item) => clean(item, 1200)).filter(Boolean).slice(0, 20);
}

function jsonKeyForPdf(pdfKey) {
  const filename = pdfKey.split("/").pop() || "fx-report.pdf";
  return `${PROCESSED_PREFIX}${filename.replace(/\.pdf$/i, ".json")}`;
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
