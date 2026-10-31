import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.png':'image/png','.css':'text/css'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH}),errors=[];
const mid='22222222-2222-4222-8222-222222222222',oid='33333333-3333-4333-8333-333333333333';
const match={id:mid,club_id:'svbb',organizer:'EPP Betaaltest',match_date:'2036-11-14',offered_disciplines:['pistool','optiek'],mail_status:'niet_verstuurd',schutters:0,starts:0,payment_required:true};
const slots=[{id:'slot-a',starts_at:'2036-11-14T08:00:00Z',ends_at:'2036-11-14T08:15:00Z',capacity:2,booked:0},{id:'slot-b',starts_at:'2036-11-14T08:15:00Z',ends_at:'2036-11-14T08:30:00Z',capacity:2,booked:0}];
const planner={published:true,revision:1,opens_at:'2020-01-01T00:00:00Z',closes_at:'2036-11-13T23:00:00Z',config:{first:'09:00',last:'16:00',duration:15,changeover:0,capacity:2,gap:0,opens:'2020-01-01T00:00',closes:'2036-11-13T23:00',breaks:[],overrides:[],published:true}};
try{
  for(const width of [390,1440]){
    let order=null,confirmed=[],checkouts=0,legacyBooks=0,providerPaid=false;
    async function open(account){
      const context=await browser.newContext({viewport:{width,height:950}});
      await context.addInitScript(account=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1',account.clubId);localStorage.setItem('epp-app-role-v1',account.role);},account);
      await context.route('https://www.mollie.com/checkout/epp-fixture',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>Mollie testbetaling €24</h1>'}));
      await context.route('**/functions/v1/**',async route=>{
        const body=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let data={ok:true};
        if(fn==='epp-auth')data={ok:true,account,accounts:[],clubs:[]};
        if(fn==='epp-training')data={ok:true,entities:[],rows:[],backups:[]};
        if(fn==='epp-platform')data={ok:true,ranking:[],matchRanking:[],qualifications:[],matches:[],events:[]};
        if(fn==='epp-admin')data={ok:true,matches:[match]};
        if(fn==='epp-signup')data={ok:true,matches:[],shooters:[{id:'shooter-test',naam:'Test Schutter'}],signups:[]};
        if(fn==='epp-scoring')data={ok:true,matches:[]};
        if(fn==='epp-planner'){
          if(body.action==='catalog')data={ok:true,matches:[match]};
          if(body.action==='view')data={ok:true,match,planner,managing:account.isAdmin,profile:account.isAdmin?null:{id:'shooter-test'},slots,mine:{revision:confirmed.length?1:0,choices:confirmed,payment:order},roster:[],audit:[],paymentOrders:[]};
          if(body.action==='book'){legacyBooks++;throw Error('paid signup attempted legacy endpoint');}
        }
        if(fn==='epp-payments'){
          if(body.action==='settings')data={ok:true,configured:false,enabled:false,required:false,unitPriceCents:1200,account:null};
          if(body.action==='checkout'){
            checkouts++;assert.equal(body.choices.length,2);assert.deepEqual(body.choices.map(c=>c.discipline),['pistool','optiek']);assert.equal(body.choices[0].slotId,'slot-a');assert.equal(body.choices[1].slotId,'slot-b');assert.equal(body.amount,undefined);
            order={id:oid,status:'open',choices:body.choices,expectedRevision:0,amountCents:2400,checkoutUrl:'https://www.mollie.com/checkout/epp-fixture'};
            data={ok:true,order};
          }
          if(body.action==='status'){
            assert.equal(body.orderId,oid);
            if(providerPaid){order={...order,status:'paid',confirmedAt:new Date().toISOString()};confirmed=order.choices;}
            data={ok:true,order};
          }
        }
        await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      });
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(url);return {page,context};
    }
    const admin=await open({id:'admin',username:'beheer',role:'trainer',clubId:'svbb',displayName:'Beheer',isAdmin:true});
    await admin.page.getByRole('button',{name:'Wedstrijden',exact:true}).click();await admin.page.getByRole('button',{name:'Inschrijven',exact:true}).click();await admin.page.getByRole('button',{name:'Wedstrijdplanner',exact:true}).click();
    await admin.page.getByText('Inschrijfgeld en eigen betaalaccount',{exact:true}).click();
    await admin.page.getByText(/Voorbereid: Mollie Connect is nog niet aangesloten/).waitFor();
    assert.equal(await admin.page.getByRole('button',{name:'Eigen Mollie-account koppelen',exact:true}).isDisabled(),true);
    assert.equal(await admin.page.getByRole('button',{name:'Betaling verplicht maken',exact:true}).isDisabled(),true);
    await admin.page.screenshot({path:tmpdir()+'/epp-payments-admin-'+width+'.png',fullPage:true});await admin.context.close();
    const member=await open({id:'member',username:'lid.test',role:'schutter',clubId:'svbb',displayName:'Schutter',isAdmin:false});
    const page=member.page;
    await page.getByRole('button',{name:'Wedstrijden',exact:true}).click();await page.getByRole('button',{name:'Inschrijven',exact:true}).click();await page.getByRole('button',{name:'Doe mee',exact:true}).click();
    await page.getByRole('radiogroup',{name:'Tijdslot pistool',exact:true}).getByRole('radio',{name:/09:00$/,exact:false}).click();
    await page.getByRole('button',{name:/Betalen en inschrijven.*12,00/}).waitFor();
    await page.getByRole('radiogroup',{name:'Tijdslot optiek',exact:true}).getByRole('radio',{name:/09:15$/,exact:false}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:tmpdir()+'/epp-payments-checkout-'+width+'.png',fullPage:true});
    await page.getByRole('button',{name:/Betalen en inschrijven.*24,00/}).click();await page.getByRole('heading',{name:'Mollie testbetaling €24'}).waitFor();
    assert.equal(checkouts,1);assert.equal(legacyBooks,0);assert.equal(confirmed.length,0);
    // Returning alone cannot confirm: the provider is still open.
    await page.goto(url+'/?payment='+oid+'&match='+mid);
    await page.getByText(/Wacht op betaling.*24,00/).waitFor();assert.equal(confirmed.length,0);
    providerPaid=true;
    await page.getByRole('button',{name:'Betaalstatus controleren',exact:true}).click();
    await page.getByText(/Betaald en bevestigd.*24,00/).waitFor();assert.equal(confirmed.length,2);
    await page.screenshot({path:tmpdir()+'/epp-payments-confirmed-'+width+'.png',fullPage:true});await member.context.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS mobile and desktop: own-account setup gated, two disciplines, EUR12/EUR24, own timeslots, provider checkout, untrusted return and verified confirmation');
}finally{await browser.close();await new Promise(r=>server.close(r));}
