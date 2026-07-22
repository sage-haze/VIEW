# VIEW Conversation Coach — mirrored Cloudflare Pages pattern

This version mirrors the structure and secret-access pattern used by the working
`my-ai-page-Testing` project.

## Repository root

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
        └── view.js
```

## Cloudflare Pages settings

Use the same build settings as the working project:

- Framework preset: None
- Build command: leave blank
- Build output directory: leave blank, or use the repository root if Cloudflare requires a value
- Root directory: leave blank

Do not use `public` as the output directory for this version.

## Runtime configuration

In the same Cloudflare Pages project, configure:

- `OPENAI_API_KEY` as a Secret
- `OPENAI_ANALYSIS_MODEL` as a Variable with value `gpt-5.6-terra`

The Function accesses the key using the same pattern as the working project:

```js
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.OPENAI_API_KEY) {
    return Response.json(
      { error: "Missing OPENAI_API_KEY secret in Cloudflare." },
      { status: 500 }
    );
  }

  // Authorization: `Bearer ${env.OPENAI_API_KEY}`
}
```

No `.env` file is required for production.

## Verify the binding

After deployment, open:

```text
https://YOUR-PROJECT.pages.dev/api/health
```

The response should show:

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
