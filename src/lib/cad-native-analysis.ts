export type CadPoint = { x: number; y: number };
export type CadTextBlock = {
  text: string;
  layer: string | null;
  sourceType: string;
  confidence: 1;
  bbox: { x: number; y: number; width: number | null; height: number | null };
  coordinateSystem: "cad_world";
};
export type CadNativeAnalysis = {
  schema: "mercator-cad-native-v1";
  source: "dxf-parser";
  entityCount: number;
  entityCounts: Record<string, number>;
  layers: Array<{ name: string; entityCount: number }>;
  textBlocks: CadTextBlock[];
  equipmentCandidates: Array<{ tag: string; category: string; layer: string | null; sourceText: string; confidence: number }>;
  parameterCandidates: Array<{ kind: string; value: string; sourceText: string; layer: string | null }>;
  blockReferences: Array<{ name: string; layer: string | null; insert: CadPoint; rotation: number; attributes: string[] }>;
  geometry: Array<Record<string, unknown>>;
  topology: {
    method: "cad_endpoint_coincidence_candidates";
    verified: false;
    nodes: Array<{ id: number; x: number; y: number; degree: number }>;
    edges: Array<{ id: number; source: number; target: number; entityIndex: number; layer: string | null }>;
    danglingEndpoints: Array<{ id: number; x: number; y: number; degree: number }>;
    junctionCandidates: Array<{ id: number; x: number; y: number; degree: number }>;
    crossingCandidates: Array<{ x: number; y: number; firstEntity: number; secondEntity: number }>;
  };
  limitations: string[];
};

const clean = (value: unknown) => String(value ?? "").replace(/\\P/g, " ").replace(/\\\\[A-Za-z][^;]*;/g, " ").replace(/[{}]/g, " ").replace(/\s+/g, " ").trim();
const point = (value: any): CadPoint | null => {
  if (!value) return null;
  const x = Number(Array.isArray(value) ? value[0] : value.x ?? value.x1);
  const y = Number(Array.isArray(value) ? value[1] : value.y ?? value.y1);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};
