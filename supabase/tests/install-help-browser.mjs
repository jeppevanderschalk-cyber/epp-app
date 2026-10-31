import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const file=resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':extname(file)==='.css'?'text/css':'text/html');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
 for(const mode of ['browser','ios','standalone','fullscreen','minimal-ui']){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(mode=>{
   if(mode==='ios')Object.defineProperty(navigator,'standalone',{value:true});
   const original=window.matchMedia.bind(window);window.matchMedia=query=>query.includes('display-mode: '+mode+')')?{matches:true,addEventListener(){}}:original(query);
  },mode);
  await context.route('**/functions/v1/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:false,error:'sessie_verlopen'})}));
  const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/');
  const panel=page.getByRole('complementary',{name:'EPP op je beginscherm'});
  if(mode==='browser'){
   await panel.waitFor();await panel.locator('summary').click();
   assert.match(await panel.innerText(),/iPhone \/ iPad/);assert.match(await panel.innerText(),/Android/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await panel.getByRole('button',{name:'Installatie-uitleg sluiten'}).click();assert.equal(await panel.isVisible(),false);
   await page.reload();assert.equal(await page.locator('.epp-install-help').isVisible(),false);
   await page.evaluate(()=>sessionStorage.clear());await page.reload();await panel.waitFor();
   await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));assert.equal(await panel.isVisible(),false);
  }else{await page.locator('.epp-install-help').waitFor({state:'attached'});assert.equal(await panel.isVisible(),false);}
  await context.close();
 }
 console.log('PASS browser installation instructions, dismiss/reload, iOS standalone, Android display modes and installed event');
}finally{await browser.close();await new Promise(r=>server.close(r));}
