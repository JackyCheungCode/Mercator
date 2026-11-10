import io, os, re, tempfile
from pathlib import Path
from typing import Any
import cv2, ezdxf, fitz, numpy as np, pytesseract
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image
from pytesseract import Output

app = FastAPI(title="Mercator Drawing Analysis Engine", version="0.2.0")
MAX_BYTES = 50 * 1024 * 1024
ALLOWED = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".dxf"}
PATTERNS = [re.compile(r"\bQF\s*[-_]?\s*\d+\b", re.I), re.compile(r"\bCT\s*[-_]?\s*\d*\b", re.I), re.compile(r"\b(?:UPS|ATS|ACB|MCCB|VCB)\s*[-_]?\s*\d*\b", re.I), re.compile(r"\b\d{2,5}\s*/\s*\d{1,4}\s*,\s*0\.[125]\b")]

def check_auth(value: str | None):
    token = os.getenv("MERCATOR_ENGINE_TOKEN")
    if token and value != f"Bearer {token}":
        raise HTTPException(401, "Invalid engine token")

def ocr_image(image: Image.Image, page: int, lang: str):
    arr = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    gray = cv2.resize(gray, None, fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)
    gray = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    data = pytesseract.image_to_data(binary, lang=lang, config="--oem 1 --psm 11", output_type=Output.DICT)
    blocks = []
    for i, raw in enumerate(data["text"]):
        value = (raw or "").strip()
        try: confidence = max(0.0, min(1.0, float(data["conf"][i]) / 100))
        except (ValueError, TypeError): confidence = 0.0
        if not value or confidence < 0.18: continue
        blocks.append({"page_number": page, "text_content": value, "confidence": round(confidence, 4),
          "bbox": {"x": round(data["left"][i]/1.5), "y": round(data["top"][i]/1.5), "width": round(data["width"][i]/1.5), "height": round(data["height"][i]/1.5)},
          "source": "tesseract_ocr"})
    return blocks

def candidate_labels(blocks):
    out, seen = [], set()
    for block in blocks:
        for pattern in PATTERNS:
            for match in pattern.finditer(block["text_content"]):
                label = re.sub(r"\s+", "", match.group()).upper()
                key = (block["page_number"], label)
                if key not in seen:
                    seen.add(key); out.append({"page_number": block["page_number"], "label": label, "bbox": block["bbox"], "source_text": block["text_content"], "ocr_confidence": block["confidence"], "classification": "candidate_only"})
    return out

def analyze_dxf(path: Path):
    try: doc = ezdxf.readfile(path)
    except Exception as exc: raise HTTPException(422, f"Unable to parse DXF: {exc}") from exc
    counts, blocks, geometry = {}, [], []
    for ent in doc.modelspace():
        kind = ent.dxftype(); counts[kind] = counts.get(kind, 0) + 1
        layer = ent.dxf.layer if ent.dxf.hasattr("layer") else None
        if kind == "TEXT":
            p = ent.dxf.insert
            blocks.append({"page_number": 1, "text_content": ent.dxf.text, "confidence": 1.0, "bbox": {"x": p.x, "y": p.y, "width": None, "height": ent.dxf.height}, "source": "dxf_text", "layer": layer})
        elif kind == "MTEXT":
            p = ent.dxf.insert
            blocks.append({"page_number": 1, "text_content": ent.text, "confidence": 1.0, "bbox": {"x": p.x, "y": p.y, "width": None, "height": ent.dxf.char_height}, "source": "dxf_mtext", "layer": layer})
        elif kind in {"LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC", "INSERT"}:
            item: dict[str, Any] = {"type": kind, "layer": layer}
            if kind == "LINE": item.update(start=list(ent.dxf.start)[:2], end=list(ent.dxf.end)[:2])
            elif kind == "LWPOLYLINE": item["vertices"] = [list(p)[:2] for p in ent.get_points("xy")]
            elif kind == "POLYLINE": item["vertices"] = [[v.dxf.location.x, v.dxf.location.y] for v in ent.vertices]
            elif kind in {"CIRCLE", "ARC"}: item.update(center=[ent.dxf.center.x, ent.dxf.center.y], radius=ent.dxf.radius)
            elif kind == "INSERT": item.update(block_name=ent.dxf.name, insert=[ent.dxf.insert.x, ent.dxf.insert.y])
            geometry.append(item)
    return {"pages": 1, "text_blocks": blocks, "geometry": geometry, "entity_counts": counts, "format": "dxf"}

@app.get("/health")
def health(): return {"ok": True, "service": "mercator-analysis-engine", "version": "0.2.0"}

@app.get("/v1/capabilities")
def capabilities():
    return {"version": "0.2.0", "ocr": True, "image_preprocessing": True, "pdf_rasterization": True, "dxf_vector_extraction": True, "symbol_detection": False, "electrical_topology": False, "rule_validation": False, "revision_comparison": False, "ocr_languages": os.getenv("TESSERACT_LANG", "chi_tra+eng").split("+")}

@app.post("/v1/analyze")
async def analyze(file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    check_auth(authorization)
    name = file.filename or "drawing"; suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED: raise HTTPException(415, "Supports PDF, PNG, JPG, WEBP, TIFF and DXF. Convert DWG to DXF first.")
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES: raise HTTPException(413, "File exceeds 50 MB.")
    if not raw: raise HTTPException(400, "Empty file.")
    if suffix == ".dxf":
        with tempfile.NamedTemporaryFile(suffix=".dxf") as tmp:
            tmp.write(raw); tmp.flush(); result = analyze_dxf(Path(tmp.name))
        return {"ok": True, "filename": name, **result, "candidate_labels": candidate_labels(result["text_blocks"]), "engine_version": "0.2.0", "notice": "CAD text/vector extraction only; no electrical semantics inferred."}
    blocks, pages = [], 0
    try:
        if suffix == ".pdf":
            pdf = fitz.open(stream=raw, filetype="pdf")
            if pdf.page_count > 30: raise HTTPException(413, "PDF exceeds 30-page limit.")
            pages = pdf.page_count
            for i, page in enumerate(pdf):
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                blocks.extend(ocr_image(Image.open(io.BytesIO(pix.tobytes("png"))), i+1, os.getenv("TESSERACT_LANG", "chi_tra+eng")))
            pdf.close()
        else:
            image = Image.open(io.BytesIO(raw)); image.verify(); image = Image.open(io.BytesIO(raw))
            pages = getattr(image, "n_frames", 1)
            if pages > 30: raise HTTPException(413, "Image has more than 30 frames/pages.")
            for i in range(pages):
                image.seek(i); blocks.extend(ocr_image(image.copy(), i+1, os.getenv("TESSERACT_LANG", "chi_tra+eng")))
    except HTTPException: raise
    except Exception as exc: raise HTTPException(422, f"Unable to decode or OCR drawing: {exc}") from exc
    return {"ok": True, "filename": name, "format": suffix.lstrip("."), "pages": pages, "text_blocks": blocks, "candidate_labels": candidate_labels(blocks), "geometry": [], "engine_version": "0.2.0", "notice": "OCR candidates only. Symbol detection, topology and compliance validation are not implemented."}
