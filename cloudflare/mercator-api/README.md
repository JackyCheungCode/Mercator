# Mercator Cloudflare API

Worker: `mercator-api`  
Endpoint: `https://mercator-api.xg-y.workers.dev`

## Bindings
- Workers AI binding: `AI`
- Plain text `SUPABASE_URL`
- Plain text `SUPABASE_PUBLISHABLE_KEY`

## Routes
- `GET /health`
- `GET /api/v1/capabilities`
- `POST /api/v1/analyze` — authenticated proxy to the Python engine; requires `MERCATOR_ENGINE_URL` and secret `MERCATOR_ENGINE_TOKEN`.
- `POST /api/v1/visual-review` — authenticated image-only visual triage using `@cf/moondream/moondream3.1-9B-A2B`

The visual review route validates the Supabase access token through Supabase Auth before using Workers AI. It accepts PNG/JPG/WEBP up to 5 MB. It does not make compliance or electrical correctness determinations. The `/api/v1/analyze` proxy is code-ready but returns `ANALYSIS_ENGINE_NOT_CONFIGURED` until a reachable Python engine is deployed and both bindings are set. Never expose the engine token to the browser.

Workers AI currently includes 10,000 Neurons/day on the Free plan; exceeding the daily allocation causes inference requests to fail until reset.
