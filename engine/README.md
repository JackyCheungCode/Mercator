# Mercator Analysis Engine V0.4

## Implemented in this iteration
- OCR and PDF/image preprocessing remain available.
- Literal extraction of voltage, current, frequency, CT ratio and power text with page and bounding-box evidence.
- Equipment-tag candidates include QF, QS, DS, CT, PT/VT, TR, UPS, ATS, ACB, MCCB and VCB.
- Raster CV proposals: OpenCV contour geometry (circle/rectangle candidates) and nearby OCR tag association. Unclassified proposals remain unclassified; these are not a trained electrical-symbol detector.
- Raster wire proposals: Hough line segments and endpoint-cluster graph. Crossings are not assumed to be connected; this is not a complete raster circuit topology.
- DXF INSERT block-name candidates and exact endpoint connectivity graph for LINE/POLYLINE geometry.
- Review leads for low-confidence symbol labels, possible duplicate tags, low-confidence CT-ratio text and dangling geometric endpoints. All require engineer review.

## Verification
- The UI keeps the full-analysis action disabled until the Worker reports a configured analysis engine.
- CI frontend build runs `npm install` because this repository currently has no committed npm lockfile.
- The repository CI also runs the frontend TypeScript/Vite build to catch API integration type errors.
- Run `python -m compileall -q app tests` and `python -m unittest discover -s tests -v` from this directory. GitHub Actions runs these checks on engine changes.

## Current limitations
- Raster symbols are geometric proposals, not validated breaker/isolator/CT/PT/transformer classifiers. Accurate symbol recognition needs a labelled electrical-symbol dataset and a trained detector.
- Raster topology does not yet resolve T-junctions, wire crossings, junction dots, wire gaps, symbol terminals or cross-page references.
- DXF graph currently connects coincident line/polyline endpoints only; it does not yet split intersecting entities or infer electrical semantics from layers/blocks.
- No normative compliance verdicts are produced. Findings are evidence-backed review leads only.
- DWG decoding is not supported; convert to DXF first.
- The Python engine remains a separate service and must be deployed and connected to the Cloudflare Worker/Supabase task flow before these capabilities are available in the production app.

## Run with Docker
```bash
docker build -t mercator-engine .
docker run --rm -p 8000:8000 -e MERCATOR_ENGINE_TOKEN='replace-me' mercator-engine
```

Endpoints: GET /health, GET /v1/capabilities, POST /v1/analyze (multipart field `file`). When MERCATOR_ENGINE_TOKEN is set, POST requires `Authorization: Bearer <token>`.


## Cloudflare Container deployment

The Python service is packaged as a separate Worker + Durable Object Container under this directory:

- Worker entrypoint: `cloudflare/worker.ts`
- Wrangler config: `wrangler.toml`
- Image: the existing `Dockerfile`
- Internal HTTP port: `8000`
- Container instance: `standard-1` (4 GiB memory), maximum 3 instances
- Container outbound Internet: disabled
- The gateway requires the `ENGINE_TOKEN` secret and passes it into the container as `MERCATOR_ENGINE_TOKEN`.

Deployment prerequisites and sequence:

1. The Cloudflare account must have the Workers Paid plan with Containers access. The account currently returns an explicit "Deploying containers requires the Workers Paid plan" denial for the Containers API.
2. From this directory, run `npm install`, then `npm run typecheck`.
3. Set the container gateway secret with `npx wrangler secret put ENGINE_TOKEN`.
4. Deploy this isolated service with `npx wrangler deploy`. Do not deploy this config to the existing `mercator-api` Worker.
5. Verify `GET /health` on the new `mercator-engine` Worker and then `GET /v1/capabilities` through the authenticated gateway.
6. Set `MERCATOR_ENGINE_URL` on `mercator-api` to the new Worker URL and set `MERCATOR_ENGINE_TOKEN` to the same secret. Only then should the UI enable the full analysis action.

The Containers API access check was performed for the connected Cloudflare account on 2026-11-10 and denied due to plan eligibility. No Container application or image has been created yet. Upgrading a plan is an account billing change and is not performed automatically.

CI runs Python unit tests, the Container Worker TypeScript type-check, and a Docker image build. Passing CI does not mean the image has been deployed.
