import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html'));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.html'?'text/html':'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
  for(const engine of [chromium,webkit]){
    const browser=await engine.launch({headless:true,...(engine===chromium?{executablePath:process.env.CHROME_PATH}:process.env.WEBKIT_PATH?{executablePath:process.env.WEBKIT_PATH}:{})});
    try{
      for(const width of [375,390,1440]){
        const context=await browser.newContext({viewport:{width,height:844},hasTouch:true}),page=await context.newPage(),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        const account={id:'nav-test',username:'lid.test',displayName:'Test Schutter',role:'trainer',clubId:'svbb',isAdmin:false};
        await page.route('**/functions/v1/**',async route=>{
          const fn=route.request().url().split('/').pop();
          const result=fn==='epp-auth'?{ok:true,account,sessionToken:'a'.repeat(64)}:fn==='epp-training'?{ok:true,entities:[],backups:[]}:{ok:true,matches:[],shooters:[],ranking:[],matchRanking:[],qualifications:[],events:[],signups:[]};
          await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
        });
        await page.goto('http://127.0.0.1:'+server.address().port);
        await page.getByLabel('Voornaam',{exact:true}).fill('Test');
        await page.getByLabel('Achternaam',{exact:true}).fill('Schutter');
        await page.getByLabel('Wachtwoord',{exact:true}).fill('test-password');
        await page.getByRole('button',{name:'Inloggen',exact:true}).click();
        for(let attempt=0;attempt<2;attempt++){
          if(attempt)await page.reload();
          await page.locator('nav.bottomnav').waitFor();
          assert.equal(await page.locator('#loginGate').evaluate(el=>el.hidden&&el.inert),true);
          const nav=page.locator('nav.bottomnav');
          assert.equal(await nav.evaluate(el=>getComputedStyle(el).transform),'none');
          for(const name of ['Meer','Landelijk','Stand','Training']){
            const button=nav.getByRole('button',{name,exact:true});
            const bounds=await button.boundingBox();
            assert.ok(bounds&&bounds.y>=0&&bounds.y+bounds.height<=844);
            assert.equal(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'navigation receives touches immediately');
            await button.tap();
            await page.waitForFunction(name=>[...document.querySelectorAll('nav.bottomnav button')].some(b=>b.textContent.toLowerCase()===name.toLowerCase()&&b.dataset.on==='1'),name);
          }
        }
        assert.deepEqual(errors,[]);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:'/private/tmp/epp-login-nav-'+engine.name()+'-'+width+'.png'});
        await context.close();console.log('PASS '+engine.name()+' '+width+': login, reload, immediate menu taps without scrolling');
      }
    }finally{await browser.close();}
  }
}finally{await new Promise(r=>server.close(r));}
