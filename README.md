# VIEW Framework — complete GitHub replacement

This folder is a complete Cloudflare Pages project. Upload **the contents of this folder** to the root of your GitHub repository, replacing the existing files.

## What this version changes

- Refactors the answer prompt to remove repeated and overly prescriptive instructions.
- Generates three genuinely different banker perspectives:
  1. Relationship-led banker
  2. Commercial planning partner
  3. Risk-aware specialist
- Uses structured JSON output for the market brief and the three responses.
- Keeps the VIEW framework visible in every answer.
- Returns persona labels from the server instead of duplicating them in browser code.
- Uses topic-specific fallback client questions when the model repeats or produces a generic question.
- Preserves the API health and API-key test endpoints.

## Repository structure

```text
_headers
index.html
app.js
styles.css
package.json
README.md
functions/
  api/
    health.js
    test.js
    view.js
```

## Cloudflare Pages settings

Keep these runtime bindings under **Settings → Variables and Secrets** for the Production environment:

```text
OPENAI_API_KEY          Secret
OPENAI_ANSWER_MODEL     gpt-5.6-terra
OPENAI_ANALYSIS_MODEL   gpt-5.4-mini
```

`OPENAI_API_KEY` must be a runtime secret, not a value placed in the browser code or GitHub repository.

## Deployment

1. Delete or replace the existing repository files with the contents of this folder.
2. Commit the changes to the branch connected to Cloudflare Pages.
3. Wait for the Production deployment to complete.
4. Test these URLs:

```text
https://YOUR-DOMAIN/api/health
https://YOUR-DOMAIN/api/test
```

The health endpoint should show that the API key is configured. The test endpoint should confirm that OpenAI accepted the key.

## Notes

- The site uses Cloudflare Pages Functions, so the `functions` directory must remain at the repository root.
- The browser calls `/api/view`; the API key is only read inside the Cloudflare Function.
- Current market context is optional and uses the analysis model with web search.
- Do not enter confidential client information.
