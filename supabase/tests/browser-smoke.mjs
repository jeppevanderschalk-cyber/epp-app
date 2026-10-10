import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/epp-audit-tools/node_modules/playwright/index.mjs');
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{
  try{
    const path=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));
    if(!path.startsWith(root+'/'))throw new Error('invalid path');
    const bytes=await readFile(path);
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.png':'image/png','.json':'application/json'})[extname(path)]||'application/octet-stream');
    res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/index.html';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const entities=new Map();
const put=(kind,id,data)=>entities.set(kind+'|'+id,{kind,id,data});
put('shooter','00000000-0000-4000-8000-000000000001',{id:'00000000-0000-4000-8000-000000000001',naam:'Test Schutter'});
put('meta','currentTraining',{id:'test-training',mode:'parcours',stage:'s1',startedAt:1});
put('meta','stageShots',{s1:10,s2:5,s3:5,s4:10,s5:5,s6:5,s7:10});
put('parcoursBest','00000000-0000-4000-8000-000000000001',{score:240});
let failSave=false;
const errors=[];
let confirmed=null;
const qualifications=new Map();
const account={id:'test-account',username:'testtrainer',displayName:'Test Trainer',role:'trainer',clubId:'svbb',isAdmin:true};
try{
  for(const viewport of [{width:390,height:844},{width:1440,height:1000}]){
    const context=await browser.newContext({viewport});
    await context.addInitScript(({account})=>{
      localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));
      localStorage.setItem('epp-app-club-v1','svbb');
      localStorage.setItem('epp-app-role-v1','trainer');
    },{account});
    await context.route('https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/**',async route=>{
      const body=route.request().postDataJSON();
      const fn=route.request().url().split('/').pop();
      let response={ok:true},status=200;
      if(fn==='epp-auth')response={ok:true,account,accounts:[]};
      if(fn==='epp-platform'){
        response={ok:true,ranking:[],shooters:[{id:'00000000-0000-4000-8000-000000000001',display_name:'Test Schutter',public_id:'EPP-TEST'}],events:[],matches:[{id:'match-a',organizer:'Wedstrijd A',match_date:'2026-11-14'},{id:'match-b',organizer:'Wedstrijd B',match_date:'2026-12-14'}]};
        if(body.action==='prepare_match'){
          await new Promise(r=>setTimeout(r,body.matchId==='match-a'?300:30));
          response={ok:true,round:{id:'round-'+body.matchId}};
        }
        if(body.action==='get_result')response={ok:true,result:body.roundId==='round-match-a'?{revision:2,hits5:40,hits4:10,hits3:0,hits2:0,misses:0,penalty_points:0}:null};
        if(body.action==='confirm_result'){confirmed=body;response={ok:true,ranking:[]};}
        const qualificationKey=[body.shooterId,body.discipline,body.year].join('|');
        if(body.action==='get_qualification')response={ok:true,qualification:qualifications.get(qualificationKey)||null};
        if(body.action==='set_qualification'){
          const previous=qualifications.get(qualificationKey);
          assert.equal(body.expectedRevision,previous?.revision||0);
          const qualification={shooter_id:body.shooterId,title:body.title,qualification_year:body.year,source:body.source,average_score:body.average,revision:(previous?.revision||0)+1,active:!!body.title};
          qualifications.set(qualificationKey,qualification);response={ok:true,qualification};
        }
        if(body.action==='context'){
          const qualification=[...qualifications.entries()].find(([key])=>key.includes('|'+body.discipline+'|'))?.[1];
          if(qualification){const items=[{position:1,publicId:'EPP-TEST',name:'Test Schutter',club:'SVBB',score:240,hits5:40,rapidScore:48,rapidTimeMs:12400,totalTimeMs:280000,qualification}];response={...response,ranking:items,matchRanking:items};}
        }
        if(body.action==='list_qualifications')response={ok:true,qualifications:[...qualifications.entries()].filter(([key])=>key.includes('|'+body.discipline+'|')).map(([,q])=>q)};
      }
      if(fn==='epp-training'){
        if(body.action==='save'){
          await new Promise(r=>setTimeout(r,250));
          if(failSave){response={ok:false,error:'test_netwerkfout'};status=503;}
          else{
            const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
            if(body.ops.some(op=>{const now=entities.get(op.kind+'|'+op.id)?.data;return !same(now,op.expected)&&!same(now,op.value);})){response={ok:false,error:'opslag_conflict'};status=409;}
            else for(const op of body.ops)put(op.kind,op.id,op.value);
          }
        }
        if(status===200)response={ok:true,entities:[...entities.values()]};
      }
      await route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(response)});
    });
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);
    await page.getByText('Volledig Parcours',{exact:true}).waitFor();
    const score=page.getByPlaceholder('0',{exact:true}).first();
    await score.fill('210');
    await score.press('Enter');
    await page.getByRole('status').filter({hasText:'Online opgeslagen'}).waitFor({timeout:15000});
    assert([...entities.values()].some(e=>e.kind==='round'&&e.data?.score===210));
    await page.getByLabel('Kaarttelling en tijden',{exact:true}).check();
    await page.locator('fieldset').filter({hasText:'Snelvuur 7 m'}).getByRole('spinbutton').first().fill('10');
    await page.locator('fieldset').filter({hasText:'Overige parcours'}).getByRole('spinbutton').first().fill('40');
    await page.getByLabel('Snelvuurtijd (seconden)',{exact:true}).fill('12.40');
    await page.getByLabel('Totale parcoursduur (seconden)',{exact:true}).fill('280');
    await page.getByRole('button',{name:'Ronde opslaan',exact:true}).click();
    await page.waitForTimeout(1500);
    await page.getByRole('status').filter({hasText:'Online opgeslagen'}).waitFor({timeout:15000});
    assert([...entities.values()].some(e=>e.kind==='round'&&e.data?.score===250&&e.data?.rapid_score===50&&e.data?.total_time_ms===280000));
    await page.getByRole('button',{name:'Training',exact:true}).click();
    await page.getByText('Huidige training',{exact:true}).waitFor();
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'/private/tmp/epp-audit-'+viewport.width+'.png',fullPage:true});
    await page.getByRole('button',{name:'Parcours',exact:true}).click();
    failSave=true;
    await score.fill('220');await score.press('Enter');
    await page.getByRole('status').filter({hasText:'nog niet online'}).waitFor({timeout:15000});
    assert(await page.evaluate(()=>JSON.parse(localStorage.getItem('epp-data-svbb-registration-v1-records-v3')).wanted.currentTraining.rounds.some(r=>r.score===220)));
    await page.reload();
    await page.getByText('Volledig Parcours',{exact:true}).waitFor();
    assert((await page.locator('body').innerText()).includes('220'));
    failSave=false;
    await page.getByRole('button',{name:'Meer',exact:true}).click();
    await page.getByRole('button',{name:'Nu synchroniseren',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Online opgeslagen'}).first().waitFor({timeout:15000});
    await page.getByRole('button',{name:'Landelijk',exact:true}).click();
    const match=page.getByLabel('Wedstrijd',{exact:true});
    await match.selectOption('match-a');await match.selectOption('match-b');
    await page.getByLabel('Schutter zoeken').fill('Test Schutter');
    await page.getByRole('button',{name:/Test Schutter.*EPP-TEST/}).click();
    await page.waitForTimeout(500);
    assert.equal(await page.getByLabel('Ronde',{exact:true}).count(),0);
    assert.equal(await page.getByText('Rondenummer',{exact:true}).count(),0);
    await page.getByLabel('Snelvuur 5 punten',{exact:true}).fill('10');
    await page.getByLabel('Overige 5 punten',{exact:true}).fill('40');
    await page.getByLabel('Snelvuurtijd (seconden)',{exact:true}).fill('12,40');
    await page.getByLabel('Totale parcoursduur (seconden, inclusief snelvuur)',{exact:true}).fill('280');
    await page.getByRole('button',{name:'Bevestigen en opslaan',exact:true}).click();
    await page.getByText('Landelijke score opgeslagen',{exact:true}).waitFor();
    assert.equal(confirmed.roundId,'round-match-b');assert.equal(confirmed.hits5,50);assert.equal(confirmed.rapid.hits5,10);assert.equal(confirmed.rapidTimeMs,12400);assert.equal(confirmed.totalTimeMs,280000);
    await match.selectOption('match-a');
    await page.getByLabel('Schutter zoeken').fill('Test Schutter');
    await page.getByRole('button',{name:/Test Schutter.*EPP-TEST/}).click();
    await page.getByText('Reden van correctie',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Overige 5 punten',{exact:true}).inputValue(),'40');
    assert.equal(await page.getByLabel('Snelvuurtijd (seconden)',{exact:true}).inputValue(),'');
    await page.getByText('Officiële kwalificatie',{exact:true}).click();
    await page.getByLabel('Kwalificatie',{exact:true}).selectOption('Master');
    await page.getByLabel('Officieel gemiddelde (optioneel)',{exact:true}).fill('227');
    await page.getByLabel('Bron officiële onderscheiding',{exact:true}).fill('Officiële uitslag 2025');
    await page.getByLabel('Officiële onderscheiding gecontroleerd',{exact:true}).check();
    assert(await page.getByRole('button',{name:'Kwalificatie opslaan',exact:true}).isDisabled());
    await page.getByLabel('Officieel gemiddelde (optioneel)',{exact:true}).fill('228');
    await page.getByRole('button',{name:'Kwalificatie opslaan',exact:true}).click();
    await page.getByText('Kwalificatie opgeslagen',{exact:true}).waitFor();
    await page.getByText('Master · '+(new Date().getFullYear()-1),{exact:true}).first().waitFor();
    await page.screenshot({path:'/private/tmp/epp-national-'+viewport.width+'.png',fullPage:true});
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:'/private/tmp/epp-national-viewport-'+viewport.width+'.png'});
    await page.getByLabel('Discipline',{exact:true}).selectOption('optiek');
    await page.waitForTimeout(500);
    assert((await page.locator('body').innerText()).includes('Open is niet aangeboden bij deze wedstrijd.'));
    assert(await page.getByRole('button',{name:'Bevestigen en opslaan',exact:true}).isDisabled());
    await page.getByRole('button',{name:'Stand',exact:true}).click();
    await page.getByText('Master · '+(new Date().getFullYear()-1),{exact:true}).first().waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'/private/tmp/epp-qualification-stand-'+viewport.width+'.png'});
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS mobile/desktop, offline retry, competition selection, stale responses, score correction, qualification validation and badges in official/training standings');
}finally{await browser.close();await new Promise(r=>server.close(r));}
