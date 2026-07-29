import { getOrRefreshFxReport } from "../../_shared/fx-reports.js";

export async function onRequestPost({ request, env }) {
  try {
    authorise(request, env);
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const result = await getOrRefreshFxReport({ env, allowRefresh: true, force });

    return Response.json({
      ok: true,
      status: result.status,
      sourcePdf: result.source?.key || null,
      sourceEtag: result.source?.etag || null,
      processedJson: result.processedKey || null,
      report: result.report ? {
        title: result.report.report?.title || null,
        periodStart: result.report.report?.periodStart || null,
        periodEnd: result.report.report?.periodEnd || null,
        processedAt: result.report.source?.processedAt || null,
        extractionModel: result.report.source?.extractionModel || null
      } : null
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("FX refresh error", error);
    return Response.json({
      ok: false,
      error: error.publicMessage || error.message || "Unable to refresh the FX report.",
      diagnostics: error.diagnostics || null
    }, {
      status: error.status || 500,
      headers: { "Cache-Control": "no-store" }
    });
  }
}

export async function onRequestGet({ request, env }) {
  try {
    authorise(request, env);
    const result = await getOrRefreshFxReport({ env, allowRefresh: false });
    return Response.json({
      ok: true,
      status: result.status,
      sourcePdf: result.source?.key || null,
      sourceEtag: result.source?.etag || null,
      processedJson: result.processedKey || null,
      cachedReportAvailable: Boolean(result.report)
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error.publicMessage || error.message }, {
      status: error.status || 500,
      headers: { "Cache-Control": "no-store" }
    });
  }
}

function authorise(request, env) {
  const expected = env.FX_REFRESH_TOKEN;
  if (!expected) {
    const error = new Error("FX_REFRESH_TOKEN is not configured.");
    error.status = 500;
    throw error;
  }

  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (supplied !== expected) {
    const error = new Error("Not authorised.");
    error.status = 401;
    throw error;
  }
}
