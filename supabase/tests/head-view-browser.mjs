import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname,file=resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const clubs=[{code:'eppnationaal',naam:'Landelijk EPP'},{code:'svbb',naam:'SVBB'},{code:'dekorrel',naam:'SV De Korrel - Druten'}];
const fixture=club=>[
  {kind:'shooter',id:club+'-shooter',data:{id:club+'-shooter',naam:club==='svbb'?'Test Schutter SVBB':'Test Schutter De Korrel'}},
  {kind:'meta',id:'currentTraining',data:{id:'training',mode:'parcours',stage:'s1'}},
  {kind:'meta',id:'stageShots',data:{s1:10,s2:5,s3:5,s4:10,s5:5,s6:5,s7:10}},
  {kind:'round',id:'round',data:{id:'round',sid:club+'-shooter',type:'parcours',trainingId:'training',score:200,ts:1}},
  {kind:'parcoursBest',id:club+'-shooter',data:{score:200}}
];
try{
  for(const width of [375,390,1440]){
    const account={id:'head',username:'hoofdbeheer',displayName:'Hoofdbeheer',role:'trainer',clubId:'eppnationaal',isAdmin:true,isPlatformAdmin:true};
    const context=await browser.newContext({viewport:{width,height:900}}),calls=[],nationalEntities=new Map();
    await context.addInitScript(a=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account:a}));localStorage.setItem('epp-app-club-v1',a.clubId);localStorage.setItem('epp-app-role-v1',a.role);},account);
    await context.route('**/functions/v1/**',async route=>{
      const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();calls.push({fn,...b});
      let data={ok:true,account,entities:[],matches:[],shooters:[],clubs,accounts:[]};
      if(fn==='epp-training'){
        if(b.action==='save')for(const op of b.ops)nationalEntities.set(op.kind+'|'+op.id,{kind:op.kind,id:op.id,data:op.value});
        data={ok:true,entities:[...nationalEntities.values()]};
      }
      if(fn==='epp-head-view'&&b.action==='view'){
        if(b.targetClubId==='svbb')await new Promise(r=>setTimeout(r,150));
        data={ok:true,club:clubs.find(c=>c.code===b.targetClubId),readOnly:true,entities:fixture(b.targetClubId),qualifications:[{shooter_id:b.targetClubId+'-shooter',title:'Expert',qualification_year:2026,source:'Test'}]};
      }
      await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    const select=page.getByLabel('Vereniging bekijken',{exact:true});await select.waitFor();
    await page.waitForFunction(()=>!document.querySelector('[aria-label="Vereniging bekijken"]').disabled);
    await select.selectOption('svbb');await page.getByText('Alleen bekijken',{exact:true}).waitFor();
    // A late response from the previous association must never populate this view.
    await select.selectOption('dekorrel');
    await page.locator('span').filter({hasText:/^Test Schutter De Korrel$/}).waitFor();await page.waitForTimeout(300);
    assert.equal(await page.getByText('Test Schutter SVBB',{exact:true}).count(),0);
    assert.equal(await page.locator('#root input').count(),0);
    assert.equal(await page.getByRole('button',{name:/Opslaan|afsluiten|toevoegen|Inschrijven/i}).count(),0);
    await page.getByRole('button',{name:'Stand',exact:true}).click();
    await page.getByText('Expert · 2026',{exact:true}).first().waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const overlap=await page.evaluate(()=>document.querySelector('.head-club-selector').getBoundingClientRect().left<document.querySelector('.topbar-title').getBoundingClientRect().right-1);assert.equal(overlap,false);
    await page.waitForTimeout(600);await page.screenshot({path:'/private/tmp/epp-head-view-'+width+'.png',fullPage:true});
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('epp-session-v2')).account.clubId),'eppnationaal');
    assert.equal(await page.evaluate(()=>localStorage.getItem('epp-app-club-v1')),'eppnationaal');
    assert.ok(calls.filter(c=>c.fn==='epp-head-view').every(c=>['view','catalog'].includes(c.action)&&c.clubId==='eppnationaal'));
    assert.ok(calls.filter(c=>c.fn==='epp-training').every(c=>c.clubId==='eppnationaal'));
    await page.getByRole('button',{name:'Hoofdbeheer',exact:true}).click();
    await page.getByLabel('Vereniging bekijken',{exact:true}).waitFor();assert.equal(await page.getByText('Alleen bekijken',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);await context.close();console.log('PASS readonly head '+width+': rapid switching, correct club data, no editing controls, original session preserved');
  }
  for(const role of ['trainer','schutter']){
    const context=await browser.newContext({viewport:{width:390,height:900}}),account={id:'ordinary',role,clubId:'svbb',isAdmin:role==='trainer',isPlatformAdmin:false};
    await context.addInitScript(a=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'b'.repeat(64),account:a}));localStorage.setItem('epp-app-club-v1',a.clubId);localStorage.setItem('epp-app-role-v1',a.role);},account);
    await context.route('**/functions/v1/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,account,entities:[],matches:[],shooters:[],signups:[],qualifications:[]})}));
    const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.getByLabel('Ingelogde vereniging').waitFor();
    assert.equal(await page.getByLabel('Vereniging bekijken').count(),0);await context.close();console.log('PASS ordinary '+role+': no association viewer');
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
