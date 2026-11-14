import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {tmpdir} from 'node:os';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const file=resolve(root,'.'+(new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html')));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.ttf':'font/ttf','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const match={id:'pdf-test',club_id:'svbb',organizer:'SV Test - wedstrijdplanning',location:'Baan Noord',match_date:'2030-11-14',match_dates:['2030-11-14','2030-11-15'],deadline:'2030-11-13',offered_disciplines:['pistool','optiek']};
const slots=Array.from({length:31},(_,i)=>{const t=Date.UTC(2030,10,i<28?14:15,8,(i<28?i:i-28)*15);return {id:'slot-'+i,starts_at:new Date(t).toISOString(),ends_at:new Date(t+15*60000).toISOString(),capacity:5,booked:i<12?5:0,blocked:i===15};});
const roster=Array.from({length:60},(_,i)=>({shooterId:'s'+i,name:i===0?'Verouderde Schutter':i===1?'Zoë Núñez de Vries':i===2?'Anne-Marie '+('Langenaam'.repeat(16)):'Schutter '+i,publicId:'EPP-PDF-'+String(i).padStart(3,'0'),clubs:[i===2?'Schietvereniging met een lange verenigingsnaam voor de controle van regelafbreking':'SV Noord'],choices:[{discipline:i%2?'optiek':'pistool',slotId:'slot-'+Math.floor(i/5)}]}));
roster.push({shooterId:'unplanned',name:'Nog Inplannen',clubs:['SV Zuid'],publicId:'EPP-UNPLANNED',choices:[{discipline:'pistool',slotId:null}],preferences:[{discipline:'pistool',time_block:'middag'}]});
const planner={revision:1,published:true,opens_at:'2020-01-01T00:00:00Z',closes_at:'2030-11-13T00:00:00Z',config:{first:'09:00',last:'15:45',duration:15,changeover:0,capacity:5,gap:0,opens:'2020-01-01T00:00:00Z',closes:'2030-11-13T00:00:00Z',breaks:[],overrides:[],published:true}};
try{
 for(const width of [390,1440]){
  const account={id:'owner',username:'beheer',displayName:'Beheer',role:'trainer',clubId:'svbb',isAdmin:true};let fresh=false,fail=false;
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(account=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1','svbb');localStorage.setItem('epp-app-role-v1','trainer');},account);
  await page.route('**/functions/v1/**',async route=>{
   const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let r={ok:true};
   if(fn==='epp-auth')r={ok:true,account,accounts:[],clubs:[]};
   if(fn==='epp-training')r={ok:true,entities:[]};
   if(['epp-admin','epp-platform','epp-scoring','epp-planner','epp-signup'].includes(fn))r={ok:true,matches:[match],shooters:[],ranking:[],qualifications:[],signups:[]};
   if(fn==='epp-planner'&&b.action==='view'){
    if(fail){await route.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"error":"tijdelijk_onbereikbaar"}'});return;}
    r={ok:true,match,planner,managing:true,profile:null,slots,roster:roster.map((p,i)=>({...p,name:i===0&&fresh?'Actuele Schutter':p.name})),mine:{revision:0,choices:[]},audit:[],paymentOrders:[{id:'pending',shooterId:'pending',name:'Wachtende Schutter',status:'open',choices:[{discipline:'optiek',slotId:'slot-30'}]}]};
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(r)});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'Wedstrijden',exact:true}).click();await page.getByRole('button',{name:'Wedstrijdplanner',exact:true}).click();
  const button=page.getByRole('button',{name:'Planning downloaden (PDF)',exact:true});await button.waitFor();fresh=true;
  const waiting=page.waitForEvent('download');await button.click();const download=await waiting;
  assert.match(download.suggestedFilename(),/^EPP-planning-SV-Test-wedstrijdplanning-2030-11-14\.pdf$/);
  const path=tmpdir()+'/epp-planning-pdf-test-'+width+'.pdf';await download.saveAs(path);
  const bytes=await readFile(path);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  const pages=await page.evaluate(async bytes=>{const doc=await PDFLib.PDFDocument.load(Uint8Array.from(bytes));return doc.getPages().map(p=>({width:p.getWidth(),height:p.getHeight()}));},Array.from(bytes));assert.ok(pages.length>=3);for(const p of pages){assert.ok(Math.abs(p.width-595.28)<.1);assert.ok(Math.abs(p.height-841.89)<.1);}
  await page.getByRole('status').filter({hasText:'PDF gereed: 31 tijdblokken'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:tmpdir()+'/epp-pdf-export-'+width+'.png',fullPage:true});
  if(width===390){fail=true;await button.click();await page.getByRole('alert').filter({hasText:'PDF maken is niet gelukt'}).waitFor();assert.equal(await page.getByRole('link',{name:'PDF openen',exact:true}).count(),0);fail=false;const retry=page.waitForEvent('download');await button.click();await retry;}
  if(width===390){
   const stress=await page.evaluate(async()=>{
    const result=await EppPlannerPdf.create({managing:true,match:{organizer:'Langenaamtest',match_date:'2030-11-14'},slots:[{id:'stress',starts_at:'2030-11-14T08:00:00Z',ends_at:'2030-11-14T08:15:00Z',capacity:1}],roster:[{shooterId:'long',name:'Langenaam'.repeat(650),clubs:['SV Test'],publicId:'EPP-STRESS',choices:[{discipline:'pistool',slotId:'stress'}]}]});return Array.from(result.bytes);
   });
   const {writeFile}=await import('node:fs/promises');await writeFile(tmpdir()+'/epp-planning-pdf-stress.pdf',Uint8Array.from(stress));
  }
  // The non-management view hides export; the PDF helper also rejects a direct unauthorized call.
  await page.evaluate(()=>{window.pdfTestRoot=ReactDOM.createRoot(document.getElementById('root'));pdfTestRoot.render(h('div',{className:'app'},h('style',null,CSS),h(MatchPlanner,{matchId:'pdf-test',manage:false})));});
  await page.waitForTimeout(300);assert.equal(await page.getByRole('button',{name:'Planning downloaden (PDF)',exact:true}).count(),0);
  assert.equal(await page.evaluate(async()=>{try{await EppPlannerPdf.create({managing:false});return false;}catch{return true;}}),true);
  assert.deepEqual(errors,[]);await page.close();console.log('PASS PDF '+width+': fresh organizer export, multipage A4, all slots, error/retry and restricted visibility');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
