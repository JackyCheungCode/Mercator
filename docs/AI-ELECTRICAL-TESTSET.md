# Mercator 電氣圖紙 AI 測試集與驗收規則

版本：v0.1（初始真實圖紙清單）
用途：比較 Workers AI 視覺模型、瀏覽器端 OCR/幾何解析與拓撲重建候選。這份清單不是已完成標註的 ground truth。

## 初始真實圖紙樣本

以下樣本已存在於 Mercator 的 drawings 記錄中。資料庫目前有重複上傳，測試集按不同檔名/內容去重，不把重複上傳當成獨立樣本。

| 樣本 ID | 檔案 | 格式 | 已知上傳數 | 測試重點 |
|---|---|---:|---:|---|
| MERC-EL-001 | mmexport1794296829676.png | PNG | 8 | 電氣圖文字、設備標籤、參數、圖面區域定位 |
| MERC-EL-002 | Soliview SQ26091801-JS 2500KVA 极兔箱变设计图-V5(3).dwg | DWG | 8 | DWG→DXF、圖層/圖塊/文字提取、CAD 幾何 |
| MERC-EL-003 | Screenshot_2026-11-10-16-09-25-776_com.android.chrome.jpg | JPG | 1 | 螢幕截圖品質、縮放/壓縮後 OCR 與視覺識別 |

注意：目前尚未取得工程師逐項標註的設備、參數與 netlist 真值。模型對這些樣本的輸出只能列為候選，不能計算成已驗證準確率。

### MERC-EL-001 已有 OCR 候選（不是 ground truth）

現有瀏覽器 Tesseract 結果僅 1 個文字區塊，confidence 約 0.34。OCR 字串中出現以下候選，需工程師放大原圖逐項確認後才能轉為標註：
- 160 kVA / SE-160kVA
- CT 變比候選：1500/5（OCR 片段重複出現）
- 開關/設備代號候選：NXA32N25-MD3、NXA16N16-MD3
- 電源/控制電壓候選：AC220V
- 其餘文字受低信心 OCR 影響，暫不列入標註。

### Workers AI Qwen smoke test（非 Mercator 真實圖紙）

使用 schematic-extractor 公開的 Bryston 放大器電路圖作為模型連通性與輸出格式測試：
- 模型：Qwen 3.8 27B，thinking 關閉、JSON response format。
- API：成功；finish_reason=stop。
- 回傳：20 個設備標籤候選、20 個參數候選、5 個連線候選。
- 用量：約 1,282 Neurons。
- 限制：尚未由人工逐項比對真值；bbox 輸出使用 0–1000 座標，前端已加正規化；此 smoke test 不計入 Mercator 測試集準確率。


## 每個樣本需要的人工標註

1. 頁面尺寸、圖紙類型、圖框/區域。
2. 設備：標籤原文、設備類型、bbox、所在回路。
3. 參數：原文、單位、所屬設備/回路、bbox。
4. 導線：線段端點、交叉點、明確接點/非接點、端子歸屬。
5. 電氣拓撲：component、pin、net 關係；無法判定的連接必須標為 uncertain。
6. 專業審查問題：必須有原圖證據、設計依據及工程師確認結果。

## 比較流程

對每張原始圖紙固定使用相同版本、相同輸入解析度及相同切圖策略，分別執行：
- Qwen 3.8 27B（Workers AI）
- Llama 3.2 11B Vision（Workers AI）
- Moondream 3.1（Workers AI）
- 本機 Tesseract OCR
- 本機幾何候選提取
- CAD 原生 DXF 實體/文字提取（適用 DWG/DXF）

保存原始模型回應、模型 ID、輸入尺寸、耗時、Neurons、解析結果及工程師修正紀錄。

## 評估指標

- 設備標籤：precision / recall / F1。
- OCR 與參數：字串 exact-match、單位/數值 exact-match。
- bbox：IoU 與中心點偏差。
- 導線：線段 precision / recall / F1。
- 拓撲：component-pin-to-net connectivity F1。
- 幻覺率：不存在的設備、參數、接線或問題點佔全部輸出的比例。
- 問題證據率：每個問題是否有可核對的圖面位置及原始證據。
- 成本/延遲：每頁 Neurons、Token、推理時間、失敗/逾時比例。

## 初步驗收門檻（需工程師確認後採用）

- 設備識別 F1 ≥ 0.90。
- OCR/電氣參數 exact-match ≥ 0.95。
- 拓撲連接 F1 ≥ 0.85（僅限密度及圖面品質在支援範圍內的樣本）。
- 幻覺率 ≤ 0.02；沒有證據的問題點一律不得升級為設計缺陷。
- 低品質/超密集/掃描失真樣本必須明確標記低信心或無法識別，不得輸出「合格」。

上述指標必須以人工標註 ground truth 計算。若尚未完成標註或樣本數不足，quality_gate 必須保持 not_evaluated。

## 安全與產品狀態規則

- 模型推理成功 ≠ 設備識別成功 ≠ 拓撲重建成功 ≠ 電氣審查通過。
- 「資訊不足」不能被轉成 Critical/High 問題。
- 沒有明確端點證據的交叉線不能當成電氣接點。
- 沒有設計條件、額定值、短路容量、保護整定值及適用規範時，不得聲稱設計合規。
- 在測試集達標及工程師確認之前，產品狀態只允許顯示「AI 候選結果／待工程師覆核」。

## 開源專案借鑑與授權

- vitaliy-hnatyk/sketch2schematic-ai：MIT；借鑑瀏覽器端 heuristic/WASM、OpenCV 線段提取、Tesseract OCR、ONNX optional detector 及 graph cleanup。其 YOLO 權重未隨 repo 提供，不能假設可直接得到完整符號識別。
- yashpatil582/circuit-extract：MIT；借鑑 DXF 原生解析、OCR、圖像切片、Hough 線段、KD-tree snapping、provenance 及 review queue。其視覺偵測預設依賴 Gemini/Claude API，不能原封不動視為無外部服務。
- D4NGYY/schematic-extractor：MIT；借鑑 Components↔Nets 圖、端點幾何、密度 gate 及 topology-aware F1 評估。專案本身也明確指出其結果是結構候選，不是電氣模擬或正式驗證。

不直接複製整套 Streamlit/Python 服務；優先移植可在瀏覽器執行的解析與圖結構算法，保留 Mercator 現有 Pages、Worker、Supabase 與 DWG/DXF 工作流。
