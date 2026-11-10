export type CandidateNode = {
  id:string;
  label:string;
  category:string;
  bbox?:number[];
  confidence:number;
  source:"vision_candidate";
};
export type CandidateEdge = {
  id:string;
  from:string;
  to:string;
  evidence:string;
  bbox?:number[];
  confidence:number;
  connection_status:"candidate_only";
  junction_confirmed:false;
};
export type CandidateTopology = {
  schema:"mercator-electrical-topology-candidate-v1";
  verified:false;
  nodes:CandidateNode[];
  edges:CandidateEdge[];
  unresolved_edges:number;
  disclaimer:string;
};

const clean=(value:unknown)=>String(value??"").trim();
const confidence=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0.35;};

export function buildCandidateTopology(analysis:Record<string,unknown>):CandidateTopology{
  const labels=Array.isArray(analysis.device_labels)?analysis.device_labels as Array<Record<string,unknown>>:[];
  const wires=Array.isArray(analysis.wire_observations)?analysis.wire_observations as Array<Record<string,unknown>>:[];
  const nodes:CandidateNode[]=[];
  const byLabel=new Map<string,string>();
  for(const item of labels){
    const label=clean(item.text??item.label);
    if(!label)continue;
    const key=label.toLowerCase();
    if(byLabel.has(key))continue;
    const id="component:"+key.replace(/[^a-z0-9_-]+/gi,"_");
    byLabel.set(key,id);
    nodes.push({id,label,category:clean(item.category)||"unknown",bbox:Array.isArray(item.bbox)?item.bbox.map(Number):undefined,confidence:confidence(item.confidence),source:"vision_candidate"});
  }
  const endpoint=(value:unknown)=>{
    const label=clean(value);
    if(!label)return null;
    const key=label.toLowerCase();
    const exact=byLabel.get(key);
    if(exact)return exact;
    const id="endpoint:"+key.replace(/[^a-z0-9_-]+/gi,"_");
    if(!nodes.some(node=>node.id===id))nodes.push({id,label,category:"unmatched_endpoint",confidence:0.25,source:"vision_candidate"});
    return id;
  };
  const edges:CandidateEdge[]=[];
  let unresolved=0;
  for(const [index,item] of wires.entries()){
    const from=endpoint(item.from);
    const to=endpoint(item.to);
    const evidence=clean(item.evidence);
    if(!from||!to||from===to||!evidence){unresolved++;continue;}
    const id="edge:"+index+":"+from+":"+to;
    edges.push({id,from,to,evidence,bbox:Array.isArray(item.bbox)?item.bbox.map(Number):undefined,confidence:confidence(item.confidence),connection_status:"candidate_only",junction_confirmed:false});
  }
  return {
    schema:"mercator-electrical-topology-candidate-v1",
    verified:false,
    nodes,
    edges,
    unresolved_edges:unresolved,
    disclaimer:"此圖僅彙整模型提出的候選元件與端點關係，不是已驗證 netlist。端點配對、導線連續性、交叉點導通與電氣功能均需對照原圖及 CAD 幾何由工程師確認。"
  };
}
