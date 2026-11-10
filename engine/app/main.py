import io, os, re, tempfile
from pathlib import Path
from typing import Any
import cv2, ezdxf, fitz, numpy as np, pytesseract
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from PIL import Image
from pytesseract import Output

app = FastAPI(title="Mercator Drawing Analysis Engine", version="0.4.0")
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


def extract_electrical_parameters(blocks):
    """Extract literal parameter strings; never infer missing engineering values."""
    patterns = [
        ("voltage", re.compile(r"(?<!\w)(?:\d+(?:\.\d+)?)\s*(?:kV|V)(?!\w)", re.I)),
        ("current", re.compile(r"(?<!\w)(?:\d+(?:\.\d+)?)\s*(?:kA|A)(?!\w)", re.I)),
        ("frequency", re.compile(r"(?<!\w)(?:50|60)\s*Hz(?!\w)", re.I)),
        ("ct_ratio", re.compile(r"(?<!\w)\d{1,5}\s*/\s*\d{1,4}(?:\s*,\s*0\.[125])?(?!\w)", re.I)),
        ("power", re.compile(r"(?<!\w)(?:\d+(?:\.\d+)?)\s*(?:kVA|MVA|kW|MW)(?!\w)", re.I)),
    ]
    found, seen = [], set()
    for block in blocks:
        text = block["text_content"]
        for kind, pattern in patterns:
            for match in pattern.finditer(text):
                value = re.sub(r"\s+", "", match.group()).upper()
                key = (block["page_number"], kind, value, block["bbox"].get("x"), block["bbox"].get("y"))
                if key in seen:
                    continue
                seen.add(key)
                found.append({
                    "page_number": block["page_number"], "parameter_type": kind,
                    "value_text": value, "source_text": text,
                    "bbox": block["bbox"], "ocr_confidence": block["confidence"],
                    "source": block.get("source", "ocr")
                })
    return found


def candidate_findings(blocks, labels, parameters):
    """Conservative review leads, not electrical compliance decisions."""
    findings = []
    occurrences = {}
    for block in blocks:
        for pattern in PATTERNS[:3]:
            for match in pattern.finditer(block["text_content"]):
                tag = re.sub(r"\s+", "", match.group()).upper()
                occurrences.setdefault((block["page_number"], tag), []).append(block)
        if block["confidence"] < 0.35:
            findings.append({
                "category": "ocr_uncertainty", "severity": "info",
                "title": "文字辨識信心偏低",
                "description": f"頁面 {block['page_number']} 有一段文字辨識信心值為 {block['confidence']:.0%}，內容為「{block['text_content']}」。",
                "page_number": block["page_number"], "bbox": block["bbox"],
                "evidence": {"source_text": block["text_content"], "ocr_confidence": block["confidence"]},
                "requires_engineer_review": True
            })
    for (page, tag), matches in occurrences.items():
        if len(matches) > 1:
            findings.append({
                "category": "possible_duplicate_tag", "severity": "medium",
                "title": f"設備代號可能重複：{tag}",
                "description": f"第 {page} 頁有 {len(matches)} 個 OCR 文字區域辨識為 {tag}。可能是重複標註，也可能是同一標籤被拆分或重複掃描，需查看原圖確認。",
                "page_number": page, "bbox": matches[0]["bbox"],
                "evidence": {"tag": tag, "occurrences": [m["bbox"] for m in matches], "source": "ocr_candidate"},
                "requires_engineer_review": True
            })
    for item in parameters:
        if item["parameter_type"] == "ct_ratio" and item["ocr_confidence"] < 0.6:
            findings.append({
                "category": "parameter_uncertainty", "severity": "info",
                "title": "CT 變比文字需要核對",
                "description": f"辨識到疑似 CT 變比「{item['value_text']}」，但 OCR 信心值不足，不能直接用於參數校驗。",
                "page_number": item["page_number"], "bbox": item["bbox"],
                "evidence": item, "requires_engineer_review": True
            })
    return findings


