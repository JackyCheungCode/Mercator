import { createWorker } from "tesseract.js";

export type OcrPageInput = { pageNumber: number; blob: Blob };
export type OcrBoundingBox = { x0: number; y0: number; x1: number; y1: number };
export type OcrLine = { text: string; confidence: number; bbox: OcrBoundingBox | null };
export type OcrPageResult = {
  pageNumber: number;
  text: string;
  confidence: number;
  lines: OcrLine[];
};

export async function recognizePages(
  pages: OcrPageInput[],
  onProgress?: (pageNumber: number, status: string, progress: number) => void,
): Promise<OcrPageResult[]> {
  let currentPageNumber = pages[0]?.pageNumber ?? 1;
  const worker = await createWorker("eng+chi_tra", 1, {
    logger: (message) => {
      onProgress?.(currentPageNumber, message.status, message.progress ?? 0);
    },
  });

  try {
    const results: OcrPageResult[] = [];
    for (const page of pages) {
      currentPageNumber = page.pageNumber;
      const { data } = await worker.recognize(page.blob);
      const lines = (data.lines ?? [])
        .map((line) => ({
          text: line.text.trim(),
          confidence: Math.max(0, Math.min(1, (line.confidence ?? data.confidence ?? 0) / 100)),
          bbox: line.bbox
            ? {
                x0: line.bbox.x0,
                y0: line.bbox.y0,
                x1: line.bbox.x1,
                y1: line.bbox.y1,
              }
            : null,
        }))
        .filter((line) => line.text.length > 0);
      results.push({
        pageNumber: page.pageNumber,
        text: data.text ?? "",
        confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)),
        lines,
      });
      onProgress?.(page.pageNumber, "page-complete", 1);
    }
    return results;
  } finally {
    await worker.terminate();
  }
}
