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
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[],records=new Map();
  const sid='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
  const account={id:'head',clubId:'eppnationaal',username:'head',displayName:'Head',role:'trainer',isAdmin:true,isPlatformAdmin:true};
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/functions/v1/**',async route=>{
   const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let r={ok:true,clubs:[],matches:[],accounts:[],shooters:[],entities:[]};
   if(fn==='epp-auth')r={ok:true,account,sessionToken:'a'.repeat(64)};
   if(fn==='epp-training'){
    if(b.action==='list_registered_shooters')r={ok:true,shooters:[{id:sid,display_name:'Anne de Vries'},{id:second,display_name:'Peter Test'}]};
    else {if(b.action==='save')for(const op of b.ops)records.set(op.kind+'|'+op.id,{kind:op.kind,id:op.id,data:op.value});r={ok:true,entities:[...records.values()]};}
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(r)});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByLabel('Inloggen als').selectOption('hoofdbeheer');await page.getByLabel('Wachtwoord',{exact:true}).fill('TestPassword123');await page.getByRole('button',{name:'Inloggen',exact:true}).click();
  await page.getByRole('button',{name:'Parcours',exact:true}).waitFor();
  const dropdown=page.getByLabel('Schutter met account toevoegen',{exact:true});
  await dropdown.locator('option[value="'+sid+'"]').waitFor({state:'attached'});
  assert.equal(await page.getByPlaceholder('Naam toevoegen…').count(),0);
  await dropdown.selectOption(sid);await page.getByRole('button',{name:'＋',exact:true}).click();
  await page.getByLabel('Schutter voor score-invoer',{exact:true}).locator('option[value="'+sid+'"]').waitFor({state:'attached'});
  assert.equal(await dropdown.locator('option[value="'+sid+'"]').count(),0);
  await page.locator('.num-in').fill('200');await page.getByRole('button',{name:'Ronde opslaan',exact:true}).click();
  for(let n=0;n<60&&![...records.values()].some(e=>e.kind==='round');n++)await new Promise(r=>setTimeout(r,100));
  assert.ok([...records.values()].some(e=>e.kind==='shooter'&&e.id===sid&&e.data.naam==='Anne de Vries'));
  assert.ok([...records.values()].some(e=>e.kind==='round'&&e.data.sid===sid));
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.close();console.log('PASS '+width+': head dropdown, account identity, no duplicate selection, score saved');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
