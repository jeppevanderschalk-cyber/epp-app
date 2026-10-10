import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import '../../training-store.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname,file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',extname(file)==='.html'?'text/html':extname(file)==='.js'?'text/javascript':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
  for(const scenario of ['fresh','old-queue','stored-empty']){
    const context=await browser.newContext({viewport:{width:390,height:900}}),account={id:'head',username:'hoofdbeheer',role:'trainer',clubId:'eppnationaal',isAdmin:true,isPlatformAdmin:true};
    const records=new Map(),errors=[];let saves=0,conflicts=0;
    if(scenario==='stored-empty')records.set('meta|stageShots',{kind:'meta',id:'stageShots',data:{}});
    await context.addInitScript(({account,scenario})=>{
      localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1',account.clubId);localStorage.setItem('epp-app-role-v1',account.role);
      if(scenario==='old-queue')localStorage.setItem('epp-data-v1-eppnationaal-records-v3',JSON.stringify({base:{stageShots:{}},wanted:{stageShots:{s1:10},shooters:[{id:'saved-shooter',naam:'Preserved Shooter'}],currentTraining:{id:'saved-training',mode:'parcours',stage:'s1',startedAt:1,rounds:[{id:'saved-round',sid:'saved-shooter',trainingId:'saved-training',type:'parcours',score:230,ts:1}]}}}));
    },{account,scenario});
    await context.route('**/functions/v1/**',async route=>{
      const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let data={ok:true,account,entities:[],clubs:[{code:'svbb',naam:'SVBB'}],matches:[],shooters:[],accounts:[]};
      if(fn==='epp-training'){
        if(b.action==='save'){
          saves++;
          // Mirror PostgreSQL's NULL-vs-{} optimistic concurrency check.
          const conflict=b.ops.find(op=>{const old=records.get(op.kind+'|'+op.id)?.data??null;return !EppStore.equal(old,op.value)&&!EppStore.equal(old,op.expected);});
          if(conflict){conflicts++;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,error:'opslag_conflict:'+conflict.id})});}
          for(const op of b.ops)records.set(op.kind+'|'+op.id,{kind:op.kind,id:op.id,data:op.value});
        }
        data={ok:true,entities:[...records.values()]};
      }
      if(fn==='epp-head-view'&&b.action==='view')data={ok:true,club:{code:'svbb',naam:'SVBB'},entities:[],qualifications:[]};
      await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByText('Online opgeslagen',{exact:true}).waitFor();
    const savedCount=saves;await page.waitForTimeout(1800);assert.equal(saves,savedCount);assert.equal(conflicts,0);
    assert.equal(await page.getByText('Online opslaan...',{exact:true}).count(),0);
    const training=records.get('meta|currentTraining').data;
    const queued=await page.evaluate(()=>JSON.parse(localStorage.getItem('epp-data-v1-eppnationaal-records-v3')));
    assert.equal(queued.wanted.currentTraining.id,training.id);assert.deepEqual(EppStore.diff(queued.base,queued.wanted),[]);
    if(scenario==='old-queue'){assert.equal(training.id,'saved-training');assert.equal(records.get('round|saved-round').data.score,230);}
    await page.locator('[aria-label="Vereniging bekijken"]:visible').selectOption('svbb');await page.getByText('Alleen bekijken',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Hoofdbeheer',exact:true}).click();await page.getByRole('button',{name:'Meer',exact:true}).click();await page.getByText('Sessie',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);await context.close();console.log('PASS '+scenario+': storage settles without conflicts, pending scores retained, navigation responsive');
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
