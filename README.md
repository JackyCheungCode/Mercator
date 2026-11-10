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

第一版支援 PDF、PNG、JPG、WEBP 的瀏覽器 OCR；單次最多處理 10 頁，避免長文件讓一般裝置記憶體或 CPU 過載。TIFF、DWG、DXF 可上傳保存，但目前尚未提供瀏覽器端完整解析。

## Analysis limitations
- 瀏覽器 OCR 只產生候選文字與設備代號，不代表設備已被可靠分類。
- 電壓、電流、CT 變比等數值只作候選提取，必須核對原圖。
- Workers AI 視覺初篩是可選功能；若免費配額耗盡，OCR 不受影響。
- 本機 OCR 會使用使用者裝置的 CPU / 記憶體；行動裝置處理大型、多頁圖紙可能較慢。
- 正式電氣拓撲需要識別導線、端點、交叉點、接點符號、跨頁連接與設備端子；目前不宣稱已完成工程級拓撲推理。
- 系統不自動出具規範符合性結論；所有疑點均需工程師覆核。
- Python / OpenCV 分析引擎程式保留在 `engine/`，作為後續可選部署與算法驗證，不是目前免費架構的線上依賴。
- 暫不提供圖紙版本比較、覆蓋或設備移動檢測。

## Local development
1. Install Node.js 20+
2. Run `npm install`
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Run `npm run dev`

Never put Supabase secret/service-role keys in frontend code.
