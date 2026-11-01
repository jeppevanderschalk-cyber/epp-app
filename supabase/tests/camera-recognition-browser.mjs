import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/epp-audit-tools/node_modules/playwright/index.mjs');
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Camera recognition tests</title>');return;}try{const path=resolve(root,'.'+req.url);if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type','text/javascript');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
const page=await browser.newPage();
page.on('console',m=>console.log(m.text()));
await page.goto('http://127.0.0.1:'+server.address().port+'/');
await page.addScriptTag({url:'/camera-series.js'});
await page.evaluate(async()=>{
      const corners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
      function make(holes=false,brightness=1,blur=0){
        const c=document.createElement('canvas');c.width=640;c.height=900;const ctx=c.getContext('2d');
        ctx.fillStyle='#eee';ctx.fillRect(0,0,640,900);ctx.fillStyle='#222';
        ctx.beginPath();ctx.moveTo(230,210);ctx.lineTo(400,210);ctx.lineTo(550,420);ctx.lineTo(550,680);ctx.lineTo(400,820);ctx.lineTo(230,820);ctx.lineTo(90,680);ctx.lineTo(90,420);ctx.closePath();ctx.fill();
        ctx.strokeStyle='white';ctx.lineWidth=3;ctx.beginPath();ctx.arc(320,450,60,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle='#222';for(const x of [108,532]){ctx.beginPath();ctx.arc(x,104,50,0,Math.PI*2);ctx.fill();}
        ctx.fillStyle='white';ctx.font='bold 24px sans-serif';ctx.fillText('5',314,458);ctx.fillText('4',314,320);
        ctx.beginPath();ctx.arc(240,600,5,0,Math.PI*2);ctx.fill();
        if(holes){for(const [x,y] of [[340,490],[210,360]]){ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();}}
        if(brightness!==1){const pixels=ctx.getImageData(0,0,640,900);for(let i=0;i<pixels.data.length;i+=4)for(let k=0;k<3;k++)pixels.data[i+k]*=brightness;ctx.putImageData(pixels,0,0);}
        if(blur){const copy=document.createElement('canvas');copy.width=640;copy.height=900;copy.getContext('2d').drawImage(c,0,0);ctx.filter='blur('+blur+'px)';ctx.drawImage(copy,0,0);}
        return {canvas:c,corners,url:c.toDataURL('image/png')};
      }
      await EppCameraSeries.load();
      const blank=make(),changed=make(true),same=await EppCameraSeries.compare(blank,blank);
      if(same.candidates.length!==0)throw Error('Identical image has false positives');
      const light=await EppCameraSeries.compare(blank,make(false,.8));
      if(light.candidates.length!==0)throw Error('Exposure change has false positives');
      const detected=await EppCameraSeries.compare(blank,changed);
      if(detected.candidates.length!==2)throw Error('Expected two new holes, got '+detected.candidates.length);
      const shifted=make(true),copy=make(true);shifted.canvas.getContext('2d').drawImage(copy.canvas,7,5);
      const aligned=await EppCameraSeries.compare(blank,shifted);
      if(aligned.candidates.length!==2)throw Error('Residual camera shift was not corrected');
      let rejected=false;try{await EppCameraSeries.compare(blank,make(false,1,5));}catch{rejected=true;}
      if(!rejected)throw Error('Blur was not rejected');
      if(EppCameraSeries.validCorners([corners[0],corners[2],corners[1],corners[3]]))throw Error('Crossed corners accepted');
      
      async function check(name,photo,points){
        const result=await EppCameraSeries.compare(blank,photo);
        if(result.candidates.length!==points.length)throw Error(name+': expected '+points.length+', got '+JSON.stringify(result.candidates));
        for(const [x,y] of points)if(!result.candidates.some(p=>Math.hypot(p.x*640-x,p.y*900-y)<4))throw Error(name+': inaccurate center');
        console.log('PASS '+name);
      }
      function dots(points){const photo=make();const ctx=photo.canvas.getContext('2d');for(const [x,y,r,color] of points){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}return photo;}
      await check('low contrast hole',dots([[340,490,5,'#505050']]),[[340,490]]);
      await check('small hole',dots([[340,490,2.5,'#eeeeee']]),[[340,490]]);
      await check('dark hole on white paper',dots([[60,600,5,'#333333']]),[[60,600]]);
      await check('two close holes',dots([[330,490,4,'#eeeeee'],[343,490,4,'#eeeeee']]),[[330,490],[343,490]]);
      function shade(photo){const ctx=photo.canvas.getContext('2d'),pixels=ctx.getImageData(0,0,640,900);for(let y=0;y<900;y++)for(let x=0;x<640;x++){const i=(y*640+x)*4;for(let k=0;k<3;k++)pixels.data[i+k]=Math.max(0,pixels.data[i+k]*(.65+.35*x/640));}ctx.putImageData(pixels,0,0);return photo;}
      await check('gradual shadow without new holes',shade(make()),[]);
      await check('gradual shadow with new holes',shade(make(true)),[[340,490],[210,360]]);
      const noisy=make(),ctx=noisy.canvas.getContext('2d'),pixels=ctx.getImageData(0,0,640,900);let seed=17;for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=(seed%17)-8;for(let k=0;k<3;k++)pixels.data[i+k]+=n;}ctx.putImageData(pixels,0,0);
      await check('sensor noise without new holes',noisy,[]);
      const settings={caliber:9,cardWidth:576,cardHeight:810};
      const single=await EppCameraSeries.compare(blank,dots([[340,490,5,'#eeeeee']]),settings);
      if(single.candidates.length!==1||single.candidates[0].confidence!=='high')throw Error('Calibrated single: '+JSON.stringify(single.candidates));
      for(const points of [[[330,600],[336,600]],[[330,600],[336,600],[333,606]]]){
        const result=await EppCameraSeries.compare(blank,dots(points.map(([x,y])=>[x,y,5,'#eeeeee'])),settings);
        if(result.candidates.length!==points.length)throw Error('Overlap expected '+points.length+': '+JSON.stringify(result.candidates));
        if(result.candidates.some(p=>p.confidence==='high'))throw Error('Overlap must require review');
        for(const [x,y] of points)if(!result.candidates.some(p=>Math.hypot(p.x*640-x,p.y*900-y)<3))throw Error('Overlap center inaccurate');
        console.log('PASS calibrated overlap '+points.length);
      }
      const crossing=await EppCameraSeries.compare(blank,dots([[330,500,5,'#eeeeee'],[336,500,5,'#eeeeee'],[333,506,5,'#eeeeee']]),settings);
      if(!crossing.candidates.length||crossing.candidates.some(p=>p.confidence==='high'))throw Error('Overlap on existing white print must require review');
      const mismatch=await EppCameraSeries.compare(blank,dots([[340,490,5,'#eeeeee']]),{caliber:3,cardWidth:576,cardHeight:810});
      if(mismatch.candidates.some(p=>p.confidence!=='low'))throw Error('Unresolvable calibre must stay uncertain');
      const uncalibrated=await EppCameraSeries.compare(blank,make(true));
      if(uncalibrated.candidates.some(p=>p.confidence!=='low'))throw Error('Missing scale must be uncertain');
      console.log('PASS calibrated confidence and missing scale');
 });
console.log('PASS original recognition checks: identical, exposure, old holes, shift, blur, corner validation');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
