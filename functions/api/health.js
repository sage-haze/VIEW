export async function onRequestGet(context) {
  const { env } = context;

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
        fxReportsConfigured: Boolean(env.FX_REPORTS),
        fxRefreshTokenConfigured: Boolean(env.FX_REFRESH_TOKEN)
      }
    },
    {
      headers: { "Cache-Control": "no-store" }
    }
  );
}
