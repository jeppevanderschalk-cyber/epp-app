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
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];
  const account={id:'me',clubId:'svbb',username:'me',displayName:'Jeppe van der Schalk',role:'schutter'};
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/functions/v1/**',async route=>{
   const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let r={ok:true,qualifications:[],matches:[]};
   if(fn==='epp-auth')r={ok:true,account,sessionToken:'a'.repeat(64)};
   if(fn==='epp-training')r=b.action==='standings'?{ok:true,shooters:[{id:'me',naam:'Jeppe van der Schalk'},{id:'p',naam:'Peter Kruisselbrink'}],bestParcours:{me:{score:200},p:{score:190}},bestStageAverages:{},stageShots:{},rounds:[{id:'one',naam:'Jeppe van der Schalk',type:'parcours',score:200},{id:'two',naam:'Peter Kruisselbrink',type:'parcours',score:190}]}:{ok:true,entities:[{kind:'shooter',id:'me',data:{id:'me',naam:'Jeppe van der Schalk'}}]};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(r)});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByLabel('Gebruikersnaam of e-mailadres',{exact:true}).fill('me');await page.getByLabel('Wachtwoord',{exact:true}).fill('TestPassword123');await page.getByRole('button',{name:'Inloggen',exact:true}).click();
  await page.getByRole('button',{name:'Stand',exact:true}).click();
  await page.getByText('Peter Kruisselbrink',{exact:true}).first().waitFor();
  assert.equal(await page.locator('.num-in').count(),0);
  await page.getByText('Alle ingevoerde rondes (2)',{exact:true}).click();
  await page.getByText('Peter Kruisselbrink · Parcours · 190 punten',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.close();console.log('PASS '+width+': shooter sees shared club scores and all rounds without editing controls');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
