from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Mercator Analysis Engine", version="0.1.0")

class Capabilities(BaseModel):
    version: str = "0.1.0"
    ocr: bool = False
    symbol_detection: bool = False
    electrical_topology: bool = False
    rule_validation: bool = False
    revision_comparison: bool = False

@app.get("/health")
def health():
    return {"ok": True, "service": "mercator-analysis-engine", "version": "0.1.0"}

@app.get("/v1/capabilities", response_model=Capabilities)
def capabilities():
    return Capabilities()

@app.post("/v1/analyze")
async def analyze(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="A drawing filename is required")
    raise HTTPException(status_code=501, detail="Analysis modules are not enabled in V1 foundation")
