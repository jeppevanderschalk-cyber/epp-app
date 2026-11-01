import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/epp-audit-tools/node_modules/playwright/index.mjs');
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{
  try{const path=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!path.startsWith(root+'/'))throw Error();
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined}),errors=[];
const account={id:'test',username:'beheer',displayName:'Trainer',role:'trainer',clubId:'svbb',isAdmin:false};
try{
  for(const width of [390,1440]){
    const entities=new Map();
    for(const [kind,id,data] of [['shooter','sid',{id:'sid',naam:'Test Schutter'}],['meta','currentTraining',{id:'camera-training',mode:'stage',stage:'s1',startedAt:1}]])entities.set(kind+'|'+id,{kind,id,data});
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.addInitScript(account=>{window.nativeMessages=[];window.webkit={messageHandlers:{eppCamera:{postMessage:m=>window.nativeMessages.push(m)}}};localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1','svbb');localStorage.setItem('epp-app-role-v1','trainer');},account);
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
    await page.locator('summary',{hasText:'Camera beta'}).click();
    await page.getByRole('button',{name:'Camera beta openen',exact:true}).click();
    await page.getByText('Camera per serie',{exact:false}).waitFor();
    const sectionBox=await page.locator('.series-camera').boundingBox();
    assert(sectionBox.x>=0&&sectionBox.x+sectionBox.width<=width,'Camera section must fit viewport');
    const jpeg=await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=900;
      canvas.getContext('2d').fillStyle='#eeeeee';canvas.getContext('2d').fillRect(0,0,640,900);
      return canvas.toDataURL('image/jpeg').split(',')[1];
    });
    await page.getByLabel('Kaliber (mm)',{exact:true}).fill('9');
    await page.getByLabel('Kaartbreedte (mm)',{exact:true}).fill('576');
    await page.getByLabel('Kaarthoogte (mm)',{exact:true}).fill('810');
    await page.getByLabel('Schoten in deze serie').selectOption('2');
    await page.getByLabel('Alleen volledig zekere series automatisch toevoegen',{exact:true}).check();
    async function sendPhoto(id){return page.evaluate(async({id,jpeg})=>{
      const state=window.nativeMessages.filter(m=>m.type==='state').at(-1);
      return EppCameraNative.receivePhoto({id,contextId:state.contextId,mime:'image/jpeg',base64:jpeg});
    },{id,jpeg});}
    const first='11111111-1111-4111-8111-111111111111';
    assert.equal((await sendPhoto(first)).phase,'baseline');
    assert(await page.getByRole('button',{name:'Maak seriefoto',exact:true}).isDisabled());
    const photo=page.locator('.series-photo-section').first().locator('.series-photo');
    const box=await photo.boundingBox();
    for(const [x,y] of [[.001,.001],[.999,.001],[.999,.999],[.001,.999]])await photo.click({position:{x:x*box.width,y:y*box.height}});
    await page.getByRole('button',{name:'Maak seriefoto',exact:true}).waitFor();
    await page.waitForFunction(()=>window.nativeMessages.filter(m=>m.type==='state').at(-1).captureAllowed);
    await page.evaluate(()=>{
      window.compareCalls=0;window.fixtureConfidence='high';
      EppCameraSeries.compare=async(before,after,options)=>{
        window.compareCalls++;
        if(options.caliber!=='9')throw Error('Missing calibration');
        return {url:after.url,beforeUrl:before.url,candidates:[{x:.5,y:.5,confidence:window.fixtureConfidence,reasons:['Test circle']},{x:.5,y:.65,confidence:window.fixtureConfidence,reasons:['Test circle']}]};
      };
    });
    const second='22222222-2222-4222-8222-222222222222';
    assert.equal((await sendPhoto(second)).phase,'saved');
    await page.getByRole('button',{name:'Volgende serie',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>compareCalls),1);
    assert.equal((await sendPhoto(second)).phase,'saved'); // retried delivery is not counted again
    assert.equal(await page.evaluate(()=>compareCalls),1);
    await page.waitForTimeout(1500);
    assert.equal([...entities.values()].filter(e=>e.kind==='shot'&&e.data).length,2);
    assert([...entities.values()].filter(e=>e.kind==='shot'&&e.data).every(e=>e.data.reviewMethod==='recognition'));
    // The next Watch photo automatically uses the preceding after-photo as baseline.
    await page.evaluate(()=>window.fixtureConfidence='low');
    const third='33333333-3333-4333-8333-333333333333';
    assert.equal((await sendPhoto(third)).phase,'review');
    await page.getByRole('button',{name:'Loop onzekere schoten na (2)',exact:true}).waitFor();
    assert(await page.getByRole('button',{name:'Maak seriefoto',exact:true}).isDisabled());
    await assert.rejects(sendPhoto('44444444-4444-4444-8444-444444444444'));
    assert.equal(await page.evaluate(()=>compareCalls),2);
    assert.equal([...entities.values()].filter(e=>e.kind==='shot'&&e.data).length,2);
    for(const checkbox of await page.locator('.series-shot-row input[type=checkbox]').all())await checkbox.check();
    await page.getByRole('button',{name:'Serie opslaan',exact:true}).click();
    await page.waitForTimeout(1500);
    const persisted=[...entities.values()].filter(e=>e.kind==='shot'&&e.data);
    assert.equal(persisted.length,4);assert.equal(persisted.filter(e=>e.data.reviewMethod==='manual').length,2);
    const round=[...entities.values()].find(e=>e.kind==='round'&&e.data);assert(round?.data.score>0);
    await page.getByRole('button',{name:'Volgende serie',exact:true}).click();
    await page.screenshot({path:tmpdir()+'/epp-watch-camera-'+width+'.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    console.log('PASS native camera '+width+': baseline, automatic comparison, opt-in save, duplicate delivery, uncertainty review and cumulative score');
    await context.close();
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
