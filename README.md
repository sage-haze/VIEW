# VIEW Conversation Coach — working Cloudflare Pages version

This version restores the full VIEW webpage while keeping the tested Cloudflare
Pages secret-binding pattern.

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

Add this under the environment you deploy to:

- `OPENAI_API_KEY` — Secret

Then redeploy.

## Optional model variables

You do not need to add these. The built-in defaults are:

- `OPENAI_ANSWER_MODEL=gpt-5.6-terra`
- `OPENAI_ANALYSIS_MODEL=gpt-5.4-mini`

You can add either as a normal variable to override the defaults.

## Test URLs

- `/api/test` makes a small authenticated OpenAI models request.
- `/api/health` reports whether the binding exists without calling OpenAI.
- `/` opens the complete VIEW Conversation Coach.

The API key remains server-side and is never returned to the browser.


## Fix for “OpenAI returned no text”

This revision explicitly uses low/no reasoning for these short generation tasks,
increases the output-token budgets, and reports the Responses API status, output
item types, incomplete reason, and OpenAI request ID when no text is returned.
