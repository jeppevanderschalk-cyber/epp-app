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
 for(const width of [390,1440])for(const head of [false,true]){
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[],records=new Map();
  const sid='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
  const account={id:head?'head':'club-admin',clubId:head?'eppnationaal':'svbb',username:head?'head':'admin',displayName:'Beheerder',role:'trainer',isAdmin:true,isPlatformAdmin:head};
  const foreign='33333333-3333-4333-8333-333333333333';let attempts=0;
  records.set('shooter|'+second,{kind:'shooter',id:second,data:{id:second,naam:'Belinda Test'}});
  await page.addInitScript(account=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1',account.clubId);localStorage.setItem('epp-app-role-v1','trainer');},account);
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/functions/v1/**',async route=>{
   const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let r={ok:true,clubs:[],matches:[],accounts:[],shooters:[],entities:[]};
   if(fn==='epp-auth')r={ok:true,account,sessionToken:'a'.repeat(64)};
   if(fn==='epp-training'){
    if(b.action==='list_registered_shooters'){
      assert.equal(b.clubId,account.clubId);attempts++;
      if(!head&&attempts===1){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'temporary_failure'})});return;}
      r={ok:true,shooters:[{id:sid,display_name:'Anne de Vries'},{id:second,display_name:'Belinda Test'},...(head?[{id:foreign,display_name:'Andere Vereniging'}]:[])]};
    }
    else {if(b.action==='save')for(const op of b.ops)records.set(op.kind+'|'+op.id,{kind:op.kind,id:op.id,data:op.value});r={ok:true,entities:[...records.values()]};}
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(r)});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'Training',exact:true}).click();
  await page.getByRole('button',{name:'Parcours',exact:true}).waitFor();
  const dropdown=page.getByLabel('Schutter voor score-invoer',{exact:true});
  if(!head){
    await page.getByText(/Schutters ophalen mislukt/).waitFor();assert.equal(await dropdown.inputValue(),second);
    await page.getByText('Staat je naam er niet bij?',{exact:true}).click();
    await page.getByRole('button',{name:'Schutters opnieuw laden',exact:true}).click();
  }
  await dropdown.locator('option[value="'+sid+'"]').waitFor({state:'attached'});
  assert.equal(await page.getByPlaceholder('Naam toevoegen…').count(),0);
  await page.getByText('Schutter zoeken en beheren',{exact:true}).click();
  const search=page.getByLabel('Zoek schutter voor training',{exact:true});
  const listButton=page.getByRole('button',{name:'Kies uit lijst ▾',exact:true});
  await listButton.click();
  assert.equal(await page.evaluate(()=>['INPUT','TEXTAREA'].includes(document.activeElement.tagName)),false);
  const list=page.getByRole('listbox',{name:'Beschikbare schutters'});
  await list.waitFor();assert.equal(await list.getByRole('option').count(),head?3:2);
  assert.equal(await list.getByRole('option',{name:'Andere Vereniging',exact:true}).count(),head?1:0);
  await search.fill('nietsgevonden');assert.equal(await list.getByRole('option').count(),0);
  await listButton.click();assert.equal(await search.inputValue(),'');
  assert.equal(await page.evaluate(()=>['INPUT','TEXTAREA'].includes(document.activeElement.tagName)),false);
  assert.equal(await list.getByRole('option').count(),head?3:2);
  await list.getByRole('option',{name:'Belinda Test',exact:true}).click();
  await list.waitFor({state:'hidden'});
  await search.fill('anne');assert.equal(await list.getByRole('option').count(),1);
  await list.getByRole('option',{name:'Anne de Vries',exact:true}).click();
  await list.waitFor({state:'hidden'});
  await page.getByText('Geselecteerd: Anne de Vries.',{exact:false}).waitFor();
  await page.getByLabel('Schutter voor score-invoer',{exact:true}).locator('option[value="'+sid+'"]').waitFor({state:'attached'});
  assert.equal(await dropdown.locator('option[value="'+sid+'"]').count(),1);
  assert.equal(await dropdown.locator('option[value="'+foreign+'"]').count(),head?1:0);
  assert.equal(await page.getByRole('button',{name:'Schutter toevoegen aan training',exact:true}).count(),0);
  await page.getByLabel('Zoek schutter voor training',{exact:true}).fill('belinda');
  await search.press('Enter');assert.equal(await dropdown.inputValue(),second);
  await search.click();await search.press('Escape');await list.waitFor({state:'hidden'});
  await dropdown.selectOption(sid);
  assert.equal(await page.getByLabel('Zoek schutter voor training',{exact:true}).inputValue(),'');
  await page.locator('.num-in').fill('200');await page.getByRole('button',{name:'Ronde opslaan',exact:true}).click();
  for(let n=0;n<60&&![...records.values()].some(e=>e.kind==='round');n++)await new Promise(r=>setTimeout(r,100));
  assert.ok([...records.values()].some(e=>e.kind==='shooter'&&e.id===sid&&e.data.naam==='Anne de Vries'));
  assert.ok([...records.values()].some(e=>e.kind==='round'&&e.data.sid===sid));
  assert.equal([...records.values()].filter(e=>e.kind==='shooter'&&e.id===sid).length,1);
  await page.screenshot({path:resolve(tmpdir(),'epp-shooter-direct-'+(head?'head':'club')+'-'+width+'.png'),fullPage:true});
  await page.getByRole('button',{name:'Wedstrijdscore invoeren',exact:true}).click();
  await page.getByRole('heading',{name:'Wedstrijdscores',exact:true}).waitFor();
  await page.getByText(/Er zijn geen wedstrijden voor score-invoer geladen/).waitFor();
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.close();console.log('PASS '+width+' '+(head?'head':'club')+': all permitted shooters, existing selection, directory retry, direct selection, no duplicate, saved score and official-score guidance');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
