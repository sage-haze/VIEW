function getFxResearchBucket(env) {
  return env?.FX_REPORTS || env?.WEEKLY_FX_RESEARCH || env?.weeklyFxResearch || null;
}

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const bucket = getFxResearchBucket(env);
    if (!bucket) return new Response("FX research storage is not configured.", { status: 404 });

    const url = new URL(request.url);
    let key = String(url.searchParams.get("key") || env.FX_RESEARCH_OBJECT_KEY || "").trim();

    if (!key) {
      const prefix = String(env.FX_RESEARCH_PREFIX || "").trim();
      const listed = await bucket.list({ prefix, limit: 100 });
      const pdfObjects = (listed?.objects || [])
        .filter(item => /\.pdf$/i.test(item.key || ""))
        .sort((a, b) => new Date(b.uploaded || 0) - new Date(a.uploaded || 0));
      key = pdfObjects[0]?.key || "";
    }

    if (!key || !/\.pdf$/i.test(key)) {
      return new Response("FX research PDF was not found.", { status: 404 });
    }

    const object = await bucket.get(key);
    if (!object) return new Response("FX research PDF was not found.", { status: 404 });

    const filename = key.split("/").pop() || "fx-research.pdf";
    const headers = new Headers();
    object.writeHttpMetadata?.(headers);
    headers.set("Content-Type", "application/pdf");
    headers.set("Content-Disposition", `inline; filename="${filename.replace(/\"/g, "")}"`);
    headers.set("Cache-Control", "private, max-age=300");

    return new Response(object.body, { headers });
  } catch (error) {
    return new Response(error?.message || "Unable to open FX research PDF.", { status: 500 });
  }
}
