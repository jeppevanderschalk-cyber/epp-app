import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',extname(p)==='.css'?'text/css':extname(p)==='.js'?'text/javascript':extname(p)==='.html'?'text/html':'application/octet-stream');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const url='http://127.0.0.1:'+server.address().port;
const errors=[];
const match={id:'match-test',club_id:'svbb',organizer:'Planner Test',match_date:'2030-11-14',deadline:'2030-11-13',offered_disciplines:['pistool','optiek'],mail_status:'niet_verstuurd',schutters:0,starts:0};
try{
  for(const width of [390,1440]){
    let planner=null,booked=[],bookingRevision=0,configuration=null,rejectBooking=false;
    const slots=[{id:'slot-a',starts_at:'2030-11-14T08:00:00Z',ends_at:'2030-11-14T08:30:00Z',capacity:2,booked:0},{id:'slot-b',starts_at:'2030-11-14T08:30:00Z',ends_at:'2030-11-14T09:00:00Z',capacity:2,booked:0}];
    async function open(account){
      const c=await browser.newContext({viewport:{width,height:900}});
      await c.addInitScript(account=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1',account.clubId);localStorage.setItem('epp-app-role-v1',account.role);},account);
      await c.route('**/functions/v1/**',async route=>{
        const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let r={ok:true};
        if(fn==='epp-auth')r={ok:true,account,accounts:[],clubs:[]};
        if(fn==='epp-training')r={ok:true,rows:[],backups:[]};
        if(fn==='epp-platform'){
          r={ok:true,shooters:[],ranking:[],qualifications:[],events:[],matches:[match]};
          if(b.action==='match_participants')r={ok:true,planned:true,shooters:[{id:'shooter-test',display_name:'Test Schutter',public_id:'EPP-PLANNER',club:'Andere Vereniging'}]};
          if(b.action==='prepare_match')r={ok:true,round:{id:'round-test'}};
          if(b.action==='get_result')r={ok:true,result:null};
        }
        if(fn==='epp-admin')r={ok:true,matches:[match]};
        if(fn==='epp-scoring'&&b.action==='catalog')r={ok:true,matches:[match]};
        if(fn==='epp-signup')r={ok:true,matches:[],shooters:[{id:'shooter-test',naam:'Test Schutter'}],signups:[]};
        if(fn==='epp-planner'){
          if(b.action==='catalog')r={ok:true,matches:planner?.published?[match]:[]};
          if(b.action==='configure'){configuration=b;planner={config:b.config,revision:1,published:b.config.published,opens_at:'2020-01-01T00:00:00Z',closes_at:'2030-11-13T00:00:00Z'};r={ok:true,planner};}
          if(b.action==='book'){
            assert.equal(b.shooterId,'shooter-test');assert.equal(b.reason,'Inschrijving door verenigingsbeheerder');
            assert.equal(b.expectedRevision,bookingRevision);
            if(rejectBooking){r={ok:false,error:'tijdslot_vol'};}else{booked=b.choices;bookingRevision++;r={ok:true,revision:bookingRevision};}
          }
          if(b.action==='view')r={ok:true,match,planner,managing:account.isAdmin,profile:account.isAdmin?null:{id:'shooter-test',display_name:'Test Schutter'},slots:planner?slots:[],mine:{revision:0,choices:[]},clubShooters:[{shooterId:'shooter-test',name:'Test Schutter',publicId:'EPP-TEST',revision:bookingRevision,choices:booked}],roster:[],audit:[]};
        }
        await route.fulfill({status:r.ok?200:400,contentType:'application/json',body:JSON.stringify(r)});
      });
      const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);return {c,p};
    }
    const admin={id:'admin-test',username:'beheer',displayName:'Beheer',role:'trainer',clubId:'svbb',isAdmin:true};
    let {c,p}=await open(admin);
    await p.getByRole('button',{name:'Wedstrijden',exact:true}).click();
    await p.getByRole('button',{name:'Inschrijven',exact:true}).click();
    await p.getByRole('button',{name:'Wedstrijdplanner',exact:true}).click();
    await p.getByLabel('Eerste ronde start',{exact:true}).fill('09:00');
    await p.getByLabel('Laatste ronde start uiterlijk',{exact:true}).fill('16:00');
    await p.getByLabel('Rondeduur (minuten)',{exact:true}).fill('30');
    await p.getByLabel('Schietplaatsen per ronde',{exact:true}).fill('2');
    await p.getByLabel('Planner publiceren',{exact:true}).check();
    await p.getByLabel('Onze vereniging organiseert deze wedstrijd',{exact:true}).check();
    await p.getByText('Pauzes en uitzonderingen',{exact:true}).click();
    await p.getByRole('button',{name:'+ Pauze',exact:true}).click();
    await p.getByRole('button',{name:'Planning opslaan',exact:true}).click();
    await p.getByText('Online opgeslagen',{exact:true}).waitFor();
    assert.equal(configuration.config.capacity,2);assert.equal(configuration.config.breaks.length,1);assert.equal(configuration.expectedRevision,0);
    await p.waitForTimeout(700);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);

    await p.getByLabel('Schutter van je vereniging',{exact:true}).selectOption('shooter-test');
    await p.getByRole('heading',{name:'Schutter inschrijven: Test Schutter',exact:true}).waitFor();
    await p.getByLabel('Reden wijziging',{exact:true}).fill('Inschrijving door verenigingsbeheerder');
    await p.getByRole('radio').first().click();
    await p.getByRole('button',{name:'Tijdsloten bevestigen',exact:true}).click();
    await p.getByText('Boeking online bevestigd',{exact:true}).waitFor();
    assert.equal(bookingRevision,1);assert.equal(booked.length,1);
    await c.close();
  }
  assert.deepEqual(errors,[]);console.log('Club admin can register a selected shooter at 390 and 1440px');
}finally{await browser.close();await new Promise(r=>server.close(r));}
