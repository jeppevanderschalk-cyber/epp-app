import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/functions/v1/**',route=>{requests.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})});});
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.evaluate(()=>{
      document.getElementById('loginGate').hidden=true;document.getElementById('root').hidden=false;
      window.testRoot=ReactDOM.createRoot(document.getElementById('root'));
      window.showTest=child=>window.testRoot.render(h('div',{className:'app'},h('style',null,CSS),h('main',{className:'main'},child)));
      window.showTest(h(EppMatchForm,{onSave:f=>window.savedMatch=f,onCancel:()=>{}}));
    });
    await page.getByPlaceholder('Organiserende vereniging').fill('SVBB');
    await page.getByLabel('Wedstrijddag 1',{exact:true}).fill('2027-05-28');
    await page.getByRole('button',{name:'+ Wedstrijddag',exact:true}).click();
    await page.getByLabel('Wedstrijddag 2',{exact:true}).fill('2027-05-28');
    await page.getByRole('button',{name:'Opslaan',exact:true}).click();
    await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.savedMatch),undefined);
    await page.getByLabel('Wedstrijddag 2',{exact:true}).fill('2027-05-29');
    await page.getByRole('button',{name:'Opslaan',exact:true}).click();
    const saved=await page.evaluate(()=>window.savedMatch);
    assert.deepEqual(saved.match_dates,['2027-05-28','2027-05-29']);assert.equal(saved.match_date,'2027-05-28');assert.equal(saved.deadline,'2027-04-28');
    assert.equal(await page.evaluate(()=>eppOneMonthBefore('2027-03-31')),'2027-02-28');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.waitForTimeout(600);await page.screenshot({path:'/private/tmp/epp-multiday-form-'+width+'.png',fullPage:true});
    await page.evaluate(()=>{
      window.multiView={match:{id:'multi',organizer:'SVBB',match_date:'2027-05-28',match_dates:['2027-05-28','2027-05-29'],offered_disciplines:['pistool','optiek']},managing:false,profile:{id:'member'},planner:{published:true,opens_at:'2020-01-01T00:00:00Z',closes_at:'2027-05-27T00:00:00Z'},mine:{revision:0,choices:[]},slots:[{id:'day1',starts_at:'2027-05-28T07:00:00Z',ends_at:'2027-05-28T07:30:00Z',capacity:4,booked:0},{id:'day2',starts_at:'2027-05-29T07:00:00Z',ends_at:'2027-05-29T07:30:00Z',capacity:4,booked:0}]};
      window.showTest(h(PlannerBooking,{view:window.multiView,onSaved:()=>{},onReload:()=>{}}));
    });
    await page.getByLabel('Tijdslot pistool').waitFor();
    const labels=await page.getByLabel('Tijdslot pistool').locator('option').allTextContents();
    assert.match(labels[1],/28 mei 2027.*09:00/);assert.match(labels[2],/29 mei 2027.*09:00/);
    await page.getByLabel('Tijdslot pistool').selectOption('day2');
    await page.getByRole('button',{name:'Tijdsloten bevestigen',exact:true}).click();
    await page.getByText('Boeking online bevestigd',{exact:true}).waitFor();
    assert.deepEqual(requests.at(-1).choices,[{discipline:'pistool',slotId:'day2'}]);
    await page.waitForTimeout(600);await page.screenshot({path:'/private/tmp/epp-multiday-booking-'+width+'.png',fullPage:true});
    await page.evaluate(()=>{window.multiView.managing=true;window.multiView.planner=null;window.showTest(h(PlannerEditor,{view:window.multiView,onSaved:()=>{},onReload:()=>{}}));});
    await page.getByText('28 mei 2027 / 29 mei 2027',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);await page.close();console.log('PASS multiday '+width+': add dates, reject duplicate, second-day booking, no overflow');
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
