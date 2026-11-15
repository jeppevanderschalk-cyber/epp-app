import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/epp-recovery-tools/node_modules/playwright/index.mjs');
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const url='http://127.0.0.1:'+server.address().port;
try{
 for(const width of [390,1440])for(const head of [false,true]){
  const account={id:'admin-id',username:'testadmin',displayName:'Test Beheer',role:'trainer',clubId:head?'eppnationaal':'svbb',isAdmin:true,isPlatformAdmin:head};
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.addInitScript(account=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1',account.clubId);},account);
  let requests=[{id:'request-id',account_id:'member-id',display_name:'Ger Testlid',club_code:'svbb',club_name:'SVBB',login_username:'ger.test',requested_at:'2026-11-15T10:00:00Z'},...(head?[{id:'other-request',account_id:'other-id',display_name:'Ander Beheer',club_code:'apgs',club_name:'APGS',requested_at:'2026-11-15T10:00:00Z'}]:[])];
  let failLoad=false,failSave=true,lastReset;
  await context.route('**/functions/v1/**',async route=>{
    const body=route.request().postDataJSON();let data={ok:true,shooters:[],matches:[],accounts:[],entities:[],qualifications:[],ranking:[],matchRanking:[],clubs:[]};
    if(body.action==='session')data.account=account;
    if(body.action==='list_password_help')data=failLoad?{ok:false,error:'server_fout'}:{ok:true,requests};
    if(body.action==='resolve_password_help'){
      lastReset=body;data=failSave?{ok:false,error:'server_fout'}:{ok:true};
      if(!failSave)requests=requests.filter(r=>r.id!==body.requestId);
    }
    if(body.action==='get_publication_consent')data.consent={allowed:false};
    await route.fulfill({status:data.ok?200:400,contentType:'application/json',body:JSON.stringify(data)});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
  await page.getByRole('button',{name:'Wachtwoordverzoeken bekijken',exact:true}).click();
  const section=page.getByRole('region',{name:'Wachtwoordherstelverzoeken',exact:true});
  await section.waitFor();
  assert.equal(await page.locator('#password-help-requests').getAttribute('open'),'');
  assert.equal(await section.getByRole('group').count(),head?2:1);
  failLoad=true;await section.getByRole('button',{name:'Herstelverzoeken verversen',exact:true}).click();
  await section.getByText('Herstelverzoeken laden is niet gelukt.',{exact:false}).waitFor();
  failLoad=false;await section.getByRole('button',{name:'Herstelverzoeken verversen',exact:true}).click();
  const request=section.getByRole('group',{name:'Wachtwoordverzoek Ger Testlid',exact:true});
  await request.getByRole('button',{name:'Tijdelijk wachtwoord geven',exact:true}).click();
  const input=request.getByLabel('Tijdelijk wachtwoord',{exact:true});const generated=await input.inputValue();
  assert.match(generated,/^[A-Za-z0-9_-]{16}$/);
  await request.getByRole('button',{name:'Ander wachtwoord voorstellen',exact:true}).click();
  assert.notEqual(await input.inputValue(),generated);
  const password=await input.inputValue();
  await request.getByRole('button',{name:'Tijdelijk wachtwoord instellen',exact:true}).click();
  await section.getByText('Het tijdelijke wachtwoord is niet ingesteld.',{exact:false}).waitFor();
  assert.equal(await input.inputValue(),password,'Keep the proposed password after failed save');
  failSave=false;await request.getByRole('button',{name:'Tijdelijk wachtwoord instellen',exact:true}).click();
  await request.waitFor({state:'detached'});
  await section.getByText('Tijdelijk wachtwoord ingesteld voor Ger Testlid',{exact:true}).waitFor();
  assert.equal(lastReset.requestId,'request-id');assert.equal(lastReset.newPassword,password);assert.equal(lastReset.clubId,account.clubId);
  assert.equal(await section.getByLabel('Ingesteld tijdelijk wachtwoord',{exact:true}).inputValue(),password);
  await section.getByRole('button',{name:'Gereed',exact:true}).click();
  assert.equal(await section.getByLabel('Ingesteld tijdelijk wachtwoord',{exact:true}).count(),0);
  if(!head){await section.getByText('Er zijn geen openstaande wachtwoordverzoeken.',{exact:true}).waitFor();await page.getByRole('button',{name:'Wachtwoordverzoeken bekijken',exact:true}).waitFor({state:'detached'});}
  else await section.getByRole('group',{name:'Wachtwoordverzoek Ander Beheer',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS administrator help mobile/desktop: notice, direct navigation, head/club lists, loading errors, random passwords, failed save/retry, handover and cleared request');
}finally{await browser.close();await new Promise(r=>server.close(r));}
