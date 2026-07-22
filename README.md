# Conversation Builder / Transaction Banking Conversation Intelligence

Lightweight Cloudflare Pages + Functions prototype for generating source-grounded client conversation cards for Thailand-based transaction banking relationship managers.

## Core flow

```text
Client setup
→ news / event discovery
→ official data evidence
→ source review
→ client conversation cards
→ FX / rates context
```

## Required secrets

Set these in Cloudflare Pages / Workers as encrypted secrets.

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put TAVILY_API_KEY
npx wrangler secret put FRED_API_KEY
npx wrangler secret put BOT_API_CLIENT_ID
```

Optional, configured but not used in the research flow because of free-tier limits:

```bash
npx wrangler secret put ALPHA_VANTAGE_API_KEY
```

For local testing, add the same values to `.dev.vars` and do not commit that file.

```text
OPENAI_API_KEY=...
TAVILY_API_KEY=...
FRED_API_KEY=...
BOT_API_CLIENT_ID=...
ALPHA_VANTAGE_API_KEY=...
```

## Data sources now included

### Keyed sources

- **OpenAI**: source review, synthesis and conversation-card generation.
- **Tavily**: web / news discovery.
- **FRED**: global market-driver evidence such as US Treasury yields, Fed funds, CPI, unemployment and broad USD index.
- **Bank of Thailand API**: Thailand-local FX and rate evidence.

### No-key sources

- **World Bank Indicators API**
- **IMF DataMapper API**
- **GDELT document search**

### Configured but not executed

- **Alpha Vantage** is intentionally left out of the main research execution because the free tier is very limited. Keep the secret available for a later scheduled daily pull if needed.

## BOT API endpoints used

The app uses the BOT client ID header:

```text
X-IBM-Client-Id: <BOT_API_CLIENT_ID>
accept: application/json
```

Current BOT calls are best-effort and will not break the app if one endpoint is unavailable:

- `Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/`
- `PolicyRate/v2/policy_rate/`
- `BIBOR/v2/bibor_rate/`
- `search-series/`

## Source health check

After deployment, open:

```text
/api/source-health
```

This endpoint checks whether the credentials are present and tests lightweight FRED and BOT requests. It does not expose secret values.

## Notes

Official datasets are treated as periodic context rather than breaking news. They are used to anchor conversation cards in credible evidence, while Tavily and GDELT provide faster-moving news and event discovery.


## v9 updates

- Market Intelligence now shows only compact FX summary metrics by default: latest, tenor change, tenor high, and tenor low.
- FX charts, AI commentary, and the daily FX table are hidden under a details dropdown. The daily FX table is nested one level deeper.
- Top Relevant Signals now starts as a short selectable signal list instead of showing the full Five Moves text immediately.
- The strongest three signals are selected by default; users can show more signals and choose what to include.
- Clicking Build Conversation Bridge expands only the selected signals into Observe, Relate, Leave Space, Lightly Explore, and Offer Support.

V18 update: default signal scan now includes commodities/input costs and macro indicators, and conversation cards include a compact Baseline & scenarios frame to help RMs discuss uncertainty without forecasting.

## v8 updates

- Keeps all FX disclosure controls and the 90-day chart inside the Market Intelligence card using contained details styling and an in-line chevron.
- Replaces technical cross-rate subtitles with plain-language wording such as “Movement reflects both Baht-side and Yen-side factors.”
- Makes Explore lightly, Allow room, and Reaffirm support more scannable through structured, compact fields rather than long compound bullets.
- Explore lightly now returns two selectable questions with short “Why ask” and “Listen for” support.
- Allow room now returns two or three compact emphasis cues with a clear implication and follow-the-client path.
- Reaffirm support now returns two conditional examples rather than a fixed closing statement.
