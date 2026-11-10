import DxfParser from "dxf-parser";
import { analyzeCadEntities } from "../lib/cad-native-analysis";

type WorkerRequest = { dxfText: string };
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const parser = new DxfParser();
    const drawing = parser.parseSync(event.data.dxfText);
    const analysis = analyzeCadEntities(drawing);
    self.postMessage({ ok: true, analysis });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
