const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_ANSWER_MODEL = "gpt-5.6-terra";

const TRANSLATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    translatedText: { type: "string" }
  },
  required: ["translatedText"]
};

export async function onRequestPost({ request, env }) {
  try {
    if (!env.OPENAI_API_KEY) {
      return json({ error: "OPENAI_API_KEY is not available to this Cloudflare Pages Function." }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const text = clean(body.text, 2400);
    if (!text) {
      return json({ error: "No response was provided for translation." }, 400);
    }

    const model = clean(env.OPENAI_ANSWER_MODEL, 120) || DEFAULT_ANSWER_MODEL;
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: "none" },
        input: [
          {
            role: "system",
            content: `Translate the supplied banker response into natural, professional Thai.
Preserve the meaning, level of caution and friendly junior-banker tone.
Use clear Thai that is comfortable to say aloud. Do not add, remove or correct substantive claims.
Do not add headings, notes, markdown, citations or explanations. Translate the final question as a natural question.`
          },
          { role: "user", content: text }
        ],
        text: {
          verbosity: "medium",
          format: {
            type: "json_schema",
            name: "thai_translation",
            strict: true,
            schema: TRANSLATION_SCHEMA
          }
        },
        max_output_tokens: 1200,
        store: false
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json({ error: data?.error?.message || `Translation failed (${response.status}).` }, response.status);
    }

    const output = outputText(data);
    const parsed = JSON.parse(output);
    return json({ translatedText: clean(parsed.translatedText, 4000) });
  } catch (error) {
    console.error("Thai translation error", error);
    return json({ error: error.message || "Unable to translate the response." }, 500);
  }
}

function outputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text.trim();
    }
  }
  throw new Error("OpenAI returned no translation text.");
}

function clean(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