SYMBOL_TERMS = {
    "circuit_breaker": ("QF", "CB", "ACB", "MCCB", "VCB"),
    "isolator": ("QS", "DS", "ISOLATOR", "DISCONNECTOR"),
    "current_transformer": ("CT",),
    "voltage_transformer": ("PT", "VT"),
    "transformer": ("T", "TR", "TRANSFORMER"),
    "busbar": ("BUS", "BUSBAR", "母線", "匯流排"),
}

def classify_symbol_name(value: str):
    token = re.sub(r"[^A-Z0-9\u4e00-\u9fff]", "", value.upper())
    for kind, terms in SYMBOL_TERMS.items():
        if any(re.fullmatch(re.escape(term) + r"\\d*", token) for term in terms):
            return kind
    return None

def _dist(a, b):
    return float(np.hypot(a[0]-b[0], a[1]-b[1]))

def build_dxf_topology(geometry, tolerance=1e-3):
    """Build a geometric connectivity graph from DXF line/polyline endpoints."""
    nodes, edges, point_index = [], [], {}
    def node_id(point):
        key = (round(float(point[0])/tolerance), round(float(point[1])/tolerance))
        if key not in point_index:
            point_index[key] = len(nodes)
            nodes.append({"id": point_index[key], "x": float(point[0]), "y": float(point[1]), "degree": 0})
        return point_index[key]
    for index, item in enumerate(geometry):
        points = []
        if item["type"] == "LINE":
            points = [item["start"], item["end"]]
        elif item["type"] in {"LWPOLYLINE", "POLYLINE"}:
            points = item.get("vertices", [])
        if len(points) < 2:
            continue
        ids = [node_id(p) for p in points]
        for a, b in zip(ids, ids[1:]):
            if a == b: continue
            edges.append({"id": len(edges), "source": a, "target": b, "source_entity": index, "layer": item.get("layer")})
            nodes[a]["degree"] += 1
            nodes[b]["degree"] += 1
    return {"nodes": nodes, "edges": edges, "node_count": len(nodes), "edge_count": len(edges),
            "dangling_endpoints": [n for n in nodes if n["degree"] == 1],
            "junction_candidates": [n for n in nodes if n["degree"] >= 3],
            "method": "exact_dxf_endpoint_coincidence", "tolerance": tolerance}

def detect_dxf_symbols(geometry, text_blocks):
    symbols = []
    for item in geometry:
        if item["type"] != "INSERT": continue
        name = item.get("block_name", "")
        kind = classify_symbol_name(name)
        if not kind: continue
        x, y = item.get("insert", [0, 0])
        symbols.append({"symbol_type": kind, "block_name": name, "page_number": 1,
                        "bbox": {"x": x, "y": y, "width": None, "height": None},
                        "confidence": 0.82, "source": "dxf_block_name", "review_required": True})
    for block in text_blocks:
        value = block["text_content"].strip().upper()
        kind = classify_symbol_name(value)
        if kind:
            symbols.append({"symbol_type": kind, "label": value, "page_number": block["page_number"],
                            "bbox": block["bbox"], "confidence": block["confidence"],
                            "source": "nearby_text_label_candidate", "review_required": True})
    return symbols

