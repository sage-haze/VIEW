export async function onRequestGet(context) {
  return Response.json(
    {
      ok: true,
      runtime: "Cloudflare Pages Functions",
      bindings: {
        openAIKeyConfigured: Boolean(context.env?.OPENAI_API_KEY),
        analysisModelConfigured: Boolean(context.env?.OPENAI_ANALYSIS_MODEL)
      }
    },
    {
      headers: { "Cache-Control": "no-store" }
    }
  );
}
