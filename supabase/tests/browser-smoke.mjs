import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/epp-audit-tools/node_modules/playwright/index.mjs');
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{
  try{
    const path=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
    if(!path.startsWith(root+'/'))throw new Error('invalid path');
    const bytes=await readFile(path);
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.png':'image/png','.json':'application/json'})[extname(path)]||'application/octet-stream');
    res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/index.html';
const browser=await chromium.launch({headless:true});
const entities=new Map();
const put=(kind,id,data)=>entities.set(kind+'|'+id,{kind,id,data});
put('shooter','00000000-0000-4000-8000-000000000001',{id:'00000000-0000-4000-8000-000000000001',naam:'Test Schutter'});
put('meta','currentTraining',{id:'test-training',mode:'parcours',stage:'s1',startedAt:1});
put('meta','stageShots',{s1:10,s2:5,s3:5,s4:10,s5:5,s6:5,s7:10});
let failSave=false;
const errors=[];
const account={id:'test-account',username:'testtrainer',displayName:'Test Trainer',role:'trainer',clubId:'svbb',isAdmin:true};
try{
  for(const viewport of [{width:390,height:844},{width:1440,height:1000}]){
    const context=await browser.newContext({viewport});
    await context.addInitScript(({account})=>{
      localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));
      localStorage.setItem('epp-app-club-v1','svbb');
      localStorage.setItem('epp-app-role-v1','trainer');
    },{account});
    await context.route('https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/**',async route=>{
      const body=route.request().postDataJSON();
      const fn=route.request().url().split('/').pop();
      let response={ok:true},status=200;
      if(fn==='epp-auth')response={ok:true,account,accounts:[]};
      if(fn==='epp-platform')response={ok:true,ranking:[],shooters:[],events:[],matches:[]};
      if(fn==='epp-training'){
        if(body.action==='save'){
          await new Promise(r=>setTimeout(r,250));
          if(failSave){response={ok:false,error:'test_netwerkfout'};status=503;}
          else{
            const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
            if(body.ops.some(op=>{const now=entities.get(op.kind+'|'+op.id)?.data;return !same(now,op.expected)&&!same(now,op.value);})){response={ok:false,error:'opslag_conflict'};status=409;}
            else for(const op of body.ops)put(op.kind,op.id,op.value);
          }
        }
        if(status===200)response={ok:true,entities:[...entities.values()]};
      }
      await route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(response)});
    });
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);
    await page.getByText('Volledig Parcours',{exact:true}).waitFor();
    const score=page.getByPlaceholder('0',{exact:true}).first();
    await score.fill('210');
    await score.press('Enter');
    await page.getByRole('status').filter({hasText:'Online opgeslagen'}).waitFor({timeout:15000});
    assert([...entities.values()].some(e=>e.kind==='round'&&e.data?.score===210));
    await page.getByRole('button',{name:'Training',exact:true}).click();
    await page.getByText('Huidige training',{exact:true}).waitFor();
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'/private/tmp/epp-audit-'+viewport.width+'.png',fullPage:true});
    await page.getByRole('button',{name:'Parcours',exact:true}).click();
    failSave=true;
    await score.fill('220');await score.press('Enter');
    await page.getByRole('status').filter({hasText:'nog niet online'}).waitFor({timeout:15000});
    assert(await page.evaluate(()=>JSON.parse(localStorage.getItem('epp-data-v1-records-v3')).wanted.currentTraining.rounds.some(r=>r.score===220)));
    await page.reload();
    await page.getByText('Volledig Parcours',{exact:true}).waitFor();
    assert((await page.locator('body').innerText()).includes('220'));
    failSave=false;
    await page.getByRole('button',{name:'Meer',exact:true}).click();
    await page.getByRole('button',{name:'Nu synchroniseren',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Online opgeslagen'}).first().waitFor({timeout:15000});
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS mobile/desktop rendering, score save, truthful failure status and offline reload retry');
}finally{await browser.close();await new Promise(r=>server.close(r));}