def detect_raster_symbol_candidates(image, page, text_blocks):
    """Find geometric symbol proposals; class labels are assigned only from nearby explicit tags."""
    arr = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    scale = max(1.0, max(gray.shape) / 2400.0)
    if scale > 1:
        gray = cv2.resize(gray, (int(gray.shape[1]/scale), int(gray.shape[0]/scale)))
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                   cv2.THRESH_BINARY_INV, 31, 10)
    contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    proposals = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = cv2.contourArea(contour)
        if area < 30 or area > gray.shape[0]*gray.shape[1]*0.015: continue
        ratio = w / max(h, 1)
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.035*perimeter, True)
        circularity = (4*np.pi*area/(perimeter*perimeter)) if perimeter else 0
        shape = "circle_candidate" if 0.68 <= circularity <= 1.25 else ("rectangle_candidate" if len(approx) == 4 and 0.65 <= ratio <= 1.55 else None)
        if not shape: continue
        bx, by, bw, bh = [int(v*scale) for v in (x,y,w,h)]
        center = (bx+bw/2, by+bh/2)
        nearby = []
        for block in text_blocks:
            if block["page_number"] != page: continue
            b = block["bbox"]
            tx, ty = b["x"]+b["width"]/2, b["y"]+b["height"]/2
            if _dist(center, (tx,ty)) <= max(100, 2.5*max(bw,bh)):
                nearby.append(( _dist(center,(tx,ty)), block))
        label = None
        if nearby:
            for _, block in sorted(nearby, key=lambda v:v[0]):
                label = classify_symbol_name(block["text_content"])
                if label: break
        proposals.append({"symbol_type": label or "unclassified_" + shape, "shape": shape,
                          "page_number": page, "bbox": {"x": bx, "y": by, "width": bw, "height": bh},
                          "confidence": 0.35 if label is None else 0.58,
                          "source": "opencv_geometric_proposal", "review_required": True,
                          "associated_label": next((b["text_content"] for _,b in sorted(nearby,key=lambda v:v[0]) if classify_symbol_name(b["text_content"])), None)})
    return proposals[:500]

