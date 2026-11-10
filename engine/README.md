# Mercator Analysis Engine

Python service boundary for raster/vector drawing preprocessing and electrical drawing analysis. The V1 web app currently stores drawings and creates review jobs; this service is intentionally a foundation stub until the OCR, symbol detection and topology modules are implemented.

Run locally with `python -m venv .venv`, install `requirements.txt`, then `uvicorn app.main:app --reload` from this directory.
