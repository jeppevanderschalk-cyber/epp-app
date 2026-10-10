import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',extname(p)==='.js'?'text/javascript':extname(p)==='.html'?'text/html':'application/octet-stream');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
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
        if(fn==='epp-signup')r={ok:true,matches:[],shooters:[{id:'shooter-test',naam:'Test Schutter'}],signups:[]};
        if(fn==='epp-planner'){
          if(b.action==='catalog')r={ok:true,matches:planner?.published?[match]:[]};
          if(b.action==='configure'){configuration=b;planner={config:b.config,revision:1,published:b.config.published,opens_at:'2020-01-01T00:00:00Z',closes_at:'2030-11-13T00:00:00Z'};r={ok:true,planner};}
          if(b.action==='book'){
            assert.equal(b.expectedRevision,bookingRevision);
            if(rejectBooking){r={ok:false,error:'tijdslot_vol'};}else{booked=b.choices;bookingRevision++;r={ok:true,revision:bookingRevision};}
          }
          if(b.action==='view')r={ok:true,match,planner,managing:account.isAdmin,profile:account.isAdmin?null:{id:'shooter-test',display_name:'Test Schutter'},slots:planner?slots:[],mine:{revision:bookingRevision,choices:booked},roster:[],audit:[]};
        }
        await route.fulfill({status:r.ok?200:400,contentType:'application/json',body:JSON.stringify(r)});
      });
      const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);return {c,p};
    }
    const admin={id:'admin-test',username:'beheer',displayName:'Beheer',role:'trainer',clubId:'svbb',isAdmin:true};
    let {c,p}=await open(admin);
    await p.getByRole('button',{name:'Meer',exact:true}).click();
    await p.getByRole('button',{name:'Inschrijven voor wedstrijden',exact:true}).click();
    await p.getByRole('button',{name:'Wedstrijdplanner',exact:true}).click();
    await p.getByLabel('Eerste ronde start',{exact:true}).fill('09:00');
    await p.getByLabel('Laatste ronde start',{exact:true}).fill('16:00');
    await p.getByLabel('Rondeduur (minuten)',{exact:true}).fill('30');
    await p.getByLabel('Schietplaatsen per ronde',{exact:true}).fill('2');
    await p.getByLabel('Planner publiceren',{exact:true}).check();
    await p.getByLabel('Onze vereniging organiseert deze wedstrijd',{exact:true}).check();
    await p.getByRole('button',{name:'+ Pauze',exact:true}).click();
    await p.getByRole('button',{name:'Planning opslaan',exact:true}).click();
    await p.getByText('Online opgeslagen',{exact:true}).waitFor();
    assert.equal(configuration.config.capacity,2);assert.equal(configuration.config.breaks.length,1);assert.equal(configuration.expectedRevision,0);
    await p.waitForTimeout(700);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:'/private/tmp/epp-planner-admin-'+width+'.png',fullPage:true});
    await p.getByRole('button',{name:'Landelijk',exact:true}).click();
    await p.getByLabel('Wedstrijd',{exact:true}).selectOption('match-test');
    await p.getByText('Ingeschreven deelnemers · Pistool',{exact:true}).waitFor();
    await p.getByLabel('Schutter zoeken',{exact:true}).fill('Niet ingeschreven');
    assert.equal(await p.getByRole('button',{name:/Nieuwe schutter/}).count(),0);
    await p.getByLabel('Schutter zoeken',{exact:true}).fill('Test Schutter');
    await p.getByRole('button',{name:/Test Schutter.*EPP-PLANNER/}).click();
    await p.getByText(/Geselecteerd: Test Schutter/).waitFor();await c.close();
    ({c,p}=await open({id:'member-test',username:'lid.test',displayName:'Test Schutter',role:'schutter',clubId:'svbb',isAdmin:false}));
    await p.getByRole('button',{name:'Meer',exact:true}).click();
    await p.getByRole('button',{name:'Inschrijven voor wedstrijden',exact:true}).click();
    await p.locator('summary').filter({hasText:'Planner Test'}).click();
    await p.getByLabel('Tijdslot pistool',{exact:true}).selectOption('slot-a');
    await p.getByLabel('Tijdslot optiek',{exact:true}).selectOption('slot-b');
    rejectBooking=true;
    await p.getByRole('button',{name:'Tijdsloten bevestigen',exact:true}).click();
    await p.getByText('Dit tijdslot is net volgeboekt. Kies een andere tijd.',{exact:true}).waitFor();
    assert.equal(await p.getByLabel('Tijdslot pistool',{exact:true}).inputValue(),'slot-a');assert.equal(booked.length,0);
    rejectBooking=false;await p.getByRole('button',{name:'Tijdsloten bevestigen',exact:true}).click();
    await p.getByText('Online opgeslagen',{exact:true}).waitFor();assert.equal(booked.length,2);
    await p.waitForTimeout(700);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await p.screenshot({path:'/private/tmp/epp-planner-member-'+width+'.png',fullPage:true});
    p.once('dialog',d=>d.accept());await p.getByRole('button',{name:'Afmelden',exact:true}).click();await p.getByText('Online opgeslagen',{exact:true}).waitFor();assert.equal(booked.length,0);
    await c.close();
    ({c,p}=await open({id:'head-test',username:'hoofdbeheer',displayName:'Hoofdbeheer',role:'trainer',clubId:'eppnationaal',isAdmin:true,isPlatformAdmin:true,mustChangePassword:true}));
    await p.getByText('Vervang je tijdelijke wachtwoord',{exact:true}).waitFor();
    assert.equal(await p.getByRole('button',{name:'Meer',exact:true}).count(),0);
    assert.equal(await p.getByLabel('Nieuw wachtwoord (minimaal 10 tekens)',{exact:true}).count(),1);
    await c.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS planner setup, pause, mobile/desktop layout, self-booking, full-slot retry, cancellation');
}finally{await browser.close();await new Promise(r=>server.close(r));}
