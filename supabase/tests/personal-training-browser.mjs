import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html'));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],records=new Map(),saves=[];
  const sid='11111111-1111-4111-8111-111111111111';
  const account={id:'personal-account',clubId:'svbb',username:'personal',displayName:'Anne de Vries',role:'schutter',isAdmin:false};
  const entities=()=>[...records.values(),{kind:'shooter',id:sid,data:{id:sid,naam:'Anne de Vries'}}];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/functions/v1/**',async route=>{
   const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let r={ok:true,matches:[],shooters:[],ranking:[],qualifications:[],events:[]};
   if(fn==='epp-auth')r={ok:true,account,sessionToken:'a'.repeat(64)};
   if(fn==='epp-training'){
    if(b.action==='save'){for(const op of b.ops){records.set(op.kind+'|'+op.id,{kind:op.kind,id:op.id,data:op.value});if(op.kind==='round'&&op.value){assert.equal(op.value.sid,sid);saves.push(op.value);}}}
    r={ok:true,entities:entities()};
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(r)});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('#loginClub').selectOption('svbb');
  await page.getByLabel('Gebruikersnaam of e-mailadres',{exact:true}).fill('personal');await page.getByLabel('Wachtwoord',{exact:true}).fill('TestPassword123');await page.getByRole('button',{name:'Inloggen',exact:true}).click();
  await page.getByRole('button',{name:'Parcours',exact:true}).waitFor();
  assert.equal(await page.getByPlaceholder('Naam toevoegen…').count(),0);assert.equal(await page.getByRole('button',{name:'Geselecteerde schutter verwijderen'}).count(),0);
  assert.equal(await page.locator('[aria-label="Schutter voor score-invoer"] option').count(),1);
  await page.locator('.num-in').fill('200');await page.getByRole('button',{name:'Ronde opslaan',exact:true}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('Online opgeslagen'));
  assert.ok(saves.some(r=>r.type==='parcours'&&r.score===200));
  await page.getByRole('button',{name:'Stages',exact:true}).click();
  await page.getByLabel('Kaarttelling en tijden',{exact:true}).check();
  await page.getByRole('spinbutton',{name:'Stage 5 punten',exact:true}).fill('10');
  await page.getByLabel('Stagetijd (seconden en honderdsten)',{exact:true}).fill('12.34');
  await page.getByRole('button',{name:'Ronde opslaan',exact:true}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('Online opgeslagen'));
  for(let n=0;n<50&&!saves.some(r=>r.type==='stage');n++)await new Promise(r=>setTimeout(r,100));
  assert.ok(saves.some(r=>r.type==='stage'&&r.score===50&&r.stage_time_ms===12340));
  await page.reload();await page.getByRole('button',{name:'Overzicht',exact:true}).click();
  await page.getByText('Online opgeslagen',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Training afsluiten/}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('Online opgeslagen'));
  for(let n=0;n<50&&![...records.values()].some(e=>e.kind==='archive');n++)await new Promise(r=>setTimeout(r,100));
  assert.ok([...records.values()].some(e=>e.kind==='archive'&&e.data.rounds.length===2),JSON.stringify([...records.values()]));
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.close();console.log('PASS '+width+': personal parcours, counted stage, online save, reload, archive, no other shooters');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
