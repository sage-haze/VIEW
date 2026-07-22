export async function onRequestGet(context) {
  const { env } = context;

  return Response.json(
    {
      ok: true,
      runtime: "Cloudflare Pages Functions",
      bindings: {
        openAIKeyConfigured: Boolean(env.OPENAI_API_KEY),
        analysisModelConfigured: Boolean(env.OPENAI_ANALYSIS_MODEL)
      }
    },
    {
      headers: { "Cache-Control": "no-store" }
    }
  );
}
