# VIEW Framework — next response-quality update

This package keeps the user's revised HTML layout and updates the generation logic behind the three answers.

## What changed

- Keeps the revised `VIEW Framework` header and form layout.
- Makes the three client questions different and topic-specific.
- Uses deterministic topic-specific fallback questions if the model returns a generic or repeated question.
- Makes **E — Effects** a practical implication rather than another forecast sentence.
- Stops the cautious answer from referring to “the source brief”, “the assumption”, “the uncertain part”, or “the usable baseline”.
- Avoids recommending a purchase, sale, staging strategy, or hedge before the client's objective is understood.
- Separates market factors that have opposing directional effects.
- Requests multiple authoritative sources when facts span different institutions.
- Combines cited and web-search sources instead of showing only one cited source.
- Removes bare source domains such as `(gold.org)` from the visible market brief.

## Files to upload

Upload the contents of this folder to the root of the existing GitHub repository:

```text
index.html
app.js
styles.css
_headers
package.json
functions/
  api/
    health.js
    test.js
    view.js
```

Your Cloudflare variables remain:

```text
OPENAI_API_KEY          secret
OPENAI_ANSWER_MODEL     gpt-5.6-terra
OPENAI_ANALYSIS_MODEL   gpt-5.4-mini
```

Commit the files and wait for a new Cloudflare Production deployment.
