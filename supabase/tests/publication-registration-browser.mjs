import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/epp-audit-tools/node_modules/playwright/index.mjs');
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!path.startsWith(root+'/'))throw new Error('path');
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.png':'image/png'})[extname(path)]||'application/octet-stream');
    res.end(await readFile(path));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
const shared={id:'shared',username:'kijker',displayName:'Meekijker',role:'schutter',clubId:'svbb',isAdmin:false};
const personal={id:'personal',username:'lid.test',displayName:'Anne de Vries',role:'schutter',clubId:'apgs',isAdmin:false};
const errors=[];
try{
  for(const viewport of [{width:390,height:844},{width:1440,height:1000}]){
    const context=await browser.newContext({viewport});let signup=null,registration=null,registrationError='';const sharedDataRequests=[];
    await context.addInitScript(account=>{
      if(sessionStorage.getItem('registration-test-initialized'))return;
      sessionStorage.setItem('registration-test-initialized','1');
    },shared);
    await context.route('https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/**',async route=>{
      const body=route.request().postDataJSON(),fn=route.request().url().split('/').pop();
      if(body.sessionToken==='a'.repeat(64)&&fn!=='epp-auth')sharedDataRequests.push(fn);
      let response={ok:true};
      if(fn==='epp-auth'){
        response={ok:true,account:body.sessionToken==='b'.repeat(64)?personal:shared};
        if(body.action==='register_member'){
          registration=body;
          if(registrationError)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:registrationError})});
          registration=body;response={ok:true,account:{clubId:personal.clubId}};
        }
        if(body.action==='login'){response=body.username==='kijker'?{ok:true,account:shared,sessionToken:'a'.repeat(64)}:{ok:true,account:personal,sessionToken:'b'.repeat(64)};}
      }
      if(fn==='epp-training')response={ok:true,entities:[]};
      if(fn==='epp-planner')response={ok:true,matches:[]};
      if(fn==='epp-signup'){
        if(body.action==='list_matches')response={ok:true,matches:[{id:'match',organizer:'Testwedstrijd',match_date:'2026-11-14',deadline:'2099-01-01',offered_disciplines:['pistool']}]};
        if(body.action==='list_shooters')response={ok:true,shooters:[{id:'own-shooter',naam:'Anne de Vries'}]};
        if(body.action==='my_signups')response={ok:true,signups:signup?[{match_id:'match',epp_signup_disciplines:signup.disciplines}]:[]};
        if(body.action==='save_signup'){signup=body;}
      }
      await route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.locator('#loginEmail').waitFor({state:'visible'});
    assert.equal(await page.locator('#loginPassword').inputValue(),'');
    await page.locator('#loginRole').selectOption('hoofdbeheer');
    assert.equal(await page.locator('#loginFirstName').isVisible(),false);
    await page.locator('#loginRole').selectOption('schutter');
    assert.equal(await page.locator('#loginEmail').isVisible(),true);
    await page.getByRole('button',{name:'Ik heb nog geen account',exact:true}).click();
    await page.getByText('Eigen account aanmaken',{exact:true}).waitFor();
    assert.equal(await page.getByRole('combobox',{name:'Vereniging',exact:true}).inputValue(),'');
    assert.equal(await page.getByRole('button',{name:'Training',exact:true}).count(),0);
    assert.doesNotMatch(await page.locator('#root header').innerText(),/SVBB/);
    assert.deepEqual(sharedDataRequests,[]);
    await page.locator('section').filter({has:page.getByText('Eigen account aanmaken',{exact:true})}).locator('select').selectOption('apgs');
    await page.getByRole('textbox',{name:'Voornaam',exact:true}).fill('Anne');
    await page.getByRole('textbox',{name:'Achternaam',exact:true}).fill('de Vries');
    await page.getByLabel('E-mailadres',{exact:true}).fill('anne@example.nl');
    await page.getByLabel('Gebruikersnaam',{exact:true}).fill('anne.schutter');
    await page.getByLabel('Eigen wachtwoord',{exact:true}).fill('SafePassword123!');

    await page.getByLabel('Herhaal wachtwoord',{exact:true}).fill('SafePassword123!');
    const consent=page.getByRole('checkbox',{name:'Toestemming voor publicatie'});
    assert.equal(await consent.isChecked(),false);
    assert.equal(await consent.getAttribute('required'),null);
    registrationError='server_fout';
    await page.getByRole('button',{name:'Account aanmaken',exact:true}).click();
    await page.getByRole('alert').waitFor();
    assert.equal(registration.publicationConsent,false);
    await consent.check();registrationError='';
    await page.getByRole('button',{name:'Account aanmaken',exact:true}).click();
    await page.getByText('Account aangemaakt. Log in met je eigen wachtwoord.',{exact:true}).waitFor();
    assert.equal(registration.publicationConsent,true);
    await context.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS mobile and desktop: optional unchecked publication choice, registration without consent and explicit opt-in');
}finally{await browser.close();await new Promise(r=>server.close(r));}
