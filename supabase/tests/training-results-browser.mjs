import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html'));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',extname(path)==='.css'?'text/css':extname(path)==='.js'?'text/javascript':extname(path)==='.html'?'text/html':'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[],calls=[];
  page.on('pageerror',e=>errors.push(e.message));
  const sid='11111111-1111-4111-8111-111111111111';
  const fixture={ok:true,ownShooterId:sid,shooters:[{id:sid,naam:'Zoë Núñez'},{id:'other',naam:'Andere schutter'}],rounds:[{id:'one',sid,trainingId:'training-one',naam:'Zoë Núñez',type:'stage',stage:'s1',score:0,note:'Advies: rustig ademhalen',ts:1795260000000},{id:'two',sid,trainingId:'training-one',naam:'Zoë Núñez',type:'stage',stage:'s1',score:40,ts:1795260600000},{id:'three',sid:'other',trainingId:'training-one',naam:'Andere schutter',type:'stage',stage:'s1',score:45,ts:1795260600000}]};
  const entries=[];
  await page.route('**/functions/v1/**',async route=>{const b=route.request().postDataJSON();calls.push(b);let r={ok:true};if(b.action==='standings')r=fixture;if(b.action==='journal_load'||b.action==='journal_add'){if(b.action==='journal_add')entries.push({id:'entry',author_name:'Zoë Núñez',visibility:'private',content:b.content,created_at:new Date().toISOString()});r={ok:true,entries};}await route.fulfill({contentType:'application/json',body:JSON.stringify(r)});});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(({fixture,sid})=>{sessionStorage.setItem(EPP_SESSION_KEY,JSON.stringify({sessionToken:'a'.repeat(64),account:{id:'owner',clubId:'svbb',username:'zoe',role:'schutter',displayName:'Zoë Núñez'}}));window.fixture=fixture;window.savedRounds=[];window.testRoot=ReactDOM.createRoot(document.getElementById('root'));testRoot.render(h('div',{className:'app'},h('style',null,CSS),h('main',{className:'main'},h(TrainingResults,{data:fixture}))));eppShowApp();},{fixture,sid});
  await page.getByText('Advies: rustig ademhalen',{exact:true}).waitFor();
  await page.getByLabel('Training bekijken',{exact:true}).selectOption('training-one');await page.getByLabel('Resultaten van schutter',{exact:true}).selectOption(sid);
  await page.getByLabel('Aantekening of advies',{exact:true}).fill('Trainer adviseert: aandacht voor houding.');await page.getByRole('button',{name:'Aantekening opslaan',exact:true}).click();await page.getByText('Aantekening online opgeslagen.',{exact:true}).waitFor();
  assert.equal(calls.find(c=>c.action==='journal_add').trainingId,'training-one');
  await page.getByLabel('Dagboek toevoegen aan persoonlijke PDF').check();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'PDF per schutter downloaden',exact:true}).click();const download=await downloading;await download.saveAs('/private/tmp/epp-training-personal-'+width+'.pdf');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'/private/tmp/epp-training-results-'+width+'.png',fullPage:true});
  await page.getByLabel('Resultaten van schutter',{exact:true}).selectOption('');assert.equal(await page.getByLabel('Aantekening of advies',{exact:true}).count(),0);
  const all=page.waitForEvent('download');await page.getByRole('button',{name:'PDF met alle standen en resultaten downloaden',exact:true}).click();await (await all).saveAs('/private/tmp/epp-training-all-'+width+'.pdf');
  await page.evaluate(()=>testRoot.render(h('div',{className:'app'},h('style',null,CSS),h('main',{className:'main'},h(RoundInput,{maxV:50,onAdd:(score,details)=>savedRounds.push({score,details})})))));
  await page.getByLabel('Notitie bij score (optioneel)').fill('Storing tijdens de ronde');await page.getByLabel('Rondescore',{exact:true}).fill('0');await page.getByRole('button',{name:'Ronde opslaan',exact:true}).click();assert.equal((await page.evaluate(()=>savedRounds))[0].details.note,'Storing tijdens de ronde');
  assert.deepEqual(errors,[]);await page.close();console.log('PASS '+width+': saved scores, diary, personal/full PDF, score notes');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
