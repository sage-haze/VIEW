const SOURCE_PREFIX = "source/";

export async function onRequestGet({ env }) {
  if (!env.FX_REPORTS) {
    return json({ error: "FX_REPORTS binding is not configured." }, 500);
  }

  const listed = await env.FX_REPORTS.list({ prefix: SOURCE_PREFIX, limit: 20 });
  const pdfs = listed.objects.filter((item) => item.key.toLowerCase().endsWith(".pdf"));

  if (pdfs.length === 0) {
    return json({ error: "No FX guidance PDF was found." }, 404);
  }
  if (pdfs.length > 1) {
    return json({ error: "More than one FX guidance PDF was found." }, 409);
  }

  const object = await env.FX_REPORTS.get(pdfs[0].key);
  if (!object) return json({ error: "The FX guidance PDF could not be read." }, 404);

  const filename = safeFilename(pdfs[0].key.split("/").pop() || "fx-guidance.pdf");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Cache-Control", "private, max-age=300");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);

  return new Response(object.body, { headers });
}

function safeFilename(value) {
  return String(value).replace(/["\\\r\n]/g, "_");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
