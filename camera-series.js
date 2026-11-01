(function(root){
  'use strict';
  let loading;
  function load(){
    if(loading)return loading;
    loading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const timer=setTimeout(()=>reject(new Error('Beeldverwerking laden duurt te lang. Probeer opnieuw.')),60000);
      script.src='vendor/opencv.js';
      script.onerror=()=>{clearTimeout(timer);reject(new Error('Beeldverwerking niet beschikbaar. Controleer je verbinding.'));};
      script.onload=async()=>{
        try{
          let cv=root.cv;
          // Some OpenCV builds expose a self-returning thenable, not a Promise.
          if(cv instanceof Promise)cv=await cv;
          if(!cv.Mat)await new Promise(r=>{cv.onRuntimeInitialized=r;});
          if(typeof cv.then==='function')delete cv.then;
          clearTimeout(timer);resolve(cv);
        }catch(e){clearTimeout(timer);reject(e);}
      };
      document.head.appendChild(script);
    }).catch(e=>{loading=null;throw e;});
    return loading;
  }
  function validCorners(points){
    if(points.length!==4)return false;
    const cross=[];let area=0;
    for(let i=0;i<4;i++){
      const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4];
      if(!Number.isFinite(a.x)||!Number.isFinite(a.y)||a.x<0||a.x>1||a.y<0||a.y>1)return false;
      cross.push((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x));
      area+=a.x*b.y-b.x*a.y;
    }
    return cross.every(n=>n>0)&&area>.08;
  }
  async function readPhoto(file,options={}){
    if(file.size>30000000)throw new Error('Deze foto is te groot. Kies een foto kleiner dan 30 MB.');
    const url=URL.createObjectURL(file);
    try{
      const image=new Image();image.src=url;await image.decode();
      const maxDimension=Math.max(1800,Math.min(4000,Number(options.maxDimension)||1800));
      const scale=Math.min(1,maxDimension/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      if(Math.min(canvas.width,canvas.height)<400)throw new Error('De foto is te klein. Gebruik een scherpere foto van dichtbij.');
      return {canvas,url:canvas.toDataURL('image/jpeg',.92),corners:[]};
    }catch(e){throw new Error(e.message||'Foto kon niet worden geopend. Kies een JPEG of PNG.');}
    finally{URL.revokeObjectURL(url);}
  }
  // Fits calibre-sized circles to visible boundary arcs. Area is supporting
  // evidence only: the union of overlapping holes is not the sum of their areas.
  function holeEvidence(pixels,width,height,rx,ry){
    const at=(x,y)=>x>=0&&y>=0&&x<width&&y<height&&pixels[y*width+x]!==0;
    const edge=[],inside=[];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(at(x,y)){
      inside.push([x,y]);
      if(!at(x-1,y)||!at(x+1,y)||!at(x,y-1)||!at(x,y+1))edge.push([x,y]);
    }
    const unitArea=Math.PI*rx*ry,areaEquivalent=inside.length/unitArea;
    if(!inside.length||rx<2||ry<2||rx>50||ry>50)return {centers:[],areaEquivalent,arcCount:0};
    const angles=Array.from({length:72},(_,i)=>[Math.cos(i*Math.PI/36)*rx,Math.sin(i*Math.PI/36)*ry]);
    const votes=new Uint16Array(width*height);
    for(const [x,y] of edge)for(const [dx,dy] of angles){
      const cx=Math.round(x-dx),cy=Math.round(y-dy);
      if(at(cx,cy))votes[cy*width+cx]++;
    }
    const nearEdge=new Uint8Array(width*height);
    for(const [x,y] of edge)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(x+dx>=0&&y+dy>=0&&x+dx<width&&y+dy<height)nearEdge[(y+dy)*width+x+dx]=1;
    }
    const proposals=[];
    for(const [x,y] of inside){
      if(votes[y*width+x]<8)continue;
      let support=0,fill=0;
      for(const [dx,dy] of angles){
        const bx=Math.round(x+dx),by=Math.round(y+dy);
        if(bx>=0&&by>=0&&bx<width&&by<height&&nearEdge[by*width+bx])support++;
        if(at(Math.round(x+dx*.65),Math.round(y+dy*.65)))fill++;
      }
      if(support>=32&&fill>=58)proposals.push({x,y,support:support/72,votes:votes[y*width+x]});
    }
    proposals.sort((a,b)=>b.votes-a.votes||b.support-a.support);
    const centers=[],covered=new Uint8Array(width*height);
    for(const p of proposals){
      if(centers.length>=10)break;
      if(centers.some(q=>Math.hypot((p.x-q.x)/rx,(p.y-q.y)/ry)<.9))continue;
      const footprint=inside.filter(([x,y])=>((x-p.x)/rx)**2+((y-p.y)/ry)**2<=1.15);
      if(footprint.filter(([x,y])=>!covered[y*width+x]).length<unitArea*.22)continue;
      centers.push(p);for(const [x,y] of footprint)covered[y*width+x]=1;
    }
    return {centers,areaEquivalent,arcCount:centers.length};
  }
  async function compare(before,after,options={}){
    const caliber=Number(options.caliber),cardWidth=Number(options.cardWidth),cardHeight=Number(options.cardHeight);
    const calibrated=caliber>=2&&caliber<=20&&cardWidth>=50&&cardWidth<=2000&&cardHeight>=50&&cardHeight<=2000;
    const rx=calibrated?caliber*640/cardWidth/2:0,ry=calibrated?caliber*900/cardHeight/2:0;

    if(!validCorners(before.corners)||!validCorners(after.corners))throw new Error('Markeer op beide foto\'s de hoeken: linksboven, rechtsboven, rechtsonder, linksonder.');
    const cv=await load(),owned=[],keep=m=>{owned.push(m);return m;};
    const W=640,H=900;
    try{
      function rectify(photo){
        const source=keep(cv.imread(photo.canvas));
        const src=keep(cv.matFromArray(4,1,cv.CV_32FC2,photo.corners.flatMap(p=>[p.x*source.cols,p.y*source.rows])));
        const dst=keep(cv.matFromArray(4,1,cv.CV_32FC2,[0,0,W-1,0,W-1,H-1,0,H-1]));
        const transform=keep(cv.getPerspectiveTransform(src,dst)),output=keep(new cv.Mat());
        cv.warpPerspective(source,output,transform,new cv.Size(W,H),cv.INTER_LINEAR,cv.BORDER_REPLICATE);
        const gray=keep(new cv.Mat());cv.cvtColor(output,gray,cv.COLOR_RGBA2GRAY);
        return {output,gray};
      }
      const a=rectify(before),b=rectify(after);
      function sharpness(gray){
        const lap=keep(new cv.Mat()),mean=keep(new cv.Mat()),std=keep(new cv.Mat());
        cv.Laplacian(gray,lap,cv.CV_64F);cv.meanStdDev(lap,mean,std);
        return std.doubleAt(0,0)**2;
      }
      const sa=sharpness(a.gray),sb=sharpness(b.gray);
      if(Math.min(sa,sb)<15||Math.min(sa,sb)/Math.max(sa,sb)<.32)throw new Error('Een foto is te onscherp of de scherpstelling verschilt te veel. Maak de foto opnieuw.');
      // Normalize global exposure before finding localized, persistent changes.
      function normalize(gray){
        const mean=keep(new cv.Mat()),std=keep(new cv.Mat()),out=keep(new cv.Mat());
        cv.meanStdDev(gray,mean,std);
        const gain=55/Math.max(20,std.doubleAt(0,0));
        gray.convertTo(out,cv.CV_8U,gain,125-gain*mean.doubleAt(0,0));
        cv.GaussianBlur(out,out,new cv.Size(3,3),0);return out;
      }
      const ga=normalize(a.gray),gb=normalize(b.gray);
      // A small residual shift is estimated on printed detail, not the new holes.
      const rect=new cv.Rect(24,24,W-48,H-48),templ=keep(ga.roi(rect)),correlation=keep(new cv.Mat());
      cv.matchTemplate(gb,templ,correlation,cv.TM_CCOEFF_NORMED);
      const match=cv.minMaxLoc(correlation);
      if(match.maxVal<.9)throw new Error('De kaarten verschillen te veel. Controleer de hoeken, belichting en of dit dezelfde kaart is.');
      const dx=match.maxLoc.x-24,dy=match.maxLoc.y-24;
      if(Math.abs(dx)>12||Math.abs(dy)>12)throw new Error('De kaart is niet nauwkeurig uitgelijnd. Markeer de hoeken opnieuw.');
      const shift=keep(cv.matFromArray(2,3,cv.CV_64F,[1,0,-dx,0,1,-dy]));
      const aligned=keep(new cv.Mat()),display=keep(new cv.Mat());
      cv.warpAffine(gb,aligned,shift,new cv.Size(W,H),cv.INTER_LINEAR,cv.BORDER_REPLICATE);
      cv.warpAffine(b.output,display,shift,new cv.Size(W,H),cv.INTER_LINEAR,cv.BORDER_REPLICATE);
      // Remove gradual lighting changes, preserving small new holes of either polarity.
      const backgroundA=keep(new cv.Mat()),backgroundB=keep(new cv.Mat());
      cv.GaussianBlur(ga,backgroundA,new cv.Size(41,41),0);
      cv.GaussianBlur(aligned,backgroundB,new cv.Size(41,41),0);
      const diff=keep(new cv.Mat(H,W,cv.CV_8U)),mask=keep(new cv.Mat()),histogram=new Uint32Array(256);
      for(let y=0;y<H;y++)for(let x=0;x<W;x++){
        const i=y*W+x;
        // Cap at the actual change so background correction cannot create halos.
        const raw=ga.data[i]-aligned.data[i];
        const value=Math.min(255,Math.abs(raw),Math.abs(raw-(backgroundA.data[i]-backgroundB.data[i])));
        diff.data[i]=value;
        if(x>=18&&x<W-18&&y>=18&&y<H-18)histogram[value]++;
      }
      // Estimate noise robustly; a handful of holes must not raise the threshold.
      const sampleCount=(W-36)*(H-36);let sum=0,median=0;
      while(median<255&&(sum+=histogram[median])<sampleCount/2)median++;
      const strongThreshold=Math.min(55,Math.max(18,median*6));
      cv.threshold(diff,mask,Math.max(12,strongThreshold*.6),255,cv.THRESH_BINARY);
      if(cv.countNonZero(mask)/(W*H)>.035)throw new Error('Te veel beeldverandering: mogelijk schaduw, beweging of scherpstellen. Maak de foto opnieuw.');
      const labels=keep(new cv.Mat()),stats=keep(new cv.Mat()),centers=keep(new cv.Mat());
      const count=cv.connectedComponentsWithStats(mask,labels,stats,centers,8,cv.CV_32S),candidates=[];
      for(let i=1;i<count;i++){
        const x=stats.intAt(i,cv.CC_STAT_LEFT),y=stats.intAt(i,cv.CC_STAT_TOP),w=stats.intAt(i,cv.CC_STAT_WIDTH),h=stats.intAt(i,cv.CC_STAT_HEIGHT),area=stats.intAt(i,cv.CC_STAT_AREA);
        if(area<7||area>(calibrated?Math.min(12000,Math.PI*rx*ry*12):650)||w>(calibrated?Math.min(160,rx*10):42)||h>(calibrated?Math.min(160,ry*10):42)||Math.max(w/(rx||1),h/(ry||1))/Math.max(1,Math.min(w/(rx||1),h/(ry||1)))>5||x<18||y<18||x+w>W-18||y+h>H-18)continue;
        // Weak edge pixels belong to a hole only if the component has a clear core.
        // Thin, scattered changes usually come from printed edges or camera noise.
        if(area/(w*h)<.25)continue;
        let peak=0;
        for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){
          if(labels.intAt(yy,xx)===i)peak=Math.max(peak,diff.data[yy*W+xx]);
        }
        if(peak<strongThreshold)continue;
        const pixels=new Uint8Array(w*h);
        // Use the stronger core for area and contour measurements; blurred fringes
        // otherwise overestimate a small hole's diameter and merge nearby holes.
        let coreArea=0;
        for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
          if(labels.intAt(y+yy,x+xx)===i&&diff.data[(y+yy)*W+x+xx]>=Math.max(strongThreshold,peak*.45)){pixels[yy*w+xx]=1;coreArea++;}
        }
        const evidence=calibrated?holeEvidence(pixels,w,h,rx,ry):{centers:[],arcCount:0,areaEquivalent:null};
        const fits=evidence.centers.length?evidence.centers:[{x:centers.doubleAt(i,0)-x,y:centers.doubleAt(i,1)-y,support:0}];
        const multiple=fits.length>1,ratio=evidence.areaEquivalent;
        const reasons=[];
        if(!calibrated)reasons.push('Kaliber en kaartafmetingen ontbreken.');
        else if(rx<2||ry<2)reasons.push('Te weinig beeldpixels per schotgat.');
        if(calibrated&&!evidence.arcCount)reasons.push('Geen overtuigende boog op kalibergrootte.');
        if(multiple)reasons.push('Overlappende gaten: controleer aantal en afzonderlijke posities.');
        if(calibrated&&(ratio<.55||ratio>fits.length*1.35))reasons.push('Oppervlakte past niet goed bij het geschatte aantal.');
        if(peak<strongThreshold*2)reasons.push('Weinig contrast.');
        if(match.maxVal<.96)reasons.push('Uitlijning minder zeker.');
        for(const fit of fits){
          const confidence=!calibrated||!evidence.arcCount||ratio<.55||ratio>fits.length*1.35?'low':multiple||fit.support<.8||peak<strongThreshold*2||match.maxVal<.96?'medium':'high';
          candidates.push({x:(x+fit.x)/W,y:(y+fit.y)/H,area,confidence,reasons:reasons.length?reasons:['Oppervlakte en zichtbare boog passen bij het kaliber.'],groupId:i,estimatedCount:fits.length,arcCount:evidence.arcCount,arcSupport:fit.support,areaEquivalent:ratio,areaMm2:calibrated?coreArea*cardWidth*cardHeight/(W*H):null});
        }
      }
      if(candidates.length>25)throw new Error('Te veel mogelijke inslagen. Controleer de uitlijning en maak een nieuwe foto.');
      const canvas=document.createElement('canvas');cv.imshow(canvas,display);
      const beforeCanvas=document.createElement('canvas');cv.imshow(beforeCanvas,a.output);
      return {url:canvas.toDataURL('image/jpeg',.93),beforeUrl:beforeCanvas.toDataURL('image/jpeg',.93),candidates,quality:match.maxVal};
    }finally{owned.reverse().forEach(m=>m.delete());}
  }
  root.EppCameraSeries={load,readPhoto,compare,validCorners,holeEvidence};
})(globalThis);
