import { getOrRefreshFxReport } from "../../_shared/fx-reports.js";
import { authoriseAdmin, errorResponse } from "../../_shared/admin-auth.js";

export async function onRequestPost({ request, env }) {
  try {
    authoriseAdmin(request, env);
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";
    const result = await getOrRefreshFxReport({ env, allowRefresh: true, force });

    return Response.json({
      ok: true,
      status: result.status,
      sourcePdf: result.source?.key || null,
      sourceEtag: result.source?.etag || null,
      processedJson: result.processedKey || null,
      report: reportSummary(result.report)
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("FX refresh error", error);
    return errorResponse(error, "Unable to refresh the FX report.");
  }
}

export async function onRequestGet({ request, env }) {
  try {
    authoriseAdmin(request, env);
    const result = await getOrRefreshFxReport({ env, allowRefresh: false });
    return Response.json({
      ok: true,
      status: result.status,
      sourcePdf: result.source?.key || null,
      sourceEtag: result.source?.etag || null,
      processedJson: result.processedKey || null,
      cachedReportAvailable: Boolean(result.report),
      report: reportSummary(result.report)
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Unable to check the FX report status.");
  }
}

function reportSummary(report) {
  if (!report) return null;
  return {
    title: report.report?.title || null,
    periodStart: report.report?.periodStart || null,
    periodEnd: report.report?.periodEnd || null,
    publicationDate: report.report?.publicationDate || null,
    processedAt: report.source?.processedAt || null,
    extractionModel: report.source?.extractionModel || null,
    simplificationModel: report.source?.simplificationModel || null
  };
}
