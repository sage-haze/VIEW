# VIEW Conversation Coach starter

This starter provides:

- A browser form for a client question and optional client context.
- Three structured answers built around VIEW.
- An optional current-market-context step using OpenAI web search.
- A Cloudflare Pages Function that keeps the OpenAI API key server-side.

## Recommended deployment

The simplest setup is to deploy the complete repository as a Cloudflare Pages
project connected to GitHub. Cloudflare then serves both the static files and
the `/api/view` Pages Function under the same domain.

Repository layout:

```text
/
├── index.html
├── styles.css
├── app.js
└── functions/
    └── api/
        └── view.js
```

## Cloudflare variables and secrets

Configure:

- `OPENAI_API_KEY` — Secret.
- `OPENAI_ANALYSIS_MODEL` — Variable, set to `gpt-5.6-terra`.
- `OPENAI_SIMPLE_MODEL` — Variable, set to the simple model available to your
  OpenAI project. The code currently defaults to `gpt-5.4-mini`.

Redeploy after changing bindings.

## GitHub Pages plus a separate Cloudflare Worker

If you retain GitHub Pages for the interface:

1. Deploy the Function separately as a Worker or Pages project.
2. Change the URL in `app.js` from `/api/view` to the full Cloudflare endpoint.
3. Replace `Access-Control-Allow-Origin: *` in `view.js` with the exact GitHub
   Pages origin, such as `https://example.github.io`.
4. Add rate limiting and Turnstile before public release.

## About market sentiment and consensus

The optional research step uses OpenAI's `web_search` tool. It asks the model
to prefer authoritative sources and distinguish facts from expectations.

For production banking use, web search should not be treated as a formal
consensus data feed. Better long-term sources include:

- Your bank's approved house-view research API or document repository.
- Licensed consensus providers for economist or analyst forecasts.
- Primary-source central-bank communications and official statistics.
- Market-implied measures computed from licensed price data.

A strong production pattern is:

1. Retrieve approved source material.
2. Store the source date, publisher, horizon, and exact measure.
3. Produce a short baseline synthesis.
4. Pass that synthesis to the VIEW generator.
5. Display the sources and freshness date to the user.

## Testing

Try questions such as:

- Do you think interest rates will fall soon?
- Will the US dollar strengthen further?
- Is gold likely to remain supported?
- How might oil prices affect our business this year?

Check that each answer:

- Gives a baseline view.
- Identifies change factors.
- Explains practical implications.
- Connects to the client's situation.
- Avoids unjustified certainty.
