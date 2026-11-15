import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/epp-recovery-tools/node_modules/playwright/index.mjs');
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const url='http://127.0.0.1:'+server.address().port;
try{
 for(const mode of ['normal','denied','ios-browser','unsupported']){
  const account={id:'push-admin',username:'pushadmin',displayName:'Push Beheer',role:'trainer',clubId:'svbb',isAdmin:true,isPlatformAdmin:false};
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(({account,mode})=>{
   localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account}));localStorage.setItem('epp-app-club-v1','svbb');
   window.pushState={permissionRequests:0,subscribed:false,unsubscribed:0,options:null};
   if(mode==='unsupported'){delete window.PushManager;return;}
   if(mode==='ios-browser'){Object.defineProperty(navigator,'userAgent',{value:'iPhone'});Object.defineProperty(navigator,'standalone',{value:false});}
   const subscription={endpoint:'https://web.push.apple.com/browser-test',toJSON:()=>({endpoint:'https://web.push.apple.com/browser-test',keys:{p256dh:'test',auth:'test'}}),unsubscribe:async()=>{pushState.subscribed=false;pushState.unsubscribed++;return true;}};
   const registration={pushManager:{getSubscription:async()=>pushState.subscribed?subscription:null,subscribe:async options=>{pushState.options={userVisibleOnly:options.userVisibleOnly,keyLength:options.applicationServerKey.length};pushState.subscribed=true;return subscription;}}};
   const worker=new EventTarget();worker.getRegistration=async()=>registration;worker.register=async()=>registration;worker.ready=Promise.resolve(registration);
   Object.defineProperty(navigator,'serviceWorker',{value:worker});
   Object.defineProperty(window,'Notification',{value:{requestPermission:async()=>{pushState.permissionRequests++;return mode==='denied'?'denied':'granted';}}});
  },{account,mode});
  const calls=[];
  await context.route('**/functions/v1/**',async route=>{
   const body=route.request().postDataJSON();calls.push(body);let data={ok:true,shooters:[],matches:[],accounts:[],requests:[],entities:[],qualifications:[],ranking:[],matchRanking:[],clubs:[]};
   if(body.action==='session')data.account=account;
   if(body.action==='settings')data={ok:true,ready:true,publicKey:Buffer.alloc(65,4).toString('base64url')};
   if(body.action==='get_publication_consent')data.consent={allowed:false};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
  await page.getByRole('button',{name:'Meer',exact:true}).click();await page.locator('#phone-push-settings > summary').click();
  const section=page.getByRole('region',{name:'Telefoonmeldingen',exact:true});
  const enable=section.getByRole('button',{name:'Telefoonmeldingen aanzetten',exact:true});
  if(mode==='normal'){
   await enable.click();await section.getByText('Telefoonmeldingen staan aan op dit apparaat. Je kunt nu een testmelding sturen.',{exact:true}).waitFor();
   const state=await page.evaluate(()=>pushState);assert.equal(state.permissionRequests,1);assert.equal(state.options.userVisibleOnly,true);assert.equal(state.options.keyLength,65);
   assert.ok(calls.some(b=>b.action==='subscribe'&&b.subscription.endpoint==='https://web.push.apple.com/browser-test'));
   await section.getByRole('button',{name:'Testmelding sturen',exact:true}).click();await section.getByText('Testmelding verstuurd.',{exact:false}).waitFor();assert.ok(calls.some(b=>b.action==='test'));
   await section.getByRole('button',{name:'Telefoonmeldingen uitzetten',exact:true}).click();await section.getByText('Telefoonmeldingen op dit apparaat zijn uitgezet.',{exact:true}).waitFor();
   assert.equal((await page.evaluate(()=>pushState)).unsubscribed,1);assert.ok(calls.some(b=>b.action==='unsubscribe'));
   // Tapping a delivered notification opens the pending request list in the existing app.
   await page.evaluate(()=>navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{type:'epp-open-password-help'}})));
   await page.getByRole('region',{name:'Wachtwoordherstelverzoeken',exact:true}).waitFor();
  }else if(mode==='denied'){
   await enable.click();await section.getByText('Meldingen zijn niet toegestaan.',{exact:false}).waitFor();assert.ok(!calls.some(b=>b.action==='subscribe'));
  }else{
   await page.waitForFunction(()=>document.querySelector('#phone-push-settings button').disabled);
   if(mode==='ios-browser')await section.getByText('Open EPP via het beginscherm',{exact:false}).waitFor();
   else await section.getByText('Deze browser ondersteunt geen telefoonmeldingen.',{exact:false}).waitFor();
  }
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await context.close();
 }
 console.log('PASS phone settings: explicit opt-in, iPhone install requirement, permission denial, device subscribe/unsubscribe, test notification and notification-click navigation');
}finally{await browser.close();await new Promise(r=>server.close(r));}
