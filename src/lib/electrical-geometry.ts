export type NormalizedSegment = { x1:number; y1:number; x2:number; y2:number; orientation:"horizontal"|"vertical"; confidence:number };
export type ElectricalGeometry = {
  width:number;
  height:number;
  source:"browser-raster-geometry-v1";
  segments:NormalizedSegment[];
  crossings:Array<{x:number;y:number;kind:"crossing_candidate"}>;
  endpoints:Array<{x:number;y:number}>;
  stats:{horizontal_segments:number;vertical_segments:number;crossing_candidates:number;truncated:boolean};
  disclaimer:string;
};

function mergeRuns(runs:Array<{a:number;b:number;fixed:number}>,gap:number){
  runs.sort((a,b)=>a.fixed-b.fixed||a.a-b.a);
  const out:typeof runs=[];
  for(const run of runs){
    const last=out[out.length-1];
    if(last&&last.fixed===run.fixed&&run.a<=last.b+gap)last.b=Math.max(last.b,run.b);
    else out.push({...run});
  }
  return out;
}

export async function extractElectricalGeometry(blob:Blob,maxDimension=1000):Promise<ElectricalGeometry>{
  const bitmap=await createImageBitmap(blob);
  try{
    const scale=Math.min(1,maxDimension/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*scale));
    const height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext("2d",{willReadFrequently:true});
    if(!context)throw new Error("無法建立本機圖形解析畫布。");
    context.fillStyle="#fff";context.fillRect(0,0,width,height);
    context.drawImage(bitmap,0,0,width,height);
    const pixels=context.getImageData(0,0,width,height).data;
    const gray=new Uint8Array(width*height);
    const saturation=new Uint8Array(width*height);
    let histogram=0;
    for(let i=0,p=0;i<pixels.length;i+=4,p++){
      const red=pixels[i],green=pixels[i+1],blue=pixels[i+2];
      const value=Math.round(red*0.299+green*0.587+blue*0.114);
      gray[p]=value;
      saturation[p]=Math.max(red,green,blue)-Math.min(red,green,blue);
      if(value<190)histogram++;
    }
    const threshold=histogram/(width*height)>0.38?145:178;
    const ink=new Uint8Array(width*height);
    for(let p=0;p<ink.length;p++)ink[p]=gray[p]<threshold||(saturation[p]>38&&gray[p]<245)?1:0;
    const rowRuns:Array<{a:number;b:number;fixed:number}>=[];
    const colRuns:Array<{a:number;b:number;fixed:number}>=[];
    const minHorizontal=Math.max(18,Math.round(width*0.014));
    const minVertical=Math.max(18,Math.round(height*0.014));
    for(let y=0;y<height;y++){
      let start=-1;
      for(let x=0;x<=width;x++){
        const dark=x<width&&ink[y*width+x]===1;
        if(dark&&start<0)start=x;
        if(!dark&&start>=0){
          if(x-start>=minHorizontal)rowRuns.push({a:start,b:x-1,fixed:y});
          start=-1;
        }
      }
    }
    for(let x=0;x<width;x++){
      let start=-1;
      for(let y=0;y<=height;y++){
        const dark=y<height&&ink[y*width+x]===1;
        if(dark&&start<0)start=y;
        if(!dark&&start>=0){
          if(y-start>=minVertical)colRuns.push({a:start,b:y-1,fixed:x});
          start=-1;
        }
      }
    }
    const horizontal=mergeRuns(rowRuns,2).slice(0,500);
    const vertical=mergeRuns(colRuns,2).slice(0,500);
    const segments:NormalizedSegment[]=[
      ...horizontal.map(r=>({x1:r.a/width,y1:r.fixed/height,x2:r.b/width,y2:r.fixed/height,orientation:"horizontal" as const,confidence:Math.min(0.9,0.45+(r.b-r.a)/Math.max(1,width)*0.8)})),
      ...vertical.map(r=>({x1:r.fixed/width,y1:r.a/height,x2:r.fixed/width,y2:r.b/height,orientation:"vertical" as const,confidence:Math.min(0.9,0.45+(r.b-r.a)/Math.max(1,height)*0.8)}))
    ];
    const crossings:Array<{x:number;y:number;kind:"crossing_candidate"}>=[];
    for(const h of horizontal){
      for(const v of vertical){
        if(v.fixed>=h.a&&v.fixed<=h.b&&h.fixed>=v.a&&h.fixed<=v.b){
          crossings.push({x:v.fixed/width,y:h.fixed/height,kind:"crossing_candidate"});
          if(crossings.length>=300)break;
        }
      }
      if(crossings.length>=300)break;
    }
    const endpoints:Array<{x:number;y:number}>=[];
    for(const segment of segments){
      endpoints.push({x:segment.x1,y:segment.y1},{x:segment.x2,y:segment.y2});
      if(endpoints.length>=1000)break;
    }
    return {
      width,height,source:"browser-raster-geometry-v1",segments:segments.slice(0,1000),crossings,endpoints,
      stats:{horizontal_segments:horizontal.length,vertical_segments:vertical.length,crossing_candidates:crossings.length,truncated:rowRuns.length>500||colRuns.length>500},
      disclaimer:"本機影像幾何候選，不代表已確認導線、電氣連接或節點；交叉線是否導通仍需依圖面接點符號及工程師覆核。"
    };
  }finally{bitmap.close();}
}
