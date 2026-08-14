# VIEW Stage 1 with approved FX reports

This version keeps approved internal guidance and current market sources as separate inputs, while making both easier for a junior banker to use.

## Required Cloudflare bindings and secrets

- `OPENAI_API_KEY` — secret
- `FX_REPORTS` — R2 bucket binding
- `FX_REFRESH_TOKEN` — secret containing a long random value

Optional model variables:

- `OPENAI_ANSWER_MODEL` — defaults to `gpt-5.6-terra`
- `OPENAI_ANALYSIS_MODEL` — defaults to `gpt-5.4-mini`
- `OPENAI_EXTRACTION_MODEL` — defaults to `OPENAI_ANALYSIS_MODEL`, then `gpt-5.4-mini`
- `OPENAI_SIMPLIFICATION_MODEL` — defaults to `OPENAI_ANALYSIS_MODEL`, then `gpt-5.4-mini`
- `OPENAI_GUIDANCE_MODEL` — defaults to `OPENAI_ANALYSIS_MODEL`, then `gpt-5.4-mini`

Create the same bindings in each Cloudflare Pages environment that you use, then redeploy.

## R2 layout

Upload exactly one current PDF to:

```text
source/<your-report-name>.pdf
```

The application writes the processed cache to:

```text
processed/<your-report-name>.json
```

Do not upload a JSON file manually. The processing workflow creates it.

## Internal guidance processing

Processed internal reports use **schema version 5**.

When a PDF is processed, the application now uses two distinct steps:

1. **Source-faithful extraction** — key sections are extracted into structured JSON without rewriting for an audience. Direction, timeframe, confidence, conditions, causal priority, dates and levels are preserved.
2. **Controlled simplification** — the extracted JSON is rewritten in clearer professional language without adding or changing meaning. Empty source fields remain empty and no new corporate implications are created.

The stored JSON keeps both representations:

```text
report                 report metadata
sourceExtract           source-faithful extracted sections
simplified              meaning-preserving simplified copy
source                   processing metadata and model names
```

Keeping both versions provides an audit trail and lets the richer source extract remain available to the VIEW answer model.

### Question-time Internal Guidance

When a learner asks a relevant FX question, the application:

1. selects only the relevant stored currency-pair sections;
2. creates a short **What this means for your question** synthesis using only those internal sections;
3. flags a material timeframe limitation explicitly when the learner's question goes beyond the report's stated horizon;
4. writes shorter supporting explanations for each selected currency pair;
5. shows the synthesis first and the pair-level detail underneath in the **Internal Guidance** panel; and
6. separately passes the richer source extract plus the stored simplified copy to the VIEW answer model.

The top synthesis may make a straightforward cross-rate inference when it follows directly from the selected internal pair views, but it must describe that as what the internal guidance *points to* or *would imply*, rather than as wording from the report. It cannot add current market facts, outside knowledge, recommendations or a new market view.

The supporting pair rows no longer need to repeat the movement sentence already shown beside the pair. They focus on the main reason and the most important condition that could support or challenge the report view. If the question-time rewriting step fails, the page falls back to the stored simplified JSON rather than dropping the internal guidance entirely.

## Market-source context

The **Market Brief** remains separate from Internal Guidance.

Current market research is written as compact source-based context for a junior corporate banker. The research prompt prioritises official institutions, central banks, regulators, recognised international organisations and reputable direct reporting. It aims to use at least two independent high-quality sources when the topic permits.

Observed facts are kept separate from the baseline outlook. Event or prediction-market signals may be used only as quiet secondary corroboration for clearly defined future events; they cannot determine the baseline or supply an observed fact, and they are not displayed as sources in the interface.

## VIEW response style

The answer prompt is centred again on a **friendly junior banker with about one to two years of experience**.

The generated response should:

- answer the client's question before asking anything;
- treat the question as a genuine invitation to share a useful thought;
- give a simple initial view;
- usually mention one main factor that could change the picture;
- explain one possible practical relevance without assuming the client's exposure or motive;
- end with one friendly, topic-specific and open question;
- sound warm, modest, professional, natural and easy to say aloud;
- avoid corrective or advisory language, premature products and research-note phrasing.

The existing source-governance safeguards remain: approved internal guidance drives the institutional FX direction when relevant, while live web context may update observed facts without being represented as an authorised bank view.

## Reference choices

The learner page offers three source modes:

- **Internal guidance and market sources** — uses relevant content from the processed R2 report and current web search. The two remain separate in the Current Context display.
- **Internal guidance only** — uses no web search. If the report does not contain a relevant currency section, the page asks the user to select another source.
- **Market sources only** — uses current web search and does not read or display the internal FX guidance.

The selected mode is preserved when the user generates another VIEW response.

## Refresh after deploying this version

Version 1.4 does **not** change the stored schema from version 1.3. If your processed report is already schema version 5, you do not need to rebuild it just for the new Internal Guidance takeaway. The synthesis is generated at question time.

If you are upgrading from schema version 4 or earlier, rebuild the processed JSON after deployment.

The easiest route is the web manager:

```text
/admin/fx-report.html
```

Choose **Force rebuild JSON** for the current report, or upload a replacement PDF and process it.

The protected endpoint remains:

```text
POST /api/admin/refresh-fx-report
Authorization: Bearer <FX_REFRESH_TOKEN>
```

To force a rebuild:

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

`/api/view` checks the R2 cache. When a relevant internal-guidance question is asked and the JSON is missing or stale, it attempts to rebuild the JSON. A manual refresh after uploading a report is still preferable because it avoids making the first learner wait for the two processing steps.

If internal processing fails in combined mode, the normal market-source VIEW response can still run and the error is shown in the page status. In internal-only mode, the page asks the learner to select another source rather than silently switching to web research.

## Health check

Open:

```text
/api/health
```

Confirm that these are true:

- `openAIKeyConfigured`
- `fxReportsConfigured`
- `fxRefreshTokenConfigured`

The health response also shows the configured answer, analysis, extraction, simplification and guidance models.

## How matching works

The cache is current only when both the source key and PDF etag match the values saved in the JSON. Replacing a PDF with a revised file under the same filename therefore triggers a rebuild.

The report is supplied to the answer model only when the question mentions a supported pair or currency, including USDTHB, EURUSD, GBPUSD, AUDUSD, USDJPY and USDCNY. Broad foreign-exchange questions can use all available pair sections.

## Web-only FX Report Manager

Open:

```text
/admin/fx-report.html
```

This page lets the site owner:

- save the `FX_REFRESH_TOKEN` in the current browser;
- check whether the source PDF and processed JSON are current;
- process or force-rebuild the existing PDF;
- upload a replacement PDF directly from the browser.

When a new PDF is uploaded through the manager, the application:

1. writes it to `source/<filename>.pdf`;
2. deletes other files under `source/`;
3. deletes prior files under `processed/`;
4. extracts the source-faithful JSON;
5. simplifies that extracted JSON without changing meaning; and
6. stores both representations in `processed/<filename>.json`.

The upload accepts PDFs up to 20 MB. Do not place the refresh token in source code. Configure it as the Cloudflare Pages secret `FX_REFRESH_TOKEN`; the manager stores the entered value only in that browser's local storage.

## Downloading the internal guidance PDF

When internal FX guidance is used, the Current Context panel shows a **Download PDF** link. The link streams the single PDF currently stored under `source/` through:

```text
/api/fx-report/download
```

Anyone who can access the deployed endpoint can download the report, so protect the site with the access controls appropriate for the internal document.
