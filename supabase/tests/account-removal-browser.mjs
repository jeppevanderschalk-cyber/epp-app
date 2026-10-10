import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const file=resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',extname(file)==='.html'?'text/html':extname(file)==='.js'?'text/javascript':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
  for(const width of [390,1440])for(const component of ['AccountManagement','PlatformAccessManagement']){
    const context=await browser.newContext({viewport:{width,height:900}}),account={id:'head',username:'hoofdbeheer',role:'trainer',clubId:'eppnationaal',isAdmin:true,isPlatformAdmin:true};
    let records=[{id:'active',display_name:'Active Member',username:'lid.active',club_code:'svbb',role:'schutter',active:true},{id:'blocked',display_name:'Blocked Member',username:'lid.blocked',club_code:'svbb',role:'schutter',active:false},{...account,display_name:'Head',club_code:'eppnationaal',is_platform_admin:true},{id:'shared',display_name:'Registration',username:'kijker',club_code:'eppnationaal',role:'schutter',active:true}],requests=[],fail=true;
    await context.addInitScript(a=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account:a}));localStorage.setItem('epp-app-club-v1',a.clubId);localStorage.setItem('epp-app-role-v1',a.role);},account);
    await context.route('**/functions/v1/**',async route=>{
      const b=route.request().postDataJSON();let data={ok:true,account,entities:[],shooters:[],matches:[],clubs:[{code:'svbb',naam:'SVBB'}],accounts:records.filter(a=>a.username!=='kijker')};
      if(b.action==='list_accounts')data.accounts=records;
      if(b.action==='delete_account'){
        requests.push(b);
        if(fail)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:'test_failure'})});
        records=records.filter(a=>a.id!==b.accountId);
      }
      await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>typeof AccountManagement==='function');
    await page.evaluate(name=>{window.accountTestRoot=ReactDOM.createRoot(document.getElementById('root'));window.accountTestRoot.render(h('div',{className:'app'},h('style',null,CSS),h('main',{className:'main'},h(name==='AccountManagement'?AccountManagement:PlatformAccessManagement))));eppShowApp();},component);
    const deletes=page.getByRole('button',{name:'Account verwijderen',exact:true});await deletes.first().waitFor();assert.equal(await deletes.count(),2);
    page.once('dialog',d=>d.dismiss());await deletes.first().click();assert.equal(requests.length,0);
    page.once('dialog',d=>d.accept());await deletes.first().click();await page.getByText('test_failure',{exact:true}).waitFor();assert.equal(await deletes.count(),2);
    fail=false;page.once('dialog',d=>{assert.match(d.message(),/Scores, inschrijvingen en het auditlog blijven behouden/);d.accept();});await deletes.first().click();await page.getByText('Account verwijderd. Scores en inschrijvingen zijn behouden.',{exact:true}).waitFor();assert.equal(await deletes.count(),1);
    assert.equal(requests.at(-1).accountId,'active');assert.equal(requests.at(-1).confirmAccountId,'active');assert.equal(requests.at(-1).clubId,'eppnationaal');
    page.once('dialog',d=>d.accept());await deletes.first().click();await deletes.waitFor({state:'detached'});assert.equal(requests.at(-1).accountId,'blocked');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
    if(component==='AccountManagement'){
      records=[{id:'ordinary',display_name:'Ordinary',username:'lid.ordinary',role:'schutter',active:true}];
      await page.evaluate(()=>{const s=eppSession();s.account.isPlatformAdmin=false;localStorage.setItem(EPP_SESSION_KEY,JSON.stringify(s));window.accountTestRoot.render(h(AccountManagement,{key:'ordinary'}));});
      await page.getByText('Ordinary',{exact:false}).waitFor();assert.equal(await deletes.count(),0);
    }
    await context.close();console.log('PASS '+component+' '+width+': confirmation, failure retention, active/blocked removal, protected accounts and role visibility');
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
