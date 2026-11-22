import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',extname(p)==='.js'?'text/javascript':extname(p)==='.html'?'text/html':extname(p)==='.css'?'text/css':'application/octet-stream');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const names=['Testschutter Een','Testschutter Twee','Testschutter Drie','Testschutter met lange familienaam Vier','Testschutter Vijf','Testschutter Zes'];
const shooters=names.map((name,i)=>({id:'shooter-'+i,name,publicId:'EPP-TEST'+i,clubs:[{code:i%2?'apgs':'svbb',name:i%2?'APGS':'SV Beemte Broekland'}]}));
const match={id:'mixed-match',organizer:'Gemengde teamwedstrijd',match_date:'2035-11-14',offered_disciplines:['pistool','optiek']};
try{
 for(const width of [390,1440])for(const mode of ['head','member','outsider']){
  let group={id:'dreamteam',name:'Dreamteam',revision:1,canManage:mode!=='outsider',canLink:mode==='head',members:shooters.map((s,i)=>({...s,memberId:'pool-'+i,...(mode==='head'&&i===5?{id:null}: {})}))},teams=[],lastSave=null,reject=true,locked=false;
  const account={id:'account-'+mode,username:mode,displayName:'Test '+mode,role:mode==='head'?'trainer':'schutter',clubId:mode==='head'?'eppnationaal':'svbb',isAdmin:mode==='head',isPlatformAdmin:mode==='head'};
  const context=await browser.newContext({viewport:{width,height:1000}});
  await context.addInitScript(account=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1',account.clubId);localStorage.setItem('epp-app-role-v1',account.role);},account);
  await context.route('**/functions/v1/**',async route=>{
   const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let r={ok:true};
   if(fn==='epp-auth')r={ok:true,account,clubs:[],accounts:[]};
   if(fn==='epp-training')r={ok:true,rows:[],backups:[]};
   if(fn==='epp-platform')r={ok:true,shooters:[],ranking:[],matchRanking:[],qualifications:[],events:[],matches:[match]};
   if(fn==='epp-signup')r={ok:true,matches:[],shooters:[],signups:[]};
   if(fn==='epp-planner')r={ok:true,matches:[]};
   if(fn==='epp-teams'){
    if(b.action==='context')r={ok:true,matches:[match],matchId:b.matchId||null,shooters,teams:b.matchId?teams:[],teamGroups:[group],canManage:account.isAdmin,clubCode:account.clubId};
    if(b.action==='link_group_member'){
     assert.equal(mode,'head');assert.equal(b.memberId,'pool-5');assert.equal(b.shooterId,'shooter-5');assert.equal(b.expectedRevision,1);
     group={...group,revision:2,members:group.members.map(m=>m.memberId==='pool-5'?{...m,id:b.shooterId}:m)};
    }
    if(b.action==='save_group_lineup'){
     assert.notEqual(mode,'outsider');lastSave=b;assert.equal(b.members.length,4);
     if(reject)r={ok:false,error:'team_conflict'};
     else teams=[{id:'lineup',groupId:'dreamteam',teamName:'Dreamteam',club:'Dreamteam',clubCode:null,number:1,revision:b.expectedRevision+1,score:locked?900:0,completed:locked?4:0,position:locked?1:null,locked,members:b.members.map((id,i)=>({...shooters.find(s=>s.id===id),club:shooters.find(s=>s.id===id).clubs[0].name,score:locked?240-i*10:null}))}];
    }
   }
   await route.fulfill({status:r.ok?200:400,contentType:'application/json',body:JSON.stringify(r)});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'Wedstrijden',exact:true}).click();await page.getByRole('button',{name:'Teams',exact:true}).first().click();
  await page.getByRole('heading',{name:'Dreamteam · zelfstandig team',exact:true}).waitFor();
  if(mode==='head'){
   await page.getByLabel('Schutterprofiel voor Testschutter Zes',{exact:true}).selectOption('shooter-5');
   await page.getByRole('button',{name:'Profiel koppelen aan Testschutter Zes',exact:true}).click();
   await page.getByText('Schutterprofiel gekoppeld',{exact:true}).waitFor();
  }
  await page.getByLabel('Teamwedstrijd',{exact:true}).selectOption('mixed-match');
  if(mode==='outsider')assert.equal(await page.getByRole('button',{name:'Vier schutters aanwijzen',exact:true}).count(),0);
  else{
   await page.getByRole('button',{name:'Vier schutters aanwijzen',exact:true}).click();
   for(let i=0;i<4;i++)await page.getByLabel('Dreamteam schutter '+(i+1),{exact:true}).selectOption('shooter-'+i);
   assert.equal(await page.getByLabel('Dreamteam schutter 1',{exact:true}).locator('option').count(),7,'all six across clubs are available');
   await page.getByText('Reserve: Testschutter Vijf, Testschutter Zes',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Opstelling opslaan',exact:true}).click();
   await page.getByRole('status').filter({hasText:'elders gewijzigd'}).waitFor();
   assert.equal(await page.getByLabel('Dreamteam schutter 4',{exact:true}).inputValue(),'shooter-3','failed save retains choices');
   reject=false;await page.getByRole('button',{name:'Opstelling opslaan',exact:true}).click();
   await page.getByText('Teamopstelling online opgeslagen',{exact:true}).waitFor();assert.equal(lastSave.expectedRevision,0);
   await page.getByRole('button',{name:'Opstelling wijzigen',exact:true}).click();
   await page.getByLabel('Dreamteam schutter 4',{exact:true}).selectOption('shooter-5');locked=true;
   await page.getByRole('button',{name:'Opstelling opslaan',exact:true}).click();
   await page.getByText('1. Dreamteam',{exact:true}).waitFor();await page.getByText('900 / 1000',{exact:true}).waitFor();
   assert.equal(lastSave.expectedRevision,1);assert.deepEqual(lastSave.members,['shooter-0','shooter-1','shooter-2','shooter-5']);
   assert.equal(await page.getByRole('button',{name:'Opstelling wijzigen',exact:true}).isDisabled(),true);
   await page.getByText('Reserve: Testschutter met lange familienaam Vier, Testschutter Vijf',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Teamuitslag',exact:true}).click();await page.getByLabel('Teamwedstrijd',{exact:true}).selectOption('mixed-match');
   await page.getByText('1. Dreamteam',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Opstelling wijzigen',exact:true}).count(),0);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');assert.deepEqual(errors,[]);
  console.log('PASS independent team '+width+' '+mode+': six members, four selected, reserves, own clubs, score lock and permissions');await context.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
