import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
  for(const viewport of [{width:375,height:812},{width:390,height:844},{width:1440,height:1000}])for(const [clubId,label]of [['svbb','SVBB'],['dekorrel','SV De Korrel - Druten'],['politienoordholland','Schietvereniging Politie Noord-Holland']]){
    const context=await browser.newContext({viewport});
    const account={id:'test',username:'lid.test',role:'schutter',clubId,displayName:'Test Schutter',isAdmin:false};
    await context.addInitScript(a=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account:a}));localStorage.setItem('epp-app-club-v1',a.clubId);localStorage.setItem('epp-app-role-v1',a.role);},account);
    await context.route('https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,account,entities:[],matches:[],shooters:[],signups:[]})}));
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    const tag=page.getByLabel('Ingelogde vereniging',{exact:true});await tag.waitFor();assert.equal(await tag.textContent(),label);
    assert.equal(await tag.getAttribute('title'),label);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const overlap=await page.evaluate(()=>{const a=document.querySelector('.club-tag').getBoundingClientRect(),b=document.querySelector('.topbar-title').getBoundingClientRect();return a.left<b.right-1;});assert.equal(overlap,false);
    await page.screenshot({path:'/private/tmp/epp-club-header-'+clubId+'-'+viewport.width+'.png'});
    assert.deepEqual(errors,[]);await context.close();console.log('PASS '+clubId+' '+viewport.width+': correct account association and no header overlap');
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
