import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const match={id:'match',organizer:'Testwedstrijd',match_date:'2026-11-14',offered_disciplines:['pistool','optiek'],scoring:true,can_score:true};
const shooters=[{id:'s1',public_id:'EPP-001',display_name:'Anna Test',club:'SV Mercurius'},{id:'s2',public_id:'EPP-002',display_name:'Bert Test',club:'SVBB'}];
let leases=new Map(),saved=[],revision=1,assigned=[],closed=false;
const errors=[];
async function open(account,viewport){
  const context=await browser.newContext({viewport});
  await context.addInitScript(a=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:a.token,account:a}));localStorage.setItem('epp-app-club-v1',a.clubId);localStorage.setItem('epp-app-role-v1',a.role);},account);
  await context.route('https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/**',async route=>{
    const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let r={ok:true},status=200;
    if(fn==='epp-auth')r={ok:true,account};
    if(fn==='epp-training')r={ok:true,entities:[]};
    if(fn==='epp-signup')r={ok:true,matches:[],shooters:[],signups:[]};
    if(fn==='epp-planner')r={ok:true,matches:[]};
    if(fn==='epp-platform')r={ok:true,ranking:[],matchRanking:[],matches:[],shooters:[]};
    if(fn==='epp-scoring'){
      if(b.action==='catalog')r={ok:true,matches:[{...match,closed,can_score:!closed}]};
      if(b.action==='prepare_match')r={ok:true,round:{id:'round'}};
      if(b.action==='view'||b.action==='match_participants')r={ok:true,planned:true,shooters,managing:account.isAdmin,revision,closed,accounts:[{id:'invoerder',display_name:'Test Invoerder',club_code:'svbb'}],scorers:assigned.map(id=>({account_id:id})),audit:[]};
      if(b.action==='claim'){
        const old=leases.get(b.shooterId);
        if(old&&old!==b.leaseToken){r={ok:false,error:'schutter_in_bewerking'};status=409;}else leases.set(b.shooterId,b.leaseToken);
      }
      if(b.action==='release'&&leases.get(b.shooterId)===b.leaseToken)leases.delete(b.shooterId);
      if(b.action==='get_result')r={ok:true,result:null};
      if(b.action==='confirm_result'){assert.equal(b.leaseToken,leases.get(b.shooterId));assert.equal(b.expectedRevision,0);saved.push(b);leases.delete(b.shooterId);r={ok:true,result:{final_score:250}};}
      if(b.action==='control'){assert.equal(b.expectedRevision,revision);revision++;if(b.control==='close')closed=true;else assigned=b.enabled?[b.accountId]:[];}
    }
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(r)});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'Landelijk',exact:true}).click();
  await page.getByLabel('Wedstrijd',{exact:true}).selectOption('match');
  return {page,context};
}
async function select(page,name){await page.getByRole('searchbox',{name:'Schutter zoeken'}).fill(name);await page.getByRole('button',{name:new RegExp('^'+name+' Test')}).click();}
try{
  for(const viewport of [{width:390,height:844},{width:1440,height:1000}]){
    leases=new Map();saved=[];revision=1;assigned=[];closed=false;
    const first=await open({id:'one',token:'a'.repeat(64),username:'lid.one',role:'schutter',clubId:'svbb',displayName:'One',isAdmin:false},viewport);
    const second=await open({id:'two',token:'b'.repeat(64),username:'lid.two',role:'schutter',clubId:'mercurius75',displayName:'Two',isAdmin:false},viewport);
    await select(first.page,'Anna');await first.page.getByText('Gereserveerd voor jouw invoer',{exact:true}).waitFor();
    await select(second.page,'Anna');await second.page.getByText('Deze schutter wordt door een andere invoerder verwerkt.',{exact:true}).waitFor();
    assert.equal(await second.page.getByRole('spinbutton',{name:'Snelvuur 5 punten',exact:true}).isDisabled(),true);
    await select(second.page,'Bert');await second.page.getByText('Gereserveerd voor jouw invoer',{exact:true}).waitFor();
    assert.equal(leases.size,2);
    await first.page.getByRole('spinbutton',{name:'Snelvuur 5 punten',exact:true}).fill('10');
    await first.page.getByRole('spinbutton',{name:'Overige 5 punten',exact:true}).fill('40');
    await first.page.getByLabel('Snelvuurtijd (seconden en honderdsten)',{exact:true}).fill('12,40');
    await first.page.getByLabel('Eindtijd (minuten:seconden, inclusief snelvuur)',{exact:true}).fill('4:53');
    assert.equal(await first.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await first.page.screenshot({path:'/private/tmp/epp-match-scoring-'+viewport.width+'.png',fullPage:true});
    await first.page.screenshot({path:'/private/tmp/epp-match-scoring-viewport-'+viewport.width+'.png'});
    await first.page.getByRole('button',{name:'Bevestigen en opslaan',exact:true}).click();
    await first.page.getByText('Opgeslagen — klassement bijgewerkt',{exact:true}).waitFor();
    assert.equal(saved.length,1);assert.equal(saved[0].shooterId,'s1');assert.equal(saved[0].rapid.hits5,10);assert.equal(saved[0].hits5,50);
    await first.context.close();await second.context.close();
    const admin=await open({id:'admin',token:'c'.repeat(64),username:'lid.admin',role:'trainer',clubId:'svbb',displayName:'Admin',isAdmin:true},viewport);
    await admin.page.getByText('Wedstrijdinvoerders beheren',{exact:true}).click();
    await admin.page.getByLabel('Wedstrijdinvoerder',{exact:true}).selectOption('invoerder');
    await admin.page.getByRole('button',{name:'Invoerrechten geven',exact:true}).click();
    await admin.page.getByText('Invoerrechten opgeslagen',{exact:true}).waitFor();assert.deepEqual(assigned,['invoerder']);
    await admin.page.getByRole('button',{name:'Rechten intrekken',exact:true}).click();
    await admin.page.getByRole('button',{name:'Rechten intrekken',exact:true}).waitFor({state:'detached'});assert.deepEqual(assigned,[]);
    admin.page.on('dialog',d=>d.accept());
    await admin.page.getByRole('button',{name:'Uitslag definitief maken',exact:true}).click();
    await admin.page.getByText('Uitslag definitief gemaakt',{exact:true}).waitFor();assert.equal(closed,true);
    await admin.context.close();
    console.log('PASS '+viewport.width+': delegated input, two scorers, collision blocking, save, rights and closing');
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
