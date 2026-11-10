# Mercator

Mercator 是面向電氣工程圖紙的智能審查平台。第一版聚焦單份電路圖：文字與設備代號提取、電氣參數候選、連接關係候選、設計疑點及工程師覆核。

## V1 architecture (free-tier first)
- React + Vite + IBM Carbon UI
- Supabase Auth、Postgres、Row Level Security、私有 Storage
- Cloudflare Pages 前端與 Cloudflare Workers API
- PDF.js 將 PDF 頁面轉成瀏覽器可處理的圖像
- Tesseract.js 在使用者瀏覽器本機執行繁體中文與英文 OCR
- Workers AI 提供可選的視覺初篩；受 Cloudflare Free 配額限制
- OCR 文字、設備代號候選、參數候選與審查紀錄保存到 Supabase

PDF、PNG、JPG、WEBP 使用瀏覽器 OCR；DWG/DXF 優先走 CAD 原生資料路徑：DWG 由 `dwgdxf` WASM 轉換為 DXF，再由 `dxf-parser` 解析 CAD 實體、圖層、圖塊參照、ATTRIB/TEXT/MTEXT、幾何座標與端點連接候選。DWG/DXF 原生分析不呼叫圖像識別 API。TIFF 可上傳保存，掃描圖紙需先轉成支援的圖片或 PDF。

## Analysis limitations
- 瀏覽器 OCR 只產生候選文字與設備代號，不代表設備已被可靠分類。
- 電壓、電流、CT 變比等數值只作候選提取，必須核對原圖。
- Workers AI 視覺初篩是可選功能；若免費配額耗盡，OCR 不受影響。
- 本機 OCR 會使用使用者裝置的 CPU / 記憶體；行動裝置處理大型、多頁圖紙可能較慢。
- CAD 幾何端點重合與線段交叉僅為拓撲候選；交叉點不自動視為電氣接點。接點符號、圖塊內部端子、跨頁連接及電氣語義仍需工程師確認，不宣稱已完成工程級 netlist。
- 系統不自動出具規範符合性結論；所有疑點均需工程師覆核。
- Python / OpenCV 分析引擎程式保留在 `engine/`，作為後續可選部署與算法驗證；目前免費生產路徑不依賴 Cloudflare Containers。
- 暫不提供圖紙版本比較、覆蓋或設備移動檢測。

## Local development
1. Install Node.js 20+
2. Run `npm install`
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Run `npm run dev`

Never put Supabase secret/service-role keys in frontend code.
