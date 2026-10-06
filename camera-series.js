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
  async function readPhoto(file){
    if(file.size>30000000)throw new Error('Deze foto is te groot. Kies een foto kleiner dan 30 MB.');
    const url=URL.createObjectURL(file);
    try{
      const image=new Image();image.src=url;await image.decode();
      const scale=Math.min(1,1800/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      if(Math.min(canvas.width,canvas.height)<400)throw new Error('De foto is te klein. Gebruik een scherpere foto van dichtbij.');
      return {canvas,url:canvas.toDataURL('image/jpeg',.92),corners:[]};
    }catch(e){throw new Error(e.message||'Foto kon niet worden geopend. Kies een JPEG of PNG.');}
    finally{URL.revokeObjectURL(url);}
  }
  async function compare(before,after){
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
      const diff=keep(new cv.Mat()),mask=keep(new cv.Mat());cv.absdiff(ga,aligned,diff);cv.threshold(diff,mask,38,255,cv.THRESH_BINARY);
      const kernel=keep(cv.Mat.ones(3,3,cv.CV_8U));cv.morphologyEx(mask,mask,cv.MORPH_OPEN,kernel);
      if(cv.countNonZero(mask)/(W*H)>.035)throw new Error('Te veel beeldverandering: mogelijk schaduw, beweging of scherpstellen. Maak de foto opnieuw.');
      const labels=keep(new cv.Mat()),stats=keep(new cv.Mat()),centers=keep(new cv.Mat());
      const count=cv.connectedComponentsWithStats(mask,labels,stats,centers,8,cv.CV_32S),candidates=[];
      for(let i=1;i<count;i++){
        const x=stats.intAt(i,cv.CC_STAT_LEFT),y=stats.intAt(i,cv.CC_STAT_TOP),w=stats.intAt(i,cv.CC_STAT_WIDTH),h=stats.intAt(i,cv.CC_STAT_HEIGHT),area=stats.intAt(i,cv.CC_STAT_AREA);
        if(area<7||area>650||w>42||h>42||Math.max(w,h)/Math.max(1,Math.min(w,h))>3||x<18||y<18||x+w>W-18||y+h>H-18)continue;
        candidates.push({x:centers.doubleAt(i,0)/W,y:centers.doubleAt(i,1)/H,area});
      }
      if(candidates.length>25)throw new Error('Te veel mogelijke inslagen. Controleer de uitlijning en maak een nieuwe foto.');
      const canvas=document.createElement('canvas');cv.imshow(canvas,display);
      const beforeCanvas=document.createElement('canvas');cv.imshow(beforeCanvas,a.output);
      return {url:canvas.toDataURL('image/jpeg',.93),beforeUrl:beforeCanvas.toDataURL('image/jpeg',.93),candidates,quality:match.maxVal};
    }finally{owned.reverse().forEach(m=>m.delete());}
  }
  root.EppCameraSeries={load,readPhoto,compare,validCorners};
})(globalThis);
