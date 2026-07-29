# VIEW Stage 1 with approved FX reports

This version adds an R2-backed approved source workflow.

## Required Cloudflare bindings and secrets

- `OPENAI_API_KEY` — secret
- `FX_REPORTS` — R2 bucket binding
- `FX_REFRESH_TOKEN` — secret containing a long random value

Optional model variables:

- `OPENAI_ANSWER_MODEL` — defaults to `gpt-5.6-terra`
- `OPENAI_ANALYSIS_MODEL` — defaults to `gpt-5.4-mini`
- `OPENAI_EXTRACTION_MODEL` — defaults to `OPENAI_ANALYSIS_MODEL`, then `gpt-5.4-mini`

Create the same bindings in each Cloudflare Pages environment that you use, then redeploy.

## R2 layout

Upload exactly one current PDF to:

```
source/<your-report-name>.pdf
```

The application writes the processed cache to:

```
processed/<your-report-name>.json
```

Do not upload a JSON file manually. The refresh function creates it.

## Refresh after uploading a PDF

The protected endpoint is:

```
POST /api/admin/refresh-fx-report
Authorization: Bearer <FX_REFRESH_TOKEN>
```

Example from a terminal:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_FX_REFRESH_TOKEN" \
  https://YOUR-SITE.pages.dev/api/admin/refresh-fx-report
```

To force a rebuild even when the PDF etag matches:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_FX_REFRESH_TOKEN" \
  "https://YOUR-SITE.pages.dev/api/admin/refresh-fx-report?force=1"
```

A protected GET checks cache status without processing:

```bash
curl \
  -H "Authorization: Bearer YOUR_FX_REFRESH_TOKEN" \
  https://YOUR-SITE.pages.dev/api/admin/refresh-fx-report
```

## Automatic fallback

`/api/view` also checks the R2 cache. When a relevant FX question is asked and the JSON is missing or stale, it attempts one extraction and writes the JSON. The manual refresh endpoint is still preferable because it prevents the first learner after an upload from waiting for extraction.

If extraction fails, the normal VIEW response can still run without the approved report. The failure is logged in Cloudflare rather than exposing internal details in the learner interface.

## Health check

Open:

```
/api/health
```

Confirm that these are true:

- `openAIKeyConfigured`
- `fxReportsConfigured`
- `fxRefreshTokenConfigured`

## How matching works

The cache is considered current only when both the source key and source PDF etag match the values saved in the JSON. Replacing a PDF with a revised file under the same filename therefore triggers a rebuild.

The report is supplied to the answer model only when the question mentions a supported pair or currency, including USDTHB, EURUSD, GBPUSD, AUDUSD, USDJPY and USDCNY. Broad foreign-exchange questions can use all available pair sections.

## R2 troubleshooting

`/api/health` now lists the exact object keys visible under `source/` and `processed/`.
The PDF key must begin with `source/`, for example `source/FX Compass.pdf`.
The dashboard's folders are prefixes; creating an empty folder alone does not put the PDF inside it.

The learner endpoint now reports an extraction error in the page status instead of silently falling back to web context.
For a deliberate refresh, configure `FX_REFRESH_TOKEN` and call the admin POST endpoint.

## Web-only FX Report Manager

Open:

```
/admin/fx-report.html
```

This page is intended for the site owner. It lets you:

- save the `FX_REFRESH_TOKEN` in the current browser;
- check whether the source PDF and processed JSON are current;
- process or force-rebuild the existing PDF;
- upload a replacement PDF directly from the browser.

When a new PDF is uploaded through the manager, the application:

1. writes it to `source/<filename>.pdf`;
2. deletes other files under `source/`;
3. deletes prior files under `processed/`;
4. extracts the new PDF;
5. writes `processed/<filename>.json`.

The upload accepts PDFs up to 20 MB. Do not place the refresh token in source code. Configure it as the Cloudflare Pages secret `FX_REFRESH_TOKEN`; the manager stores the entered value only in that browser's local storage.


## Internal Guidance display

Processed reports now use schema version 2. The first request after deployment will rebuild an older cached JSON so each relevant currency pair includes a short plain-English summary for the learner-facing Internal Guidance panel.

## Alternative VIEW responses

The answer panel includes **Generate another VIEW response**. It reuses the same market brief and approved FX context, so it does not repeat the web-search step. The answer model is asked to keep the same underlying direction while using meaningfully different, junior-attainable wording. This demonstrates that VIEW is a guide rather than a fixed script.

## Downloading the internal guidance PDF

When internal FX guidance is used, the Market Brief shows a **Download PDF** link. The link streams the single PDF currently stored under `source/` through:

```text
/api/fx-report/download
```

The endpoint expects exactly one PDF under `source/`. Anyone who can access the deployed endpoint can download the report, so protect the site with the same access controls appropriate for the internal document.

## Source-faithful FX commentary schema

FX report extraction now uses schema version 3. Each currency pair is rewritten once, during PDF processing, using the corporate-market-commentary writing guide. The processed JSON also records the report's displayed movement guidance, including the source label/symbol and a normalized direction and strength.

After deploying this version, use the FX Report Manager to **Force rebuild** the current report. Existing schema-version-2 JSON will also be treated as stale and rebuilt automatically. The learner page reads `sourceFaithfulCommentary` directly rather than asking the answer model to paraphrase the report for the Internal Guidance panel.


## Reference choices

The learner page offers three source modes:

- **Internal guidance and market sources**: uses relevant content from the processed R2 report and current web search.
- **Internal guidance only**: uses no web search. If the report does not contain a relevant currency section, the page asks the user to select another source.
- **Market sources only**: uses current web search and does not read or display the internal FX guidance.

The selected mode is preserved when the user generates another VIEW response.

## Plain-language and compact interface update

- Market briefs, internal FX extraction and VIEW responses now use plain professional language for corporate finance readers who may not follow markets daily.
- Technical terms are retained only when needed for accuracy and should be explained in ordinary language.
- Optional market/region and client context fields are grouped under **Advanced settings**.
- The FX extraction schema is version 4. Use **Force rebuild** in the FX Report Manager after deployment so the current PDF is reprocessed with the updated writing guidance.
