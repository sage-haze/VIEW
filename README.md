# VIEW Conversation Coach — improved version

This version keeps the working Cloudflare Pages/OpenAI setup and improves the
quality and presentation of the generated responses.

## Main improvements

- Uses `gpt-5.6-terra` as the answer-model fallback.
- Uses `gpt-5.4-mini` as the web-analysis fallback.
- Adds an optional Market or region field so the coach does not silently assume
  a central bank or jurisdiction.
- Makes the three answer styles meaningfully different.
- Defines vague timeframes such as “soon” in the spoken response.
- Guarantees that each response ends with one direct client-relevant question.
- Uses fixed interface labels, removing duplicated numbering such as `1. 1.`.
- Cleans markdown and URLs out of the market summary.
- Separates the market brief into Baseline, Observed facts, and What could change.
- Deduplicates source links, removes tracking parameters, prioritises cited
  sources, and shows at most five.
- Adds a Copy response button to each answer.
- Corrects the model names shown by `/api/health`.

## Repository structure

```text
/
├── index.html
├── app.js
├── styles.css
├── _headers
├── package.json
└── functions/
    └── api/
        ├── health.js
        ├── test.js
        └── view.js
```

## Cloudflare Pages settings

- Framework preset: None
- Build command: leave blank
- Build output directory: `/` or repository root
- Root directory: leave blank

## Required secret

- `OPENAI_API_KEY` — Secret

## Optional model variables

The built-in fallbacks are:

- `OPENAI_ANSWER_MODEL=gpt-5.6-terra`
- `OPENAI_ANALYSIS_MODEL=gpt-5.4-mini`

After replacing the GitHub files, commit the changes and wait for a new
Cloudflare Production deployment.
