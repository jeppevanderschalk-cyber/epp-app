import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const file=resolve(root,'.'+(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const account={id:'head',username:'lid.head',clubId:'svbb',role:'trainer',isAdmin:true,isPlatformAdmin:true,displayName:'Head',sessionToken:'a'.repeat(64)};
const accounts=[{id:'member',display_name:'Test Schutter',club_code:'svbb',is_admin:false},{id:'legacy',display_name:'Migratiebeheer',club_code:'svbb',is_admin:true}];
const errors=[];
try{
  for(const head of [true,false])for(const width of [390,1440]){
    let revision=1,assigned=false,conflict=false,adminCalls=0,newMatch=false;
    const page=await browser.newPage({viewport:{width,height:950}});
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    const sessionAccount={...account,isPlatformAdmin:head};
    await page.addInitScript(a=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:a.sessionToken,account:a}));localStorage.setItem('epp-app-club-v1','svbb');localStorage.setItem('epp-app-role-v1','trainer');},sessionAccount);
    await page.route('https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/**',async route=>{
      const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let r={ok:true},status=200;
      if(fn==='epp-auth'){
        if(b.action==='list_club_access')assert.equal(head,true);
        r=['list_club_access','list_accounts'].includes(b.action)?{ok:true,clubs:[{code:'svbb',naam:'SVBB'}],accounts:accounts.map(a=>head?a:({...a,club_code:undefined}))}:{ok:true,account:sessionAccount};
        if(b.action==='set_club_admin')adminCalls++;
      }
      if(fn==='epp-training')r={ok:true,entities:[]};
      if(fn==='epp-signup')r={ok:true,matches:[],shooters:[],signups:[]};
      if(fn==='epp-planner')r={ok:true,matches:[]};
      if(fn==='epp-platform')r={ok:true,ranking:[],matchRanking:[],matches:[],shooters:[]};
      if(fn==='epp-scoring'){
        if(b.action==='catalog')r={ok:true,matches:[{id:'foreign',organizer:head?'De Korrel':'SVBB',match_date:'2026-11-14'},{id:'closed',organizer:'SVBB',match_date:'2026-12-01',closed:true},...(newMatch?[{id:'new',organizer:'SVBB',match_date:'2027-05-28'}]:[])]};
        if(b.action==='view')r={ok:true,matchId:b.matchId,managing:true,closed:b.matchId==='closed',revision,accounts:[{id:'member'}],scorers:assigned?[{account_id:'member'}]:[]};
        if(b.action==='control'){
          assert.equal(b.control,'scorer');assert.equal(b.accountId,'member');assert.equal(b.matchId,'foreign');
          if(conflict){conflict=false;revision++;r={ok:false,error:'wedstrijd_conflict'};status=409;}
          else{assert.equal(b.expectedRevision,revision);revision++;assigned=b.enabled;}
        }
      }
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(r)});
    });
    await page.goto('http://127.0.0.1:'+server.address().port);
    // Mount the real management component without navigating unrelated settings.
    await page.evaluate(()=>{ReactDOM.render(h('div',{className:'app'},h('style',null,CSS),h('main',{style:{padding:16}},h(PlatformAccessManagement))),document.getElementById('root'));});
    const member=page.getByRole('group',{name:'Test Schutter',exact:true});
    await member.waitFor();
    if(!head){assert.equal(await page.getByRole('button',{name:'Beheerrechten geven',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Account verwijderen',exact:true}).count(),0);}
    newMatch=true;await page.getByRole('button',{name:'Wedstrijden verversen',exact:true}).click();
    await page.getByLabel('Wedstrijd voor scoorderrechten').locator('option[value="new"]').waitFor({state:'attached'});
    assert.equal(await member.getByRole('button',{name:'Scoorderrechten geven',exact:true}).isDisabled(),true);
    await page.getByLabel('Wedstrijd voor scoorderrechten').selectOption('foreign');
    await member.getByRole('button',{name:'Scoorderrechten geven',exact:true}).click();
    await page.getByText('Scoorderrechten opgeslagen.',{exact:true}).waitFor();
    assert.equal(assigned,true);assert.equal(adminCalls,0);
    await page.getByRole('button',{name:'Scoorderrechten intrekken',exact:true}).click();
    await member.getByRole('button',{name:'Scoorderrechten geven',exact:true}).waitFor();assert.equal(assigned,false);
    conflict=true;await member.getByRole('button',{name:'Scoorderrechten geven',exact:true}).click();
    await page.getByText('Rechten zijn intussen gewijzigd. Controleer de bijgewerkte lijst en probeer opnieuw.',{exact:true}).waitFor();
    await member.getByRole('button',{name:'Scoorderrechten geven',exact:true}).click();
    await page.getByRole('button',{name:'Scoorderrechten intrekken',exact:true}).waitFor();assert.equal(assigned,true);
    await page.getByRole('button',{name:'Scoorderrechten intrekken',exact:true}).click();
    await page.getByLabel('Wedstrijd voor scoorderrechten').selectOption('closed');
    await page.waitForTimeout(150);
    assert.equal(await member.getByRole('button',{name:'Scoorderrechten geven',exact:true}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'/private/tmp/epp-head-scorer-'+width+'.png',fullPage:true});
    await page.close();console.log('PASS '+width+': independent scorer rights, revoke, conflict refresh and definitive guard');
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
