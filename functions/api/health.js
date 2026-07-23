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
        analysisModel: env.OPENAI_ANALYSIS_MODEL || "gpt-5.4-mini"
      }
    },
    {
      headers: { "Cache-Control": "no-store" }
    }
  );
}
