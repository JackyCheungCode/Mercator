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
