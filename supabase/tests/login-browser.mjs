import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/epp-audit-tools/node_modules/playwright/index.mjs');
const html=await readFile(new URL('../../index.html',import.meta.url));
assert.match(html.toString(),/localStorage\.setItem\(EPP_AUTH_CLUB_KEY,result\.account\.clubId\)/);
const logo=await readFile(new URL('../../epp-logo.png',import.meta.url));
const store=await readFile(new URL('../../training-store.js',import.meta.url));
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{
  if(req.url==='/epp-logo.png'){res.setHeader('Content-Type','image/png');res.end(logo);return;}
  if(req.url==='/training-store.js'){res.setHeader('Content-Type','text/javascript');res.end(store);return;}
  if(req.url!=='/'&&req.url!=='/index.html'){
    try{const path=resolve(root,'.'+req.url);if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}
    catch{res.writeHead(404);res.end();}return;
  }
  res.setHeader('Content-Type','text/html');res.end(html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  for(const viewport of [{width:390,height:844},{width:375,height:667},{width:1440,height:1000}]){
    const page=await browser.newPage({viewport});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://**/*',route=>route.abort());
    await page.goto('http://127.0.0.1:'+server.address().port);
    assert.equal(await page.getByLabel('Inloggen als').inputValue(),'schutter');
    assert.equal(await page.locator('#loginClub option[value="beemtebroekland"]').count(),0);
    assert.equal(await page.locator('#loginClub option[value="svbb"]').count(),1);
    assert.equal(await page.getByLabel('Gebruikersnaam').count(),0);
    assert.equal(await page.locator('.login-logo').evaluate(img=>img.complete&&img.naturalWidth>0),true);
    assert.deepEqual(await page.locator('#loginRole option').evaluateAll(options=>options.map(option=>option.value)),['schutter','hoofdbeheer']);
    await page.getByLabel('Inloggen als').selectOption('hoofdbeheer');
    await page.getByLabel('Wachtwoord',{exact:true}).fill('test-password');
    await page.getByLabel('Inloggen als').selectOption('schutter');
    assert.equal(await page.getByLabel('Wachtwoord',{exact:true}).inputValue(),'');
    await page.getByLabel('Wachtwoord',{exact:true}).fill('ab');
    await page.evaluate(()=>{eppShowLoginGate();document.getElementById('loginRole').dispatchEvent(new Event('change'));});
    assert.equal(await page.getByLabel('Wachtwoord',{exact:true}).inputValue(),'ab');
    await page.screenshot({path:'/private/tmp/epp-login-'+viewport.width+'.png'});
    await page.evaluate(()=>{window.eppRawCall=(fn,payload)=>{window.loginRequest={fn,payload};return new Promise(()=>{});};});
    await page.getByLabel('Voornaam',{exact:true}).fill('Anne');
    await page.getByLabel('Achternaam',{exact:true}).fill('de Vries');
    await page.getByLabel('Wachtwoord',{exact:true}).fill('personal-password');
    await page.getByRole('button',{name:'Inloggen',exact:true}).click();
    const personalRequest=await page.evaluate(()=>window.loginRequest);
    assert.equal(personalRequest.payload.username,undefined);
    assert.equal(personalRequest.payload.role,undefined);
    assert.equal(personalRequest.payload.firstName,'Anne');assert.equal(personalRequest.payload.lastName,'de Vries');
    await page.evaluate(()=>{document.querySelector('.login-submit').disabled=false;});
    await page.getByLabel('Inloggen als').selectOption('hoofdbeheer');
    await page.getByLabel('Wachtwoord',{exact:true}).fill('personal-password');
    await page.getByRole('button',{name:'Inloggen',exact:true}).click();
    const headRequest=await page.evaluate(()=>window.loginRequest);
    assert.equal(headRequest.payload.username,'hoofdbeheer');
    assert.equal(headRequest.payload.clubId,'eppnationaal');
    assert.equal(headRequest.payload.firstName,undefined);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.evaluate(()=>{const gate=document.getElementById('loginGate');return gate.scrollHeight<=gate.clientHeight||getComputedStyle(gate).overflowY==='auto';}),true);
    assert.deepEqual(errors,[]);
    console.log('PASS login '+viewport.width+': shooter and head only, personal login, server determines permissions');
    await page.close();
  }
  for(const succeeds of [false,true]){
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(()=>{
      localStorage.setItem('epp-app-club-v1','svbb');
      localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'old-session',account:{role:'schutter'}}));
    });
    let release;
    const hold=new Promise(r=>{release=r;});
    await context.route('https://**/*',async route=>{
      if(!route.request().url().includes('/epp-auth')){await route.abort();return;}
      await hold;
      await route.fulfill({status:succeeds?200:401,contentType:'application/json',body:JSON.stringify(succeeds?{ok:true,account:{role:'schutter'}}:{ok:false,error:'sessie_verlopen'})});
    });
    const page=await context.newPage();
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByLabel('Wachtwoord',{exact:true}).pressSequentially('ab',{delay:150});
    if(succeeds){
      await page.evaluate(()=>{eppRawCall=()=>new Promise(()=>{});});
      await page.getByLabel('Voornaam',{exact:true}).fill('Anne');
      await page.getByLabel('Achternaam',{exact:true}).fill('de Vries');
      await page.getByRole('button',{name:'Inloggen',exact:true}).click();
    }
    release();
    await page.waitForTimeout(400);
    assert.equal(await page.getByLabel('Wachtwoord',{exact:true}).inputValue(),'ab');
    assert.equal(await page.locator('#root').isVisible(),false);
    await page.getByLabel('Wachtwoord',{exact:true}).evaluate(input=>{input.focus();input.setSelectionRange(input.value.length,input.value.length);});
    await page.getByLabel('Wachtwoord',{exact:true}).pressSequentially('cdef',{delay:75});
    assert.equal(await page.getByLabel('Wachtwoord',{exact:true}).inputValue(),'abcdef');
    console.log('PASS delayed session '+(succeeds?'success after new login':'failure while typing')+': entered password preserved');
    await context.close();
  }
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
