import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html'));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
 for(const scenario of ['unconfigured','ready','load-error']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],saves=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/functions/v1/**',async route=>{
   const b=route.request().postDataJSON();let r={ok:true},status=200;
   if(b.action==='notification_settings'||b.action==='save_notification_settings'){
    if(scenario==='load-error'){r={ok:false,error:'test_load_error'};status=500;}
    else {if(b.action==='save_notification_settings')saves.push(b);r={ok:true,club:{notification_email:b.notificationEmail||'',notifications_enabled:b.enabled||false},recipients:[],mailReady:scenario==='ready'};}
   }
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(r)});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{
   sessionStorage.setItem(EPP_SESSION_KEY,JSON.stringify({sessionToken:'a'.repeat(64),account:{clubId:'svbb',role:'trainer',isAdmin:true,isPlatformAdmin:true}}));
   document.getElementById('loginGate').hidden=true;document.getElementById('root').hidden=false;
   window.settingsRoot=ReactDOM.createRoot(document.getElementById('root'));settingsRoot.render(h(NotificationSettings));
  });
  const save=page.getByRole('button',{name:'Meldingsinstellingen opslaan',exact:true}),toggle=page.getByRole('checkbox');
  if(scenario==='load-error'){
   await page.getByText('Instellingen laden is niet gelukt. Herlaad de pagina.',{exact:true}).waitFor();assert.equal(await save.isDisabled(),true);
  }else{
   await save.waitFor();await page.waitForFunction(()=>!document.querySelector('button[type="submit"]').disabled);
   assert.equal(await toggle.isDisabled(),scenario==='unconfigured');
   await page.locator('#root select').selectOption('apgs');
   await page.waitForFunction(()=>!document.querySelector('button[type="submit"]').disabled);
   await page.getByLabel('E-mailadres verenigingsbeheerder',{exact:true}).fill('beheer@example.nl');
   if(scenario==='ready')await toggle.check();
   await save.click();
   await page.getByRole('status').waitFor();assert.equal(saves.length,1);assert.equal(saves[0].targetClubId,'apgs');assert.equal(saves[0].notificationEmail,'beheer@example.nl');assert.equal(saves[0].enabled,scenario==='ready');
  }
  assert.deepEqual(errors,[]);await page.close();console.log('PASS notification settings: '+scenario);
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
