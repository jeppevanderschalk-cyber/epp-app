import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import('/private/tmp/epp-audit-tools/node_modules/playwright/index.mjs');
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{
  try{const path=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!path.startsWith(root+'/'))throw Error();
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true}),errors=[];
const account={id:'test',username:'beheer',displayName:'Trainer',role:'trainer',clubId:'svbb',isAdmin:false};
try{
  for(const width of [390,1440]){
    const entities=new Map();
    for(const [kind,id,data] of [['shooter','sid',{id:'sid',naam:'Test Schutter'}],['meta','currentTraining',{id:'camera-training',mode:'stage',stage:'s1',startedAt:1}]])entities.set(kind+'|'+id,{kind,id,data});
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.addInitScript(account=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1','svbb');localStorage.setItem('epp-app-role-v1','trainer');},account);
    await context.route('https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/**',async route=>{
      const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let response={ok:true};
      if(fn==='epp-auth')response={ok:true,account};
      if(fn==='epp-training'){
        if(b.action==='save')for(const op of b.ops)entities.set(op.kind+'|'+op.id,{kind:op.kind,id:op.id,data:op.value});
        response={ok:true,entities:[...entities.values()]};
      }
      await route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByRole('button',{name:'Meer',exact:true}).click();
    await page.getByRole('button',{name:'Camera beta openen',exact:true}).click();
    await page.getByText('Camera per serie',{exact:false}).waitFor();
    const sectionBox=await page.locator('.series-camera').boundingBox();
    assert(sectionBox.x>=0&&sectionBox.x+sectionBox.width<=width,'Camera section must fit viewport');
    const fixtures=await page.evaluate(async()=>{
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
      return {before:blank.url,after:changed.url};
    });
    await page.getByLabel('Schoten in deze serie').selectOption('3');
    for(const which of ['before','after']){
      const title=which==='before'?'voor de serie':'na de serie';
      await page.getByLabel('Foto kiezen '+title,{exact:true}).setInputFiles({name:which+'.png',mimeType:'image/png',buffer:Buffer.from(fixtures[which].split(',')[1],'base64')});
      const photo=page.locator('.series-photo-section').nth(which==='before'?0:1).locator('.series-photo');
      await photo.waitFor();const box=await photo.boundingBox();
      for(const [x,y] of [[.001,.001],[.999,.001],[.999,.999],[.001,.999]])await photo.click({position:{x:x*box.width,y:y*box.height}});
    }
    await page.getByRole('button',{name:'Vergelijk serie',exact:true}).click();
    await page.getByText('Serie controleren',{exact:true}).waitFor({timeout:60000});
    assert.equal(await page.locator('.series-shot-row').count(),2);
    assert(await page.getByRole('button',{name:'Serie opslaan',exact:true}).isDisabled());
    await page.getByRole('button',{name:'Misser toevoegen (0)',exact:true}).click();
    await page.getByLabel('Score schot 1',{exact:true}).selectOption('5');
    await page.getByLabel('Score schot 2',{exact:true}).selectOption('4');
    for(const checkbox of await page.locator('.series-shot-row input[type=checkbox]').all())await checkbox.check();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:'/private/tmp/epp-camera-series-'+width+'.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('button',{name:'Serie opslaan',exact:true}).click();
    await page.getByRole('button',{name:'Volgende serie',exact:true}).waitFor();
    await page.waitForTimeout(2000);
    const persisted=[...entities.values()].filter(e=>e.kind==='shot'&&e.data);assert.equal(persisted.length,3);
    assert(persisted.every(e=>e.data.trainingId==='camera-training'));
    assert([...entities.values()].some(e=>e.kind==='round'&&e.data?.score===9));
    await page.getByRole('button',{name:'Volgende serie',exact:true}).click();
    assert.equal(await page.locator('.series-photo-section').first().locator('.series-corner').count(),4);
    assert.equal(await page.locator('.series-photo-section').last().locator('img').count(),0);
    console.log('PASS camera series '+width+': OpenCV, holes, old-hole exclusion, exposure, blur, review, persistence and next series');
    await context.close();
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
