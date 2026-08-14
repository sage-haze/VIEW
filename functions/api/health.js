export async function onRequestGet(context) {
  const { env } = context;
  let fxReports = { status: "binding-missing", sourceObjects: [], processedObjects: [] };

  if (env.FX_REPORTS) {
    try {
      const [source, processed] = await Promise.all([
        env.FX_REPORTS.list({ prefix: "source/", limit: 20 }),
        env.FX_REPORTS.list({ prefix: "processed/", limit: 20 })
      ]);
      fxReports = {
        status: "ok",
        sourceObjects: source.objects.map(objectSummary),
        processedObjects: processed.objects.map(objectSummary)
      };
    } catch (error) {
      fxReports = { status: "error", error: error.message, sourceObjects: [], processedObjects: [] };
    }
  }

  return Response.json(
    {
      ok: true,
      runtime: "Cloudflare Pages Functions",
      branch: env.CF_PAGES_BRANCH || null,
      bindings: {
        openAIKeyConfigured: Boolean(env.OPENAI_API_KEY),
        answerModel: env.OPENAI_ANSWER_MODEL || "gpt-5.6-terra",
        analysisModel: env.OPENAI_ANALYSIS_MODEL || "gpt-5.4-mini",
        extractionModel: env.OPENAI_EXTRACTION_MODEL || env.OPENAI_ANALYSIS_MODEL || "gpt-5.4-mini",
        simplificationModel: env.OPENAI_SIMPLIFICATION_MODEL || env.OPENAI_ANALYSIS_MODEL || "gpt-5.4-mini",
        guidanceModel: env.OPENAI_GUIDANCE_MODEL || env.OPENAI_ANALYSIS_MODEL || "gpt-5.4-mini",
        fxReportsConfigured: Boolean(env.FX_REPORTS),
        fxRefreshTokenConfigured: Boolean(env.FX_REFRESH_TOKEN)
      },
      fxReports
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

function objectSummary(object) {
  return {
    key: object.key,
    size: object.size,
    etag: object.etag,
    uploaded: object.uploaded?.toISOString?.() || String(object.uploaded || "")
  };
}
