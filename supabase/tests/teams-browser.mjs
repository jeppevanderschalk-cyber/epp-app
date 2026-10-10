import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.html'?'text/html':'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const url='http://127.0.0.1:'+server.address().port;
const match={id:'team-match',organizer:'Teamwedstrijd',match_date:'2030-11-14',offered_disciplines:['pistool','optiek']};
const shooters=Array.from({length:9},(_,i)=>({id:'shooter-'+i,name:'Schutter '+(i+1),publicId:'EPP-TEST'+i,clubs:[{code:i<5?'svbb':'mercurius75',name:i<5?'SVBB':"SV Mercurius '75"}]}));
try{
  for(const width of [390,1440])for(const manager of [true,false]){
    let teams=[],lastSave=null,reject=true,locked=false;
    const account={id:'teams-account',username:manager?'beheer':'lid.test',displayName:'Test',role:manager?'trainer':'schutter',clubId:'svbb',isAdmin:manager};
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.addInitScript(account=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1',account.clubId);localStorage.setItem('epp-app-role-v1',account.role);},account);
    await context.route('**/functions/v1/**',async route=>{
      const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let r={ok:true};
      if(fn==='epp-auth')r={ok:true,account};
      if(fn==='epp-training')r={ok:true,rows:[],backups:[]};
      if(fn==='epp-platform')r={ok:true,shooters:[],ranking:[],matchRanking:[],qualifications:[],events:[],matches:[match]};
      if(fn==='epp-signup')r={ok:true,matches:[],shooters:[],signups:[]};
      if(fn==='epp-planner')r={ok:true,matches:[]};
      if(fn==='epp-teams'){
        if(b.action==='context')r={ok:true,matches:[match],matchId:b.matchId||null,shooters,teams:b.matchId?teams:[],canManage:manager,clubCode:'svbb'};
        if(b.action==='save'){
          lastSave=b;
          if(reject)r={ok:false,error:'team_conflict'};
          else{teams=[{id:b.teamId,number:b.number,revision:b.expectedRevision+1,clubCode:'svbb',club:'SVBB',score:locked?940:0,completed:locked?4:0,position:1,locked,members:b.members.map((id,i)=>({...shooters.find(s=>s.id===id),club:'SVBB',score:locked?250-i*10:null}))},{id:'other-team',number:1,revision:1,clubCode:'mercurius75',club:"SV Mercurius '75",score:900,completed:4,position:2,locked:true,members:shooters.slice(5).map(s=>({...s,club:"SV Mercurius '75",score:225}))}];}
        }
      }
      await route.fulfill({status:r.ok?200:400,contentType:'application/json',body:JSON.stringify(r)});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);
    await page.getByRole('button',{name:'Landelijk',exact:true}).click();
    await page.getByRole('button',{name:'Teams',exact:true}).first().click();
    await page.getByLabel('Teamwedstrijd').selectOption('team-match');
    if(manager){
      await page.getByRole('button',{name:'Nieuw team',exact:true}).click();
      for(let i=0;i<4;i++)await page.getByLabel('Teamlid '+(i+1)).selectOption('shooter-'+i);
      assert.equal(await page.getByLabel('Teamlid 1').locator('option').count(),6,'only own members');
      await page.waitForFunction(()=>document.querySelector('[aria-label="Teamlid 2"] option[value="shooter-0"]').disabled);
      await page.getByRole('button',{name:'Team opslaan',exact:true}).click();
      await page.getByRole('status').filter({hasText:'elders gewijzigd'}).waitFor();
      assert.equal(await page.getByLabel('Teamlid 4').inputValue(),'shooter-3','failed save preserves selection');
      reject=false;
      await page.getByRole('button',{name:'Team opslaan',exact:true}).click();
      await page.getByText('1. Team 1 · SVBB',{exact:true}).waitFor();
      assert.deepEqual(lastSave.members,['shooter-0','shooter-1','shooter-2','shooter-3']);
      const teamId=lastSave.teamId;
      assert.equal(await page.getByRole('button',{name:'Team bewerken',exact:true}).count(),1,'no edit action for another club');
      await page.getByRole('button',{name:'Team bewerken',exact:true}).click();
      await page.getByLabel('Teamnummer').fill('2');
      await page.getByLabel('Teamlid 4').selectOption('shooter-4');
      locked=true;
      await page.getByRole('button',{name:'Team opslaan',exact:true}).click();
      await page.getByText('1. Team 2 · SVBB',{exact:true}).waitFor();
      assert.equal(lastSave.teamId,teamId,'editing keeps the team ID');
      assert.equal(lastSave.expectedRevision,1,'editing uses the saved revision');
      assert.deepEqual(lastSave.members,['shooter-0','shooter-1','shooter-2','shooter-4']);
      assert.equal(await page.getByRole('button',{name:'Team bewerken',exact:true}).isDisabled(),true,'confirmed scores lock team editing');
      await page.getByText('Vastgelegd: er zijn bevestigde wedstrijdscores.',{exact:true}).waitFor();
      await page.getByText("2. Team 1 · SV Mercurius '75",{exact:true}).waitFor();
      await page.getByText('940 / 1000',{exact:true}).waitFor();
      await page.screenshot({path:'/private/tmp/epp-teams-'+width+'.png',fullPage:true});
    }else assert.equal(await page.getByRole('button',{name:'Nieuw team',exact:true}).count(),0,'viewer has no team controls');
    await page.getByRole('button',{name:'Schutters',exact:true}).click();
    await page.getByText('Schutter 6',{exact:true}).waitFor();
    assert.equal(await page.locator('#root div.hint').filter({hasText:/^SV Mercurius '75$/}).count(),4);
    await page.getByLabel('Zoek schutter of vereniging').fill('Mercurius');
    assert.equal(await page.getByText('Schutter 1',{exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
    assert.deepEqual(errors,[]);
    console.log('PASS teams '+width+' '+(manager?'manager':'viewer')+': club visibility, own members, save recovery, team ranking, permissions');
    await context.close();
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