def raster_line_candidates(image, page):
    arr = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=80,
                            minLineLength=max(30, min(gray.shape)//80), maxLineGap=8)
    segments = []
    if lines is not None:
        for line in lines[:3000]:
            x1,y1,x2,y2 = [int(v) for v in line[0]]
            segments.append({"page_number": page, "start": [x1,y1], "end": [x2,y2],
                             "length": round(_dist((x1,y1),(x2,y2)),2), "source":"opencv_hough_candidate"})
    return segments


def build_raster_endpoint_graph(segments, tolerance=8.0):
    """Cluster line-segment endpoints only; crossings are deliberately not assumed connected."""
    nodes, edges, buckets = [], [], {}
    def get_node(point):
        cell = (round(point[0]/tolerance), round(point[1]/tolerance))
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                for idx in buckets.get((cell[0]+dx,cell[1]+dy),[]):
                    n=nodes[idx]
                    if _dist((n["x"],n["y"]),point) <= tolerance:
                        return idx
        idx=len(nodes)
        nodes.append({"id":idx,"x":float(point[0]),"y":float(point[1]),"degree":0})
        buckets.setdefault(cell,[]).append(idx)
        return idx
    for seg in segments:
        a=get_node(seg["start"]); b=get_node(seg["end"])
        if a==b: continue
        edges.append({"id":len(edges),"source":a,"target":b,"length":seg["length"]})
        nodes[a]["degree"]+=1; nodes[b]["degree"]+=1
    return {"nodes":nodes,"edges":edges,"node_count":len(nodes),"edge_count":len(edges),
            "dangling_endpoints":[n for n in nodes if n["degree"]==1],
            "junction_candidates":[n for n in nodes if n["degree"]>=3],
            "method":"raster_hough_endpoint_clustering_not_electrical_connectivity","tolerance_px":tolerance}

def review_topology_candidates(topology, symbols):
    findings = []
    if topology:
        for node in topology.get("dangling_endpoints", [])[:100]:
            findings.append({"category":"possible_open_connection","severity":"info",
                "title":"可能存在未連接的導線端點",
                "description":"DXF 幾何中此端點只有一條線段相接；可能是有意的引出端、跨頁連接或圖形未完整，需結合圖例與整張電路圖確認。",
                "page_number":1,"bbox":{"x":node["x"],"y":node["y"],"width":0,"height":0},
                "evidence":{"node":node,"topology_method":topology["method"]},"requires_engineer_review":True})
    for symbol in symbols:
        if symbol["symbol_type"].startswith("unclassified_"):
            continue
        if symbol["confidence"] < 0.65:
            findings.append({"category":"symbol_identification_uncertain","severity":"info",
                "title":"電氣符號分類需要覆核",
                "description":f"候選符號辨識為 {symbol['symbol_type']}，信心值 {symbol['confidence']:.0%}，請核對原圖符號與圖例。",
                "page_number":symbol["page_number"],"bbox":symbol["bbox"],
                "evidence":symbol,"requires_engineer_review":True})
    return findings

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
def health(): return {"ok": True, "service": "mercator-analysis-engine", "version": "0.4.0"}

@app.get("/v1/capabilities")
def capabilities():
    return {"version": "0.4.0", "ocr": True, "image_preprocessing": True, "pdf_rasterization": True, "dxf_vector_extraction": True, "symbol_detection": True, "electrical_topology": "dxf_endpoint_graph_and_raster_line_candidates", "rule_validation": "conservative_review_leads", "revision_comparison": False, "ocr_languages": os.getenv("TESSERACT_LANG", "chi_tra+eng").split("+")}

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
        labels = candidate_labels(result["text_blocks"])
        parameters = extract_electrical_parameters(result["text_blocks"])
        findings = candidate_findings(result["text_blocks"], labels, parameters)
        return {"ok": True, "filename": name, **result, "candidate_labels": labels, "extracted_parameters": parameters, "candidate_findings": findings + review_topology_candidates(build_dxf_topology(result["geometry"]), detect_dxf_symbols(result["geometry"], result["text_blocks"])), "engine_version": "0.4.0", "symbol_candidates": detect_dxf_symbols(result["geometry"], result["text_blocks"]), "topology": build_dxf_topology(result["geometry"]), "notice": "DXF symbol block-name candidates and geometric endpoint topology; connectivity and engineering meaning require review."}
    blocks, pages, symbol_candidates, line_candidates = [], 0, [], []
    try:
        if suffix == ".pdf":
            pdf = fitz.open(stream=raw, filetype="pdf")
            if pdf.page_count > 30: raise HTTPException(413, "PDF exceeds 30-page limit.")
            pages = pdf.page_count
            for i, page in enumerate(pdf):
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                page_image = Image.open(io.BytesIO(pix.tobytes("png"))); blocks.extend(ocr_image(page_image, i+1, os.getenv("TESSERACT_LANG", "chi_tra+eng"))); symbol_candidates.extend(detect_raster_symbol_candidates(page_image, i+1, blocks)); line_candidates.extend(raster_line_candidates(page_image, i+1))
            pdf.close()
        else:
            image = Image.open(io.BytesIO(raw)); image.verify(); image = Image.open(io.BytesIO(raw))
            pages = getattr(image, "n_frames", 1)
            if pages > 30: raise HTTPException(413, "Image has more than 30 frames/pages.")
            for i in range(pages):
                image.seek(i); page_image=image.copy(); blocks.extend(ocr_image(page_image, i+1, os.getenv("TESSERACT_LANG", "chi_tra+eng"))); symbol_candidates.extend(detect_raster_symbol_candidates(page_image, i+1, blocks)); line_candidates.extend(raster_line_candidates(page_image, i+1))
    except HTTPException: raise
    except Exception as exc: raise HTTPException(422, f"Unable to decode or OCR drawing: {exc}") from exc
    labels = candidate_labels(blocks)
    parameters = extract_electrical_parameters(blocks)
    findings = candidate_findings(blocks, labels, parameters)
    return {"ok": True, "filename": name, "format": suffix.lstrip("."), "pages": pages, "text_blocks": blocks, "candidate_labels": labels, "extracted_parameters": parameters, "candidate_findings": findings + review_topology_candidates(build_raster_endpoint_graph(line_candidates), symbol_candidates), "symbol_candidates": symbol_candidates, "line_candidates": line_candidates, "topology": build_raster_endpoint_graph(line_candidates), "geometry": [], "engine_version": "0.4.0", "notice": "Raster symbol/line proposals are computer-vision candidates only; no electrical connectivity or compliance conclusion is inferred."}
