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
    const context=await browser.newContext({viewport});let signup=null,registration=null;
    await context.addInitScript(account=>{
      if(!localStorage.getItem('epp-session-v2'))localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));
      if(!localStorage.getItem('epp-app-club-v1'))localStorage.setItem('epp-app-club-v1','svbb');localStorage.setItem('epp-app-role-v1','schutter');
    },shared);
    await context.route('https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/**',async route=>{
      const body=route.request().postDataJSON(),fn=route.request().url().split('/').pop();
      let response={ok:true};
      if(fn==='epp-auth'){
        response={ok:true,account:body.sessionToken==='b'.repeat(64)?personal:shared};
        if(body.action==='register_member'){registration=body;response={ok:true,account:personal,sessionToken:'b'.repeat(64)};}
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
    await page.getByText('Eigen account aanmaken',{exact:true}).waitFor();
    await page.locator('section').filter({has:page.getByText('Eigen account aanmaken',{exact:true})}).locator('select').selectOption('apgs');
    await page.getByRole('textbox',{name:'Voornaam',exact:true}).fill('Anne');
    await page.getByRole('textbox',{name:'Achternaam',exact:true}).fill('de Vries');
    await page.getByLabel('Eigen wachtwoord',{exact:true}).fill('SafePassword123!');
    await page.getByLabel('Herhaal wachtwoord',{exact:true}).fill('DifferentPassword');
    await page.getByRole('button',{name:'Account aanmaken',exact:true}).click();
    await page.getByText('De wachtwoorden zijn niet gelijk.',{exact:true}).waitFor();assert.equal(registration,null);
    await page.getByLabel('Herhaal wachtwoord',{exact:true}).fill('SafePassword123!');
    await page.screenshot({path:'/private/tmp/epp-member-register-'+viewport.width+'.png'});
    await page.getByRole('button',{name:'Account aanmaken',exact:true}).click();
    await page.getByText('Jouw inschrijvingen',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Landelijk',exact:true}).getAttribute('data-on'),'1');
    assert.equal(await page.getByRole('button',{name:'Inschrijven wedstrijd',exact:true}).getAttribute('data-on'),'1');
    await page.getByRole('button',{name:'Individueel',exact:true}).click();
    await page.getByLabel('Wedstrijd',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Inschrijven wedstrijd',exact:true}).click();
    await page.getByText('Jouw inschrijvingen',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Meer',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Inschrijven voor wedstrijden',exact:true}).count(),0);
    await page.getByRole('button',{name:'Landelijk',exact:true}).click();
    await page.getByText('Jouw inschrijvingen',{exact:true}).waitFor();
    assert.equal(registration.firstName,'Anne');assert.equal(registration.lastName,'de Vries');
    assert.equal(registration.clubId,'svbb');assert.equal(registration.registrationClubId,'apgs');
    assert.equal(await page.evaluate(()=>localStorage.getItem('epp-app-club-v1')),'apgs');
    assert.equal(await page.getByRole('combobox',{name:'Kies je naam'}).count(),0);
    await page.getByRole('button',{name:'DOE MEE',exact:true}).click();
    await page.getByLabel('Pistool (keep & korrel)',{exact:true}).check();
    await page.getByRole('button',{name:'OPSLAAN',exact:true}).click();
    await page.getByText('Inschrijving opgeslagen',{exact:true}).waitFor();
    assert.equal(signup.shooterId,'own-shooter');assert.equal(signup.sessionToken,'b'.repeat(64));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'/private/tmp/epp-member-signup-'+viewport.width+'.png'});
    await context.close();
    console.log('PASS '+viewport.width+': registration, password confirmation, personal session and own match signup');
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
