export async function onRequestGet(context) {
  const apiKey = context.env.OPENAI_API_KEY;

  if (!apiKey || typeof apiKey !== "string") {
    return Response.json(
      {
        ok: false,
        stage: "cloudflare-binding",
        message: "OPENAI_API_KEY is not available to this Pages Function.",
        keyConfigured: false,
        branch: context.env.CF_PAGES_BRANCH || null
      },
      { status: 500 }
    );
  }

  try {
    // Listing models is a small authenticated request. It verifies the key
    // without generating text or exposing the secret to the browser.
    const openAIResponse = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    const requestId = openAIResponse.headers.get("x-request-id");

    if (!openAIResponse.ok) {
      let details;
      try {
        details = await openAIResponse.json();
      } catch {
        details = { message: await openAIResponse.text() };
      }

      return Response.json(
        {
          ok: false,
          stage: "openai-authentication",
          message: "Cloudflare found the key, but OpenAI rejected the request.",
          keyConfigured: true,
          openAIStatus: openAIResponse.status,
          openAIRequestId: requestId,
          details
        },
        { status: openAIResponse.status }
      );
    }

    const data = await openAIResponse.json();

    return Response.json({
      ok: true,
      stage: "complete",
      message: "Cloudflare can read OPENAI_API_KEY and OpenAI accepted it.",
      keyConfigured: true,
      openAIStatus: openAIResponse.status,
      openAIRequestId: requestId,
      modelsReturned: Array.isArray(data.data) ? data.data.length : null,
      branch: context.env.CF_PAGES_BRANCH || null
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        stage: "network-request",
        message: "The Function could not complete the request to OpenAI.",
        keyConfigured: true,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
