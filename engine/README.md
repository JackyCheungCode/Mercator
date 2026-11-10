# Mercator Analysis Engine V0.2

## Implemented
- OpenCV raster preprocessing.
- Traditional Chinese and English OCR using Tesseract.
- PDF rasterization and OCR (up to 30 pages).
- PNG/JPG/WEBP/TIFF OCR (up to 30 frames/pages).
- DXF text and vector entity extraction: LINE, POLYLINE, CIRCLE, ARC and INSERT.
- Conservative candidates for labels such as QF, CT, UPS, ATS, ACB, MCCB and VCB.

## Not yet implemented
- DWG decoding (convert to DXF first).
- Symbol detection / object detection.
- Circuit topology reconstruction.
- Electrical design-rule validation.
- Revision movement/deletion/addition comparison.

OCR matches are candidates, not verified equipment identifications. Results require electrical engineer review.

## Run with Docker
```bash
docker build -t mercator-engine .
docker run --rm -p 8000:8000 -e MERCATOR_ENGINE_TOKEN='replace-me' mercator-engine
```

Endpoints: GET /health, GET /v1/capabilities, POST /v1/analyze (multipart field `file`). When MERCATOR_ENGINE_TOKEN is set, POST requires `Authorization: Bearer <token>`.

The engine is a separate service and is not yet connected to the Cloudflare Worker queue or Supabase task runner.
