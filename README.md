# VIEW Coach — Cloudflare Pages edition

This repository is designed for one Cloudflare Pages project. The static site
and server-side API are deployed together.

## Repository structure

```text
/
├── public/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── _headers
├── functions/
│   └── api/
│       ├── health.js
│       └── view.js
└── README.md
```

Do not place the whole project inside another folder in the Git repository.
`public` and `functions` must be visible at the repository root.

## Cloudflare Pages build settings

Connect this Git repository to a Cloudflare Pages project and use:

- Framework preset: None
- Build command: leave blank
- Build output directory: `public`
- Root directory: leave blank, unless this repository is intentionally inside
  a monorepo subdirectory

The `/functions` directory must remain at the Pages project root. Do not put it
inside `public`.

## Runtime variables and secrets

Under the Cloudflare Pages project's **Settings → Variables and Secrets**, add:

- `OPENAI_API_KEY` as a secret
- `OPENAI_ANALYSIS_MODEL` as a variable with value `gpt-5.6-terra`

No `.env` file is required for production. The answer model is embedded in
`functions/api/view.js` as `gpt-5.4-mini`.

After adding or changing a binding, redeploy the Pages project.

## Test the deployment

Open:

```text
https://YOUR-PROJECT.pages.dev/api/health
```

Expected response:

```json
{
  "ok": true,
  "runtime": "Cloudflare Pages Functions",
  "bindings": {
    "openAIKeyConfigured": true,
    "analysisModelConfigured": true
  }
}
```

Then open the project home page and submit a question.

## Important

The browser calls `/api/view` using a relative URL. This proves the static site
and API are being served by the same Cloudflare Pages deployment. No GitHub
Pages URL, separate Worker URL, or CORS configuration is used.
