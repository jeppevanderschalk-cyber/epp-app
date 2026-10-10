import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname,path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.html'?'text/html':'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];let choices=[],revision=0;
    page.on('pageerror',e=>errors.push(e.message));
    const older={id:'older',organizer:'APGS',match_date:'2026-11-14',match_dates:['2026-11-14'],deadline:'2026-11-01',offered_disciplines:['pistool']};
    const planned={id:'new',organizer:'SVBB',match_date:'2027-05-28',match_dates:['2027-05-28','2027-05-29'],offered_disciplines:['pistool','optiek']};
    const slots=[{id:'a',starts_at:'2027-05-28T07:00:00Z',ends_at:'2027-05-28T07:07:00Z',capacity:2,booked:0},{id:'full',starts_at:'2027-05-28T07:10:00Z',ends_at:'2027-05-28T07:17:00Z',capacity:2,booked:2},{id:'b',starts_at:'2027-05-29T07:00:00Z',ends_at:'2027-05-29T07:07:00Z',capacity:2,booked:0}];
    await page.route('**/functions/v1/**',async route=>{
      const body=route.request().postDataJSON();let response={ok:true};
      if(body.action==='list_matches')response={ok:true,matches:[{...planned,planning_pending:true},older]};
      if(body.action==='catalog')response={ok:true,matches:[planned]};
      if(body.action==='list_shooters')response={ok:true,shooters:[{id:'member',naam:'Test Schutter'}]};
      if(body.action==='my_signups')response={ok:true,signups:[]};
      if(body.action==='book'){choices=body.choices;revision++;response={ok:true};}
      if(body.action==='view')response={ok:true,match:planned,planner:{published:true,opens_at:'2020-01-01T00:00:00Z',closes_at:'2027-05-27T18:00:00Z'},profile:{id:'member'},managing:false,slots,mine:{revision,choices},roster:[],audit:[]};
      await route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
    });
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.evaluate(()=>{localStorage.setItem(EPP_SESSION_KEY,JSON.stringify({account:{username:'lid.test',displayName:'Test Schutter'}}));window.pickerRoot=ReactDOM.createRoot(document.getElementById('root'));pickerRoot.render(h('div',{className:'app'},h('style',null,CSS),h('main',{className:'main'},h(TabInschrijvenLid,{password:'',onAuthFail:()=>{},flash:()=>{}}))));eppShowApp();});
    await page.getByText('Test Schutter',{exact:true}).waitFor();
    await page.getByRole('button',{name:'DOE MEE',exact:true}).nth(1).waitFor();
    assert.deepEqual(await page.locator('.match-org').allTextContents(),['APGS','SVBB']);
    assert.equal(await page.locator('.match-card').count(),2);
    assert.ok(await page.getByText('Test Schutter',{exact:true}).evaluate(el=>el.getBoundingClientRect().top<document.querySelector('.match-card').getBoundingClientRect().top));
    await page.locator('.match-card').filter({has:page.getByText('SVBB',{exact:true})}).getByRole('button',{name:'DOE MEE',exact:true}).click();
    const group=page.getByRole('radiogroup',{name:'Tijdslot pistool',exact:true});
    await group.waitFor();assert.equal(await group.locator('select').count(),0);
    assert.equal(await group.getByRole('radio',{name:'28 mei 2027 · 09:10 · Vol',exact:true}).isDisabled(),true);
    await group.getByRole('radio',{name:'28 mei 2027 · 09:00',exact:true}).click();
    await page.getByRole('group',{name:'Wedstrijddag pistool',exact:true}).getByRole('button',{name:'29 mei 2027',exact:true}).click();
    await group.getByRole('radio',{name:'29 mei 2027 · 09:00',exact:true}).click();
    await page.getByRole('button',{name:'Tijdsloten bevestigen',exact:true}).click();
    await page.getByText('Je gekozen tijdsloten zijn gereserveerd.',{exact:true}).waitFor();
    assert.deepEqual(choices,[{discipline:'pistool',slotId:'b'}]);
    assert.equal(await page.getByRole('radio',{name:'29 mei 2027 · 09:00',exact:true}).getAttribute('aria-checked'),'true');
    await page.screenshot({path:'/private/tmp/epp-slot-picker-'+width+'.png',fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
    await page.close();console.log('PASS '+width+': one sorted list below identity, Doe mee card, days, full-slot guard, reservation confirmed');
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
