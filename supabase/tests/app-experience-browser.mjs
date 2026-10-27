import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html'));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const errors=[];
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',e=>errors.push(e.message));
  let failSave=false,revision=0,saveCount=0,failTraining=false;
  let entities=[{kind:'shooter',id:'s1',data:{id:'s1',naam:'Test Schutter'}},{kind:'meta',id:'currentTraining',data:{id:'training1',mode:'parcours',stage:'s1',startedAt:Date.now(),updatedAt:Date.now()}}];
  await page.route('**/functions/v1/**',async route=>{
    const b=route.request().postDataJSON();let r={ok:true},status=200;
    if(b.action==='list_shooters')r.shooters=[{id:'s1',naam:'Test Schutter',display_name:'Test Schutter',public_id:'EPP-1',club:'Club Noord'}];
    if(b.action==='list_matches'||b.action==='catalog')r.matches=[{id:'m1',organizer:'Testclub',match_date:'2099-01-02',offered_disciplines:['pistool'],scoring:true,can_score:true}];
    if(b.action==='context')r={ok:true,ranking:[],matchRanking:[]};
    if(b.action==='prepare_match')r.round={id:'round1'};
    if(b.action==='claim')r.lease={token:'test-lease',expiresAt:new Date(Date.now()+60000).toISOString()};
    if(b.action==='view')r={ok:true,scorers:[],accounts:[],audit:[],managing:false};
    if(b.action==='load')r.entities=entities;
    if(b.action==='save'){
      if(failTraining){r={ok:false,error:'tijdelijk_offline'};status=500;}
      else {for(const op of b.ops){entities=entities.filter(e=>e.kind!==op.kind||e.id!==op.id);if(op.value!==null)entities.push({kind:op.kind,id:op.id,data:op.value});}r.entities=entities;}
    }
    if(b.action==='get_result')r.result=revision?{revision,hits5:50,rapid_counts:{hits5:10},rapid_time_ms:12000,measured_total_time_ms:290000}:null;
    if(b.action==='match_participants')r={ok:true,planned:true,shooters:[{id:'s1',display_name:'Test Schutter',public_id:'EPP-1',club:'Club Noord'}]};
    if(b.action==='confirm_result'){saveCount++;if(failSave){r={ok:false,error:'tijdelijk_offline'};status=500;}}
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(r)});
  });
  const go=async()=>{await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(()=>{sessionStorage.setItem(EPP_SESSION_KEY,JSON.stringify({sessionToken:'a'.repeat(64),account:{id:'a1',username:'test',clubId:'svbb',displayName:'Test',role:'trainer',isAdmin:false}}));document.getElementById('loginGate').hidden=true;document.getElementById('root').hidden=false;window.testRoot=ReactDOM.createRoot(document.getElementById('root'));});};
  const training=async()=>page.evaluate(()=>{testRoot.render(h('div',{className:'app'},h('style',null,CSS),h(DraftScope.Provider,{value:'training:s1:parcours'},h(RoundInput,{maxV:250,onAdd:(score,details)=>window.savedRound={score,details}}))));});
  await go();await training();
  await page.getByRole('switch').check();
  await page.getByLabel('Snelvuur 5 punten',{exact:true}).fill('10');
  await page.getByLabel('Overige 5 punten',{exact:true}).fill('40');
  // Enter times through their visible labels.
  await page.getByText('Snelvuurtijd (seconden en honderdsten)',{exact:true}).locator('input').fill('12,40');
  await page.getByText('Eindtijd (minuten:seconden, inclusief snelvuur)',{exact:true}).locator('input').fill('4:53');
  await page.reload();await page.evaluate(()=>{document.getElementById('loginGate').hidden=true;document.getElementById('root').hidden=false;window.testRoot=ReactDOM.createRoot(document.getElementById('root'));});await training();
  assert.equal(await page.getByLabel('Snelvuur 5 punten',{exact:true}).inputValue(),'10');
  assert.equal(await page.getByLabel('Overige 5 punten',{exact:true}).inputValue(),'40');
  const dock=page.locator('.save-dock');assert.ok((await dock.boundingBox()).y<844);
  await page.getByRole('button',{name:'Ronde opslaan',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.savedRound)).score,250);
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('epp-draft')).length),0);
  console.log('PASS mobile training draft recovery and save');
  await page.evaluate(()=>{sessionStorage.setItem(EPP_SESSION_KEY,JSON.stringify({sessionToken:'a'.repeat(64),account:{id:'a1',clubId:'svbb',role:'schutter'}}));testRoot.render(h('div',{className:'app'},h('style',null,CSS),h(RankingTable,{items:Array.from({length:60},(_,i)=>({position:i+1,name:i===40?'José Test':'Schutter '+i,club:i%2?'Club Zuid':'Club Noord',score:250-i,publicId:'EPP-'+i,shooterId:i===40?'s1':'other'+i}))})));});
  await page.locator('.shooter-score-card').first().waitFor();assert.equal(await page.locator('.shooter-score-card').count(),25);
  await page.getByRole('button',{name:'Mijn positie',exact:true}).click();assert.equal(await page.locator('.shooter-score-card').count(),1);assert.equal(await page.locator('.pos').innerText(),'41');
  await page.getByRole('button',{name:'Alle posities',exact:true}).click();
  await page.getByLabel('Zoeken in uitslagen').fill('jose noord');assert.equal(await page.locator('.shooter-score-card').count(),1);
  assert.equal(await page.locator('.pos').innerText(),'41');
  console.log('PASS ranking filters, paging and own position');
  await page.evaluate(()=>{testRoot.render(h('div',{className:'app'},h('style',null,CSS),h(PersonalHome,{shooters:[{id:'s1',naam:'Test Schutter'}],currentTraining:{rounds:[{id:'one',sid:'s1',type:'parcours',score:215,ts:Date.now()}]},archives:[],personalTraining:true,canTrain:true,setTab:tab=>window.lastTab=tab})));});
  await page.getByText('Testclub',{exact:true}).waitFor();await page.getByText('Mijn trainingsvoortgang',{exact:true}).waitFor();
  await page.screenshot({path:'/private/tmp/epp-four-home-390.png',fullPage:true,animations:'disabled'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/private/tmp/epp-four-home-1440.png',fullPage:true,animations:'disabled'});
  console.log('PASS home progress and calendar at 390 and 1440');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{sessionStorage.setItem(EPP_SESSION_KEY,JSON.stringify({sessionToken:'a'.repeat(64),account:{id:'a1',clubId:'svbb',role:'trainer'}}));testRoot.render(h('div',{className:'app'},h('style',null,CSS),h(TabLandelijk,{isTrainer:true,flash:()=>{},shooters:[],eppPassword:'',setEppPassword:()=>{}})));});
  await page.getByLabel('Wedstrijd',{exact:true}).selectOption('m1');
  await page.getByLabel('Schutter zoeken').fill('Test');await page.getByRole('button',{name:/Test Schutter/}).click();
  await page.getByLabel('Snelvuur 5 punten',{exact:true}).fill('10');await page.getByLabel('Overige 5 punten',{exact:true}).fill('40');
  await page.getByText('Snelvuurtijd (seconden en honderdsten)',{exact:true}).locator('input').fill('12,40');await page.getByText('Eindtijd (minuten:seconden, inclusief snelvuur)',{exact:true}).locator('input').fill('4:53');
  failSave=true;await page.getByRole('button',{name:'Bevestigen en opslaan',exact:true}).click();await page.getByText(/Opslaan mislukt:/).waitFor();
  assert.equal(await page.getByLabel('Snelvuur 5 punten',{exact:true}).inputValue(),'10');
  await page.screenshot({path:'/private/tmp/epp-four-scores-390.png',fullPage:true,animations:'disabled'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Unmount and select again to exercise restoration after getting the latest server revision.
  await page.getByRole('button',{name:'Invoer annuleren',exact:true}).click();await page.getByLabel('Schutter zoeken').fill('Test');await page.getByRole('button',{name:/Test Schutter/}).click();
  await page.getByRole('button',{name:'Concept herstellen',exact:true}).click();assert.equal(await page.getByLabel('Snelvuur 5 punten',{exact:true}).inputValue(),'10');
  failSave=false;await page.getByRole('button',{name:'Bevestigen en opslaan',exact:true}).click();await page.getByText('Opgeslagen — klassement bijgewerkt',{exact:true}).waitFor();assert.equal(saveCount,2);
  console.log('PASS official failed save, draft recovery and successful retry');
  // A changed server revision must block restoration of an older concept.
  await page.getByLabel('Schutter zoeken').fill('Test');await page.getByRole('button',{name:/Test Schutter/}).click();
  await page.getByLabel('Snelvuur 5 punten',{exact:true}).fill('5');
  await page.getByRole('button',{name:'Invoer annuleren',exact:true}).click();revision=1;
  await page.getByLabel('Schutter zoeken').fill('Test');await page.getByRole('button',{name:/Test Schutter/}).click();
  await page.getByText(/Dit concept hoort bij een oudere score/).waitFor();assert.equal(await page.getByRole('button',{name:'Concept herstellen',exact:true}).isDisabled(),true);
  console.log('PASS concurrent score revision blocks stale recovery');
  // Exercise the real App and its persistent synchronisation queue.
  await page.evaluate(()=>testRoot.render(h(App)));
  await page.getByRole('heading',{name:'Welkom, schutter',exact:true}).waitFor();
  await page.screenshot({path:'/private/tmp/epp-four-app-home-390.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/private/tmp/epp-four-app-home-1440.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Score invoeren',exact:true}).click();
  await page.getByLabel('Rondescore').fill('210');failTraining=true;
  await page.getByRole('button',{name:'Ronde opslaan',exact:true}).click();
  await page.getByText(/Lokaal bewaard, nog niet online/).waitFor();
  assert.ok(await page.evaluate(()=>Object.entries(localStorage).some(([k,v])=>k.includes('records-v3')&&v.includes('210'))));
  await page.screenshot({path:'/private/tmp/epp-four-app-training-390.png',fullPage:true,animations:'disabled'});
  const savedDock=await page.locator('.save-dock').boundingBox();const nav=await page.locator('.bottomnav').boundingBox();assert.ok(savedDock.y+savedDock.height<=nav.y+2);
  failTraining=false;await page.getByRole('button',{name:'Opslag opnieuw proberen',exact:true}).click();
  await page.getByText('Online opgeslagen',{exact:true}).waitFor();
  assert.equal(entities.filter(e=>e.kind==='round').length,1);
  console.log('PASS real App queue preserves failed save and retries without duplicate round');
  assert.deepEqual(errors,[]);await page.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
