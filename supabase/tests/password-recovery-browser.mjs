import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/epp-audit-tools/node_modules/playwright/index.mjs');
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const url='http://127.0.0.1:'+server.address().port;
try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.abort());await page.goto(url);
  await page.evaluate(()=>{window.requests=[];window.eppRawCall=async(fn,body)=>{requests.push(body);if(!window.ready)throw Error('maildienst_niet_ingesteld');return {ok:true};};});
  await page.getByRole('button',{name:'Wachtwoord vergeten?',exact:true}).click();
  await page.getByLabel('E-mailadres van je account',{exact:true}).fill('test@example.invalid');
  await page.getByRole('button',{name:'Resetlink aanvragen',exact:true}).click();
  await page.getByText('Resetmails zijn nog niet beschikbaar.',{exact:false}).waitFor();
  await page.evaluate(()=>{window.ready=true;});
  await page.getByRole('button',{name:'Resetlink aanvragen',exact:true}).click();
  await page.getByText('Als dit e-mailadres bij een account',{exact:false}).waitFor();
  assert.equal((await page.evaluate(()=>requests.at(-1))).email,'test@example.invalid');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'Terug naar inloggen',exact:true}).click();
  await page.goto(url+'/#wachtwoord-herstellen='+'a'.repeat(64));
  await page.getByRole('dialog').waitFor();assert.equal(new URL(page.url()).hash,'');
  await page.evaluate(()=>{window.requests=[];window.eppRawCall=async(fn,body)=>{requests.push(body);if(!window.valid)throw Error('resetlink_ongeldig');return {ok:true};};});
  await page.getByLabel('Nieuw wachtwoord (minimaal 10 tekens)',{exact:true}).fill('Nieuw-wachtwoord-123');
  await page.getByLabel('Herhaal nieuw wachtwoord',{exact:true}).fill('Ander-wachtwoord-123');
  await page.getByRole('button',{name:'Nieuw wachtwoord opslaan',exact:true}).click();
  await page.getByText('De wachtwoorden zijn niet gelijk.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>requests.length),0);
  await page.getByLabel('Herhaal nieuw wachtwoord',{exact:true}).fill('Nieuw-wachtwoord-123');
  await page.getByRole('button',{name:'Nieuw wachtwoord opslaan',exact:true}).click();
  await page.getByText('Deze resetlink is verlopen of al gebruikt.',{exact:false}).waitFor();
  await page.evaluate(()=>{window.valid=true;sessionStorage.setItem('epp-session-v2','old');});
  await page.getByRole('button',{name:'Nieuw wachtwoord opslaan',exact:true}).click();
  await page.getByText('Je wachtwoord is gewijzigd.',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('epp-session-v2')),null);
  assert.equal(await page.getByLabel('Herhaal nieuw wachtwoord',{exact:true}).inputValue(),'');
  assert.deepEqual(errors,[]);await page.close();
 }
 for(const forced of [false,true]){
  const account={id:'admin-id',username:'testadmin',displayName:'Test Beheer',role:'trainer',clubId:'svbb',isAdmin:true,isPlatformAdmin:false,mustChangePassword:forced};
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(account=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1','svbb');},account);
  let resetRequest;
  await context.route('**/functions/v1/**',async route=>{
    const body=route.request().postDataJSON();let data={ok:true,shooters:[],matches:[],accounts:[],entities:[],qualifications:[],ranking:[],matchRanking:[],clubs:[]};
    if(body.action==='session')data.account=account;
    if(body.action==='list_accounts')data.accounts=[{id:'member-id',username:'testmember',display_name:'Herstel Lid',role:'schutter',active:true,membership_approved:true},{id:'protected-admin',username:'otheradmin',display_name:'Andere Beheerder',is_admin:true,role:'trainer',active:true}];
    if(body.action==='admin_reset_password')resetRequest=body;
    if(body.action==='get_publication_consent')data.consent={allowed:false};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  const page=await context.newPage();await page.goto(url);
  if(forced){
    await page.getByRole('button',{name:'Wachtwoord wijzigen',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Wedstrijden',exact:true}).count(),0);
  }else{
    await page.getByRole('button',{name:'Meer',exact:true}).click();
    await page.locator('#account-management > summary').click();
    const button=page.getByRole('button',{name:'Wachtwoord herstellen',exact:true});await button.waitFor();assert.equal(await button.count(),1);
    await button.click();
    await page.locator('#account-management').getByLabel('Tijdelijk wachtwoord',{exact:true}).first().fill('Tijdelijk-test-1234');
    await page.getByRole('button',{name:'Tijdelijk wachtwoord instellen',exact:true}).click();
    await page.getByText('Tijdelijk wachtwoord ingesteld voor Herstel Lid.',{exact:false}).waitFor();
    assert.equal(resetRequest.accountId,'member-id');assert.equal(resetRequest.newPassword,'Tijdelijk-test-1234');
  }
  await context.close();
 }
 console.log('PASS recovery mobile/desktop, missing mail service, request, fragment removal, mismatch, expired link, success and old-session removal');
}finally{await browser.close();await new Promise(r=>server.close(r));}
