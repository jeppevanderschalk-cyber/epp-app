import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/epp-audit-tools/node_modules/playwright/index.mjs');
const html=await readFile(new URL('../../index.html',import.meta.url));
const logo=await readFile(new URL('../../epp-logo.png',import.meta.url));
const store=await readFile(new URL('../../training-store.js',import.meta.url));
const server=createServer((req,res)=>{
  if(req.url==='/epp-logo.png'){res.setHeader('Content-Type','image/png');res.end(logo);return;}
  if(req.url==='/training-store.js'){res.setHeader('Content-Type','text/javascript');res.end(store);return;}
  res.setHeader('Content-Type','text/html');res.end(html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true});
  for(const viewport of [{width:390,height:844},{width:375,height:667},{width:1440,height:1000}]){
    const page=await browser.newPage({viewport});
    await page.route('https://**/*',route=>route.abort());
    await page.goto('http://127.0.0.1:'+server.address().port);
    assert.equal(await page.getByLabel('Inloggen als').inputValue(),'schutter');
    assert.equal(await page.getByLabel('Gebruikersnaam').count(),0);
    assert.equal(await page.locator('.login-logo').evaluate(img=>img.complete&&img.naturalWidth>0),true);
    await page.getByLabel('Inloggen als').selectOption('trainer');
    await page.getByLabel('Wachtwoord',{exact:true}).fill('test-password');
    await page.getByLabel('Inloggen als').selectOption('schutter');
    assert.equal(await page.getByLabel('Wachtwoord',{exact:true}).inputValue(),'');
    await page.screenshot({path:'/private/tmp/epp-login-'+viewport.width+'.png'});
    await page.evaluate(()=>{window.eppRawCall=(fn,payload)=>{window.loginRequest={fn,payload};return new Promise(()=>{});};});
    await page.getByLabel('Wachtwoord',{exact:true}).fill('test-password');
    await page.getByRole('button',{name:'Inloggen',exact:true}).click();
    const request=await page.evaluate(()=>window.loginRequest);
    assert.equal(request.payload.username,'kijker');
    assert.equal(request.payload.role,undefined);
    await page.evaluate(()=>{document.querySelector('.login-submit').disabled=false;});
    await page.getByLabel('Inloggen als').selectOption('trainer');
    await page.getByLabel('Wachtwoord',{exact:true}).fill('trainer-password');
    await page.getByRole('button',{name:'Inloggen',exact:true}).click();
    const managementRequest=await page.evaluate(()=>window.loginRequest);
    assert.equal(managementRequest.payload.username,'beheer');
    assert.equal(managementRequest.payload.role,undefined);
    await page.evaluate(()=>{document.querySelector('.login-submit').disabled=false;});
    await page.getByLabel('Inloggen als').selectOption('schutter');
    await page.getByRole('button',{name:'Inloggen met eigen account',exact:true}).click();
    await page.getByLabel('Voornaam',{exact:true}).fill('Anne');
    await page.getByLabel('Achternaam',{exact:true}).fill('de Vries');
    await page.getByLabel('Wachtwoord',{exact:true}).fill('personal-password');
    await page.getByRole('button',{name:'Inloggen',exact:true}).click();
    const personalRequest=await page.evaluate(()=>window.loginRequest);
    assert.equal(personalRequest.payload.username,undefined);
    assert.equal(personalRequest.payload.firstName,'Anne');assert.equal(personalRequest.payload.lastName,'de Vries');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.evaluate(()=>{const gate=document.getElementById('loginGate');return gate.scrollHeight<=gate.clientHeight||getComputedStyle(gate).overflowY==='auto';}),true);
    console.log('PASS login '+viewport.width+': no username field, shooter maps to kijker, management maps to beheer, server determines permissions');
    await page.close();
  }
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
