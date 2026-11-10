# Mercator
Mercator 是面向電氣工程圖紙的智能審查平台。第一版建立圖紙安全管理、審查任務資料模型與審查工作台，後續逐步接入 Python 圖紙識別引擎。

## V1 foundation
- React + Vite + IBM Carbon UI
- Supabase Auth、Postgres、Row Level Security、私有 Storage
- Cloudflare Pages 前端部署
- 圖紙格式：PDF、PNG、JPG、WEBP、TIFF、DWG、DXF
- 單檔上限：50 MB
- 審查任務、元件識別、問題清單資料模型
- 預留 OCR、符號識別、電氣拓撲、規則校驗與版本比較接口

本階段上傳後只建立待處理任務；尚未啟用實際 OCR / YOLO 識別，也不會虛構審查結果。AI 輔助結果必須由工程師覆核。

## Local development
1. Install Node.js 20+
2. Run npm install
3. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
4. Run npm run dev

Never put Supabase secret/service-role keys in frontend code.