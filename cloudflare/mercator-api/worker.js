const allowedProductionOrigin="https://mercator-47.pages.dev";
const corsBase={"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Max-Age":"86400","Vary":"Origin"};
function corsHeaders(request){const origin=request.headers.get("Origin")||"";let host="";try{host=new URL(origin).hostname;}catch{}const allowed=origin===allowedProductionOrigin||host==="mercator-47d.pages.dev"||host.endsWith(".mercator-47d.pages.dev");return {...corsBase,...(allowed?{"Access-Control-Allow-Origin":origin}:{})};}
function json(data,status=200,headers=corsBase){return new Response(JSON.stringify(data,null,2),{status,headers:{"Content-Type":"application/json; charset=utf-8",...headers}});}
function toBase64(bytes){let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);}
async function authenticate(request,env){const authorization=request.headers.get("Authorization");if(!authorization?.startsWith("Bearer ")||!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY)return null;const r=await fetch(env.SUPABASE_URL+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization}});if(!r.ok)return null;return await r.json();}
const prompt=`你是資深電氣工程圖審查助手，負責對單張電氣圖紙進行嚴謹的視覺初篩。只根據圖片中清楚可見的內容作答，禁止猜測、補造設備、額定值、線路連接、保護整定或規範結論。使用繁體中文，輸出純 JSON 物件，不要 Markdown 圍欄。請盡可能完整回應以下結構：{
"drawing_type":"圖紙類型；無法判斷則寫資訊不足",
"overall_analysis":{
"summary":"用工程師看得懂的文字概述整張圖的用途、可辨識的系統及主要組成",
"drawing_purpose":"圖紙用途",
"system_type":"可見系統類型",
"architecture":"可直接從圖面確認的系統架構",
"power_flow":"可追蹤的供電方向與路徑；看不清楚就明確標示",
"normal_operation":"正常運行方式；無法判斷則標示資訊不足",
"abnormal_operation":"可辨識的故障/備援/切換方式；不可推測",
"key_risks":["有圖面證據支持的整體風險"],
"conclusion":"整體初篩結論，必須說明尚未完成正式校驗"
},
"review_checks":[
{"category":"系統架構與供電路徑","status":"issue_found|no_issue_visible|insufficient_evidence|not_applicable","notes":"可見證據及限制"},
{"category":"設備選型與額定參數","status":"...","notes":"..."},
{"category":"短路、過載與保護配合","status":"...","notes":"..."},
{"category":"開關、隔離與聯鎖","status":"...","notes":"..."},
{"category":"CT/PT 量測與保護回路","status":"...","notes":"..."},
{"category":"接地、接零與等電位","status":"...","notes":"..."},
{"category":"主迴路連接與電路拓撲","status":"...","notes":"..."},
{"category":"控制、信號與二次回路","status":"...","notes":"..."},
{"category":"輔助電源、UPS 與備援","status":"...","notes":"..."},
{"category":"電纜、導線與端子","status":"...","notes":"..."},
{"category":"安全防護與設備標識","status":"...","notes":"..."},
{"category":"圖面完整性與跨區一致性","status":"...","notes":"..."},
{"category":"規範適用性與設計依據","status":"...","notes":"未提供適用規範時必須標示資訊不足"}
],
"categorized_findings":[
{"category":"以上分類之一","title":"問題標題","severity":"critical|high|medium|low|info","description":"具體說明","evidence":"圖面上可定位的文字、符號、區域或連線證據；不可捏造座標","impact":"可能造成的工程影響；不能確認則寫待評估","recommendation":"工程師可執行的核對或修改建議","confidence":0.0,"page_region":"可讀的區域描述","needs_engineer_review":true}
],
"device_labels":[{"text":"可讀設備代號或名稱","category":"設備類型","confidence":0.0}],
"visible_parameters":[{"text":"圖面上可讀的電壓/電流/功率/頻率/CT或PT變比/精度等原文","context":"所屬設備或回路"}],
"possible_visual_issues":[{"type":"分類","description":"圖面可見疑點","evidence":"直接證據","severity":"low|medium|high","needs_engineer_review":true}],
"uncertain_regions":["文字模糊、符號不清或連線無法追蹤的區域"],
"limitations":["單張局部圖像無法驗證的項目及所需補充資料"]
}
審查要求：逐項檢查供電架構、電源進線/母線/饋線、設備代號及額定值、斷路器/熔斷器/隔離開關、過流/短路/接地保護、CT/PT 極性與變比標示、接地與等電位、主迴路連接、控制與聯鎖、輔助電源/UPS、導線與端子標識、圖例/符號/頁間引用。只要圖面未提供所需資料，就使用 insufficient_evidence，不可標成合格或無問題。沒有明確可見異常時，不要製造問題；沒有讀到問題也不得宣稱整張圖安全或符合規範。所有問題都要提供證據、影響與建議；不要把一般工程常識當成圖紙事實。若模型能力或圖像品質不足，直接說明。`;
export default {async fetch(request,env){const url=new URL(request.url);const reply=(data,status=200)=>json(data,status,corsHeaders(request));if(request.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders(request)});if(url.pathname==="/health")return reply({ok:true,service:"mercator-api",version:"0.4.0",aiBinding:Boolean(env.AI),analysisEngine:Boolean(env.MERCATOR_ENGINE_URL&&env.MERCATOR_ENGINE_TOKEN)});if(url.pathname==="/api/v1/capabilities")return reply({service:"Mercator API",version:"0.4.0",drawingFormats:["pdf","png","jpg","jpeg","webp","tif","tiff","dwg","dxf"],maxUploadBytes:52428800,modules:{ocr:Boolean(env.MERCATOR_ENGINE_URL&&env.MERCATOR_ENGINE_TOKEN),visualReview:Boolean(env.AI),symbolDetection:Boolean(env.MERCATOR_ENGINE_URL&&env.MERCATOR_ENGINE_TOKEN),electricalTopology:Boolean(env.MERCATOR_ENGINE_URL&&env.MERCATOR_ENGINE_TOKEN),ruleValidation:"candidate_review_leads_only",revisionComparison:false},aiModels:env.AI?["@cf/moondream/moondream3.1-9B-A2B","@cf/meta/llama-3.2-11b-vision-instruct"]:[],defaultAiModel:"@cf/moondream/moondream3.1-9B-A2B",freeTierDailyNeurons:10000,analysisEngineStatus:env.MERCATOR_ENGINE_URL&&env.MERCATOR_ENGINE_TOKEN?"connected":"not_configured",status:env.AI?"visual-triage-enabled":"foundation"});if(url.pathname==="/api/v1/analyze"&&request.method==="POST"){const user=await authenticate(request,env);if(!user)return reply({error:"UNAUTHORIZED",message:"Please sign in before analyzing a drawing."},401);if(!env.MERCATOR_ENGINE_URL||!env.MERCATOR_ENGINE_TOKEN)return reply({error:"ANALYSIS_ENGINE_NOT_CONFIGURED",message:"The Python analysis engine URL/token has not been configured for this Worker."},503);if(!request.headers.get("Content-Type")?.includes("multipart/form-data"))return reply({error:"INVALID_CONTENT_TYPE",message:"Send a multipart form with a file field."},415);const form=await request.formData();const file=form.get("file");if(!(file instanceof File))return reply({error:"FILE_REQUIRED",message:"A drawing file is required."},400);if(file.size>50*1024*1024)return reply({error:"FILE_TOO_LARGE",message:"Analysis engine upload limit is 50 MB."},413);const upstream=new FormData();upstream.set("file",file,file.name);try{const response=await fetch((env.MERCATOR_ENGINE_URL.endsWith("/")?env.MERCATOR_ENGINE_URL.slice(0,-1):env.MERCATOR_ENGINE_URL)+"/v1/analyze",{method:"POST",headers:{Authorization:"Bearer "+env.MERCATOR_ENGINE_TOKEN},body:upstream});const body=await response.text();return new Response(body,{status:response.status,headers:{"Content-Type":response.headers.get("Content-Type")||"application/json; charset=utf-8",...corsHeaders(request)}});}catch(error){return reply({error:"ANALYSIS_ENGINE_UNAVAILABLE",message:String(error?.message||error)},502);}}if(url.pathname==="/api/v1/visual-review"&&request.method==="POST"){const user=await authenticate(request,env);if(!user)return reply({error:"UNAUTHORIZED",message:"Please sign in before reviewing a drawing."},401);if(!env.AI)return reply({error:"AI_BINDING_NOT_CONFIGURED",message:"Workers AI binding is not configured."},503);if(!request.headers.get("Content-Type")?.includes("multipart/form-data"))return reply({error:"INVALID_CONTENT_TYPE",message:"Send a multipart form with an image file."},415);const form=await request.formData();const file=form.get("file");if(!(file instanceof File))return reply({error:"FILE_REQUIRED",message:"An image file is required."},400);if(!["image/png","image/jpeg","image/webp"].includes(file.type))return reply({error:"UNSUPPORTED_IMAGE",message:"Visual review currently supports PNG, JPG and WEBP images. Convert PDF pages to images first."},415);if(file.size>5*1024*1024)return reply({error:"FILE_TOO_LARGE",message:"Visual review image limit is 5 MB."},413);const modelValue=form.get("model");const supportedModels=["@cf/moondream/moondream3.1-9B-A2B","@cf/meta/llama-3.2-11b-vision-instruct"];const model=typeof modelValue==="string"&&supportedModels.includes(modelValue)?modelValue:"@cf/moondream/moondream3.1-9B-A2B";const bytes=new Uint8Array(await file.arrayBuffer());const image="data:"+file.type+";base64,"+toBase64(bytes);try{const result=model==="@cf/moondream/moondream3.1-9B-A2B"?await env.AI.run(model,{task:"query",image,question:prompt,stream:false,reasoning:true,max_tokens:8192}):await env.AI.run(model,{messages:[{role:"system",content:"你是電氣一次系統圖的視覺初篩助手。只根據圖像可見內容作答，不可捏造。使用繁體中文，明確指出不確定性與工程師覆核要求。"+prompt},{role:"user",content:"請分析這張電氣圖紙。"}],image,max_tokens:2048});return reply({ok:true,model,mode:"visual_triage",filename:file.name,result,disclaimer:"AI 視覺初篩不是正式電氣校驗；不得據此判定合規或設計錯誤。所有疑點均需工程師核實。"});}catch(error){return reply({error:"AI_INFERENCE_FAILED",model,message:String(error?.message||error)},502);}}if(url.pathname==="/api/v1/review-jobs"&&request.method==="POST")return reply({error:"ANALYSIS_ENGINE_NOT_CONNECTED",message:"OCR/PDF/DXF processing engine is still being integrated."},503);return reply({error:"NOT_FOUND",message:"Route not found."},404);}};