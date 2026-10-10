import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname,file=resolve(root,'.'+(p==='/'?'/index.html':p));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',extname(file)==='.html'?'text/html':extname(file)==='.js'?'text/javascript':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];let mode='ok',saved=false,configures=0,views=0,booked=[],bookings=0,lastBooking;
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/functions/v1/**',async route=>{
      const b=route.request().postDataJSON();
      if(b.action==='book'){bookings++;booked=b.choices;lastBooking=b;}
      if(b.action==='configure'){
        configures++;await new Promise(r=>setTimeout(r,200));
        if(mode==='error')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,error:'laatste_ronde_sluit_niet_aan'})});
        saved=true;
      }
      if(b.action==='view'){
        views++;
        if(saved&&mode==='refresh-error')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'server_fout'})});
      }
      const config={first:'09:00',last:'16:00',duration:7,changeover:3,capacity:2,gap:0,opens:'2026-01-01T09:00',closes:'2027-05-27T18:00',breaks:[],overrides:[],published:true};
      const view={ok:true,match:{id:'fixture',match_date:'2027-05-28',match_dates:['2027-05-28','2027-05-29'],offered_disciplines:['pistool']},planner:{revision:saved?2:1,config},managing:true,profile:{id:'member'},slots:Array.from({length:40},(_,i)=>({id:'slot-'+i,starts_at:new Date(Date.UTC(2027,4,28,7,i*10)).toISOString(),ends_at:new Date(Date.UTC(2027,4,28,7,i*10+7)).toISOString(),capacity:2,booked:0})),mine:{revision:bookings,choices:booked},roster:[],audit:[]};
      view.match={...view.match,organizer:'SVBB',schutters:1,starts:1,mail_status:'niet_verstuurd'};
      view.roster=booked.length?[{shooterId:'member',name:'Test Schutter',publicId:'EPP-TEST',clubs:['SVBB'],revision:bookings,choices:booked}]:[];
      const response=b.action==='list_matches'||b.action==='catalog'?{ok:true,matches:[view.match]}:b.action==='group_list'?{ok:true,match:view.match,signups:[{id:'signup',shooter_id:'member',shooter_name:'Test Schutter',epp_signup_disciplines:[]}]}:view;
      await route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
    });
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.evaluate(()=>{window.feedbackRoot=ReactDOM.createRoot(document.getElementById('root'));window.feedbackRoot.render(h('div',{className:'app'},h('style',null,CSS),h('main',{className:'main'},h(MatchPlanner,{matchId:'fixture',manage:true}))));eppShowApp();});
    for(const [label,value] of [['Rondeduur (minuten)','7'],['Wisseltijd (minuten)','3'],['Schietplaatsen per ronde','2'],['Minimale pauze tussen deelnames (minuten)','0']]){
      const input=page.getByLabel(label,{exact:true});
      await input.fill('');
      assert.equal(await input.inputValue(),'','number input stays empty after clearing');
      assert.equal(await input.evaluate(el=>el.validity.valueMissing),true,'empty required number cannot be saved');
      await input.fill(value);
      assert.equal(await input.inputValue(),value,'replacement has no leading zero');
    }
    await page.getByRole('button',{name:'+ Afwijkende capaciteit',exact:true}).click();
    const override=page.getByLabel('Schietplaatsen',{exact:true});
    await override.fill('');assert.equal(await override.inputValue(),'');
    await override.fill('2');
    await page.getByRole('button',{name:'Verwijder overrides 1',exact:true}).click();
    await page.getByLabel('Laatste ronde start uiterlijk',{exact:true}).fill('16:05');
    await page.getByText('Laatste ronde: 16:00 – 16:07',{exact:true}).waitFor();
    await page.getByLabel('Onze vereniging organiseert deze wedstrijd').check();
    await page.getByRole('button',{name:'Planning opslaan',exact:true}).click();
    await page.getByText('Planning online opgeslagen.',{exact:true}).waitFor();
    const count=configures;await page.waitForTimeout(10500);assert.equal(configures,count);assert.ok(views>=3);
    await page.getByText('Planning online opgeslagen.',{exact:true}).scrollIntoViewIfNeeded();
    const position=await page.getByText('Planning online opgeslagen.',{exact:true}).evaluate(el=>el.getBoundingClientRect().top-el.previousElementSibling.querySelector('button[type="submit"]').getBoundingClientRect().bottom);assert.ok(position>=0&&position<30);
    await page.screenshot({path:'/private/tmp/epp-planner-feedback-'+width+'.png'});
    assert.equal(await page.getByRole('button',{name:'Tijdsloten bevestigen',exact:true}).isDisabled(),true);
    await page.getByText('Nog geen tijdslot gekozen.',{exact:true}).waitFor();assert.equal(bookings,0);
    assert.equal(await page.locator('details').filter({has:page.getByText('Alle tijdsloten (40)',{exact:true})}).getAttribute('open'),null);
    await page.getByRole('radiogroup',{name:'Tijdslot pistool',exact:true}).getByRole('radio',{name:'28 mei 2027 · 09:10',exact:true}).click();
    await page.getByRole('button',{name:'Tijdsloten bevestigen',exact:true}).click();
    await page.getByText('Boeking online bevestigd',{exact:true}).waitFor();assert.equal(bookings,1);
    await page.waitForTimeout(10500);await page.getByText('Boeking online bevestigd',{exact:true}).waitFor();
    await page.getByText('Jouw inschrijving',{exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:'/private/tmp/epp-booking-feedback-'+width+'.png'});
    await page.getByLabel('Rondeduur (minuten)',{exact:true}).fill('8');assert.equal(await page.getByText('Planning online opgeslagen.',{exact:true}).count(),0);
    mode='error';await page.getByLabel('Onze vereniging organiseert deze wedstrijd').check();await page.getByRole('button',{name:'Planning opslaan',exact:true}).click();
    await page.getByText('De laatste starttijd sluit niet aan op de rondeduur en wisseltijd.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Rondeduur (minuten)',{exact:true}).inputValue(),'8');
    mode='refresh-error';await page.getByRole('button',{name:'Planning opslaan',exact:true}).click();
    await page.getByText('Planning online opgeslagen. De tijdsloten konden niet worden vernieuwd; probeer de planning opnieuw te laden.',{exact:true}).waitFor();
    mode='ok';
    await page.evaluate(()=>{localStorage.setItem(EPP_SESSION_KEY,JSON.stringify({account:{isAdmin:true}}));feedbackRoot.render(h('div',{className:'app'},h('style',null,CSS),h('main',{className:'main'},h(TabInschrijvenTrainer,{password:'',flash:()=>{},onAuthFail:()=>{}}))));});
    await page.getByRole('button',{name:'Groepslijst',exact:true}).click();
    await page.getByText('Test Schutter',{exact:true}).waitFor();
    assert.equal(await page.getByText('Mail naar inschrijfbureau',{exact:true}).count(),0);
    assert.equal(await page.locator('a[href^="mailto:"]').count(),0);
    await page.getByRole('button',{name:'Planning en deelnemers beheren',exact:true}).click();
    await page.getByRole('button',{name:'Verplaatsen / afmelden',exact:true}).click();
    await page.getByText('Inschrijving wijzigen: Test Schutter',{exact:true}).waitFor();
    await page.getByRole('radiogroup',{name:'Tijdslot pistool',exact:true}).getByRole('radio',{name:'28 mei 2027 · 09:20',exact:true}).click();
    await page.getByLabel('Reden wijziging').fill('Op verzoek deelnemer');
    await page.getByRole('button',{name:'Wijzig tijdslot',exact:true}).click();
    await page.getByText('Boeking online bevestigd',{exact:true}).waitFor();
    assert.equal(lastBooking.shooterId,'member');assert.equal(lastBooking.reason,'Op verzoek deelnemer');assert.equal(booked[0].slotId,'slot-2');
    await page.screenshot({path:'/private/tmp/epp-online-signup-admin-'+width+'.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.close();
    console.log('PASS '+width+': adjacent confirmation survives remount/poll, edits clear success, errors retain input, refresh failure is distinguished');
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
