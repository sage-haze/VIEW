import { getOrRefreshFxReport } from "../../_shared/fx-reports.js";
import { authoriseAdmin, errorResponse } from "../../_shared/admin-auth.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const SOURCE_PREFIX = "source/";
const PROCESSED_PREFIX = "processed/";

export async function onRequestPost({ request, env }) {
  try {
    authoriseAdmin(request, env);
    if (!env.FX_REPORTS) throw withStatus("FX_REPORTS is not configured.", 500);

    const form = await request.formData();
    const file = form.get("file");
    const processNow = form.get("processNow") !== "false";

    if (!(file instanceof File)) throw withStatus("Choose a PDF file to upload.", 400);
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      throw withStatus("Only PDF files are accepted.", 400);
    }
    if (file.size <= 0) throw withStatus("The selected PDF is empty.", 400);
    if (file.size > MAX_FILE_BYTES) {
      throw withStatus(`The PDF is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`, 413);
    }

    const safeName = sanitiseFilename(file.name);
    const newSourceKey = `${SOURCE_PREFIX}${safeName}`;
    const bytes = await file.arrayBuffer();

    // Put the new object first, then remove older report objects. This reduces
    // the chance of leaving the bucket without a source PDF if the upload fails.
    await env.FX_REPORTS.put(newSourceKey, bytes, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { uploadedBy: "fx-report-manager" }
    });

    const existing = await listAllReportObjects(env.FX_REPORTS);
    const obsolete = existing.filter((object) =>
      (object.key.startsWith(SOURCE_PREFIX) && object.key !== newSourceKey) ||
      object.key.startsWith(PROCESSED_PREFIX)
    );
    await deleteObjects(env.FX_REPORTS, obsolete.map((object) => object.key));

    let processed = null;
    if (processNow) {
      processed = await getOrRefreshFxReport({ env, allowRefresh: true, force: true });
    }

    return Response.json({
      ok: true,
      status: processNow ? processed.status : "uploaded",
      uploadedPdf: newSourceKey,
      deletedObjects: obsolete.map((object) => object.key),
      processedJson: processed?.processedKey || null,
      report: processed?.report ? {
        title: processed.report.report?.title || null,
        periodStart: processed.report.report?.periodStart || null,
        periodEnd: processed.report.report?.periodEnd || null,
        processedAt: processed.report.source?.processedAt || null
      } : null
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("FX upload error", error);
    return errorResponse(error, "Unable to upload the FX report.");
  }
}

async function listAllReportObjects(bucket) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ limit: 1000, cursor });
    objects.push(...page.objects.filter((object) =>
      object.key.startsWith(SOURCE_PREFIX) || object.key.startsWith(PROCESSED_PREFIX)
    ));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

async function deleteObjects(bucket, keys) {
  for (let index = 0; index < keys.length; index += 1000) {
    await bucket.delete(keys.slice(index, index + 1000));
  }
}

function sanitiseFilename(name) {
  const base = name.split(/[\\/]/).pop() || "fx-report.pdf";
  const withoutExtension = base.replace(/\.pdf$/i, "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "fx-report";
  return `${withoutExtension}.pdf`;
}

function withStatus(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