const tagPattern = /\b(?:QF|QS|QK|CT|PT|VT|FU|UPS|KM|KA|TV|TA|SB|HL|MCCB|ACB|VCB|DS|TR)\s*[-_#]?\s*\d+[A-Z]?\b/gi;
const parameterPatterns: Array<[string, RegExp]> = [
  ["voltage", /(?<![\w.])\d+(?:\.\d+)?\s*(?:kV|V)\b/gi],
  ["current", /(?<![\w/])\d+(?:\.\d+)?\s*(?:kA|A)\b/gi],
  ["frequency", /(?<![\w.])(?:50|60)\s*Hz\b/gi],
  ["ct_ratio", /(?<![\w])\d{1,5}\s*\/\s*\d{1,4}(?:\s*,\s*0\.[125])?\s*A?\b/gi],
  ["power", /(?<![\w.])\d+(?:\.\d+)?\s*(?:kVA|MVA|kW|MW)\b/gi]
];
function classifyTag(tag: string): string {
  const prefix = tag.toUpperCase().match(/^[A-Z]+/)?.[0] ?? "";
  if (["QF", "QK", "MCCB", "ACB", "VCB"].includes(prefix)) return "circuit_breaker";
  if (["QS", "DS"].includes(prefix)) return "isolator";
  if (prefix === "CT") return "current_transformer";
  if (["PT", "VT"].includes(prefix)) return "voltage_transformer";
  if (prefix === "TR") return "transformer";
  if (prefix === "UPS") return "ups";
  return "electrical_device";
}
function lineIntersection(a: CadPoint, b: CadPoint, c: CadPoint, d: CadPoint): CadPoint | null {
  const denominator = (a.x-b.x)*(c.y-d.y)-(a.y-b.y)*(c.x-d.x);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((a.x-c.x)*(c.y-d.y)-(a.y-c.y)*(c.x-d.x))/denominator;
  const u = -((a.x-b.x)*(a.y-c.y)-(a.y-b.y)*(a.x-c.x))/denominator;
  if (t < 1e-6 || t > 1-1e-6 || u < 1e-6 || u > 1-1e-6) return null;
  return { x: a.x+t*(b.x-a.x), y: a.y+t*(b.y-a.y) };
}

export function analyzeCadEntities(drawing: any): CadNativeAnalysis {
  const entities: any[] = Array.isArray(drawing?.entities) ? drawing.entities : [];
  const entityCounts: Record<string, number> = {};
  const layerCounts = new Map<string, number>();
  const textBlocks: CadTextBlock[] = [];
  const equipment = new Map<string, CadNativeAnalysis["equipmentCandidates"][number]>();
  const parameters = new Map<string, CadNativeAnalysis["parameterCandidates"][number]>();
  const blockReferences: CadNativeAnalysis["blockReferences"] = [];
  const geometry: Array<Record<string, unknown>> = [];
  const segments: Array<{ a: CadPoint; b: CadPoint; entityIndex: number; layer: string | null }> = [];
  const supported = new Set(["LINE", "LWPOLYLINE", "POLYLINE", "SPLINE", "ARC", "CIRCLE", "ELLIPSE", "INSERT", "TEXT", "MTEXT", "ATTRIB", "ATTDEF", "POINT", "SOLID", "HATCH", "DIMENSION"]);
  entities.forEach((entity, entityIndex) => {
    const type = String(entity?.type ?? "UNKNOWN").toUpperCase();
    const layer = entity?.layer == null ? null : String(entity.layer);
    entityCounts[type] = (entityCounts[type] ?? 0) + 1;
    if (layer) layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
    const values: string[] = [];
    if (["TEXT", "MTEXT", "ATTRIB", "ATTDEF"].includes(type)) {
      const value = clean(entity.text ?? entity.string ?? entity.tag ?? entity.prompt);
      if (value) values.push(value);
    }
    if (type === "INSERT") {
      const name = clean(entity.name ?? entity.block);
      if (name) values.push(name);
      const attributes = Array.isArray(entity.attribs) ? entity.attribs.map((item: any) => clean(item.text ?? item.string ?? item.tag)).filter(Boolean) : [];
      const insert = point(entity.position ?? entity.insertionPoint ?? entity.insert) ?? { x: Number(entity.x) || 0, y: Number(entity.y) || 0 };
      blockReferences.push({ name, layer, insert, rotation: Number(entity.rotation) || 0, attributes });
      values.push(...attributes);
    }
    for (const value of values) {
      const anchor = point(entity.startPoint ?? entity.position ?? entity.insertionPoint ?? entity.insert ?? entity.vertices?.[0]) ?? { x: 0, y: 0 };
      const heightValue = Number(entity.textHeight ?? entity.height ?? entity.charHeight);
      textBlocks.push({ text: value, layer, sourceType: type, confidence: 1, bbox: { x: anchor.x, y: anchor.y, width: null, height: Number.isFinite(heightValue) ? heightValue : null }, coordinateSystem: "cad_world" });
      for (const match of value.matchAll(tagPattern)) {
        const tag = match[0].replace(/\s+/g, "").toUpperCase();
        equipment.set(tag, { tag, category: classifyTag(tag), layer, sourceText: value, confidence: 1 });
      }
      for (const [kind, pattern] of parameterPatterns) {
        pattern.lastIndex = 0;
        for (const match of value.matchAll(pattern)) {
          const candidate = match[0].replace(/\s+/g, "").toUpperCase();
          parameters.set(kind + "|" + candidate + "|" + anchor.x + "|" + anchor.y, { kind, value: candidate, sourceText: value, layer });
        }
      }
    }
    let points: CadPoint[] = [];
    if (type === "LINE") {
      const a = point(entity.startPoint ?? entity.start);
      const b = point(entity.endPoint ?? entity.end);
      if (a && b) points = [a, b];
    } else if (["LWPOLYLINE", "POLYLINE"].includes(type) && Array.isArray(entity.vertices)) {
      points = entity.vertices.map(point).filter((p: CadPoint | null): p is CadPoint => Boolean(p));
      if (entity.shape && points.length > 2) points.push(points[0]);
    } else if (type === "SPLINE" && Array.isArray(entity.controlPoints)) {
      points = entity.controlPoints.map(point).filter((p: CadPoint | null): p is CadPoint => Boolean(p));
    }
    const segmentsForEntity: Array<{ a: CadPoint; b: CadPoint }> = [];
    for (let i = 0; i < points.length - 1; i++) {
      if (Math.hypot(points[i].x-points[i+1].x, points[i].y-points[i+1].y) < 1e-9) continue;
      segmentsForEntity.push({ a: points[i], b: points[i+1] });
      segments.push({ ...segmentsForEntity[segmentsForEntity.length-1], entityIndex, layer });
    }
    const record: Record<string, unknown> = { entityIndex, type, layer, handle: entity?.handle ?? null };
    if (type === "INSERT") Object.assign(record, { blockName: entity.name ?? entity.block ?? null, insert: entity.position ?? entity.insertionPoint ?? null, rotation: entity.rotation ?? 0, attributes: Array.isArray(entity.attribs) ? entity.attribs : [] });
    if (points.length) record.vertices = points;
    if (["CIRCLE", "ARC", "ELLIPSE"].includes(type)) Object.assign(record, { center: point(entity.center), radius: entity.radius ?? null, startAngle: entity.startAngle ?? null, endAngle: entity.endAngle ?? null });
    if (["TEXT", "MTEXT", "ATTRIB", "ATTDEF"].includes(type)) Object.assign(record, { text: clean(entity.text ?? entity.string ?? ""), position: point(entity.startPoint ?? entity.position ?? entity.insertionPoint), height: entity.textHeight ?? entity.height ?? entity.charHeight ?? null });
    if (supported.has(type)) geometry.push(record);
  });
  const nodes: CadNativeAnalysis["topology"]["nodes"] = [];
  const nodeMap = new Map<string, number>();
  const edges: CadNativeAnalysis["topology"]["edges"] = [];
  const nodeFor = (p: CadPoint) => {
    const key = p.x.toFixed(4) + "|" + p.y.toFixed(4);
    let id = nodeMap.get(key);
    if (id === undefined) { id = nodes.length; nodeMap.set(key, id); nodes.push({ id, x: p.x, y: p.y, degree: 0 }); }
    return id;
  };
  for (const segment of segments) {
    const a = nodeFor(segment.a), b = nodeFor(segment.b);
    if (a === b) continue;
    edges.push({ id: edges.length, source: a, target: b, entityIndex: segment.entityIndex, layer: segment.layer });
    nodes[a].degree++; nodes[b].degree++;
  }
  const crossingCandidates: CadNativeAnalysis["topology"]["crossingCandidates"] = [];
  const boundedSegments = segments.slice(0, 1200);
  for (let i = 0; i < boundedSegments.length && crossingCandidates.length < 300; i++) {
    for (let j = i + 1; j < boundedSegments.length && crossingCandidates.length < 300; j++) {
      if (boundedSegments[i].entityIndex === boundedSegments[j].entityIndex) continue;
      const hit = lineIntersection(boundedSegments[i].a, boundedSegments[i].b, boundedSegments[j].a, boundedSegments[j].b);
      if (hit) crossingCandidates.push({ ...hit, firstEntity: boundedSegments[i].entityIndex, secondEntity: boundedSegments[j].entityIndex });
    }
  }
  return {
    schema: "mercator-cad-native-v1",
    source: "dxf-parser",
    entityCount: entities.length,
    entityCounts,
    layers: [...layerCounts.entries()].map(([name, entityCount]) => ({ name, entityCount })).sort((a,b) => b.entityCount-a.entityCount),
    textBlocks,
    equipmentCandidates: [...equipment.values()],
    parameterCandidates: [...parameters.values()],
    blockReferences,
    geometry: geometry.slice(0, 6000),
    topology: { method: "cad_endpoint_coincidence_candidates", verified: false, nodes, edges, danglingEndpoints: nodes.filter(n => n.degree === 1), junctionCandidates: nodes.filter(n => n.degree >= 3), crossingCandidates },
    limitations: [
      "DWG 會先在瀏覽器轉換為 DXF，再解析 DXF 向量實體；不是直接解碼原生 DWG 二進位格式。",
      "端點座標重合只代表幾何連接候選；交叉線不自動視為電氣導通，接點符號、端子與跨頁連接仍需工程師確認。",
      "圖塊名稱與屬性文字是設備候選，不等於已完成電氣符號分類。",
      "弧線、圓、樣條曲線等保留為 CAD 實體；目前不將其自動轉成導線網路。"
    ]
  };
}
