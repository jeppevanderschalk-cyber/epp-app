import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.png':'image/png','.css':'text/css'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH}),errors=[];

try{
 for(const width of [390,1440]){
  for(const head of [true,false]){
   const account={id:head?'head':'clubadmin',username:head?'hoofdbeheer':'beheer',role:'trainer',clubId:head?'eppnationaal':'apgs',isAdmin:true,isPlatformAdmin:head};
   let rows=[{id:'apgs-new',club_code:'apgs',display_name:'Nieuwe APGS schutter',membership_approved:false,active:true},{id:'hansi-new',club_code:'hansi',display_name:'Nieuwe Hansi schutter',membership_approved:false,active:true},{id:'approved',club_code:'apgs',display_name:'Al goedgekeurd',membership_approved:true,active:true},{id:'blocked',club_code:'apgs',display_name:'Geblokkeerd',membership_approved:false,active:false}],fail=false;
   const context=await browser.newContext({viewport:{width,height:950}});
   await context.addInitScript(account=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1',account.clubId);localStorage.setItem('epp-app-role-v1',account.role);},account);
   await context.route('**/functions/v1/**',async route=>{
    const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let data={ok:true,matches:[],shooters:[],entities:[],ranking:[],matchRanking:[],qualifications:[],events:[],backups:[],clubs:[],accounts:[]};
    if(fn==='epp-auth'){
     if(b.action==='session')data={ok:true,account};
     if(['list_club_access','list_accounts'].includes(b.action)){
      if(fail)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'server_fout'})});
      const scoped=head?rows:rows.filter(a=>a.club_code==='apgs');
      data={ok:true,accounts:scoped,clubs:[{code:'svbb',naam:'SV Beemte Broekland'},{code:'apgs',naam:'APGS'},{code:'hansi',naam:'Hansi'}]};
     }
     if(b.action==='get_publication_consent')data={ok:true,consent:{allowed:false}};
     if(b.action==='approve_member'){assert.equal(b.accountId,'apgs-new');rows=rows.map(a=>a.id===b.accountId?{...a,membership_approved:true}:a);}
    }
    await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(url);
   await page.getByRole('button',{name:'Aanvragen bekijken',exact:true}).click();
   const requests=page.getByRole('region',{name:'Openstaande accountaanvragen'});
   await requests.getByRole('group',{name:'Aanvraag Nieuwe APGS schutter'}).waitFor();
   assert.equal(await page.locator('#membership-requests').getAttribute('open'),'');
   assert.equal(await requests.getByRole('group').count(),head?2:1);
   assert.equal(await requests.getByText('Al goedgekeurd',{exact:true}).count(),0);
   assert.equal(await requests.getByText('Geblokkeerd',{exact:true}).count(),0);
   fail=true;await requests.getByRole('button',{name:'Aanvragen verversen'}).click();await requests.getByRole('alert').waitFor();
   fail=false;await requests.getByRole('button',{name:'Aanvragen verversen'}).click();
   const apgs=requests.getByRole('group',{name:'Aanvraag Nieuwe APGS schutter'});await apgs.getByRole('button',{name:'Lidmaatschap goedkeuren'}).click();
   await apgs.waitFor({state:'detached'});
   if(head)await requests.getByRole('group',{name:'Aanvraag Nieuwe Hansi schutter'}).waitFor();
   else await requests.getByText('Er zijn geen openstaande aanvragen.',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await context.close();
  }
 }
 assert.deepEqual(errors,[]);console.log('PASS mobile/desktop: notification opens requests, head sees multiple clubs, club scope, approval, error/retry and empty state');
}finally{await browser.close();await new Promise(r=>server.close(r));}
