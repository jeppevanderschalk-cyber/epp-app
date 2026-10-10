import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const errors=[];
try{
  for(const width of [390,1440])for(const role of ['trainer','schutter']){
    const account={id:'test',username:'lid.test',displayName:'Test',clubId:'svbb',role,isAdmin:false};
    const data=new Map([
      ['shooter|a',{kind:'shooter',id:'a',data:{id:'a',naam:'Anna Test'}}],
      ['shooter|b',{kind:'shooter',id:'b',data:{id:'b',naam:'Bert Test'}}],
      ['meta|currentTraining',{kind:'meta',id:'currentTraining',data:{id:'training',mode:'parcours',stage:'s1',startedAt:Date.now()}}]
    ]);
    const page=await browser.newPage({viewport:{width,height:950}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(a=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account:a}));localStorage.setItem('epp-app-club-v1','svbb');localStorage.setItem('epp-app-role-v1',a.role);},account);
    await page.route('https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/**',async route=>{
      const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let r={ok:true};
      if(fn==='epp-auth')r={ok:true,account};
      if(fn==='epp-training'){
        if(b.action==='save')for(const op of b.ops){const key=op.kind+'|'+op.id;if(op.value===null)data.delete(key);else data.set(key,{kind:op.kind,id:op.id,data:op.value});}
        r={ok:true,entities:[...data.values()]};
      }
      if(fn==='epp-signup')r={ok:true,matches:[],shooters:[],signups:[]};
      if(fn==='epp-planner'||fn==='epp-scoring')r={ok:true,matches:[]};
      if(fn==='epp-platform')r={ok:true,ranking:[],matchRanking:[],matches:[],shooters:[]};
      await route.fulfill({contentType:'application/json',body:JSON.stringify(r)});
    });
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByRole('button',{name:'Training',exact:true}).click();
    assert.equal(await page.locator('nav.bottomnav').getByRole('button',{name:'Stages',exact:true}).count(),0);
    assert.equal(await page.locator('nav.bottomnav').getByRole('button',{name:'Parcours',exact:true}).count(),0);
    if(role==='trainer'){
      await page.getByRole('button',{name:'Stages',exact:true}).click();
      const choice=page.getByLabel('Schutter voor score-invoer',{exact:true});
      await choice.selectOption('b');
      assert.equal(await page.locator('.score-row').count(),1);
      assert.equal(await page.locator('.score-name-txt').textContent(),'Bert Test');
      await page.locator('.num-in').fill('37');
      await page.getByRole('button',{name:'Ronde opslaan',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('select[aria-label="Schutter voor score-invoer"]').value==='a');
      await page.getByRole('button',{name:/^2\./}).click();
      await page.locator('.num-in').fill('20');
      await page.getByRole('button',{name:'Ronde opslaan',exact:true}).click();
      await page.getByRole('button',{name:'Overzicht',exact:true}).click();
      await page.getByLabel('Schutter in trainingsoverzicht').selectOption('a');
      assert.equal(await page.locator('.shooter-score-card').count(),1);
      await page.getByRole('button',{name:'Terug naar invoer',exact:true}).click();
      await choice.waitFor();
      await page.getByRole('button',{name:'Parcours',exact:true}).click();
      await choice.selectOption('b');
      await page.locator('.num-in').fill('200');
      await page.getByRole('button',{name:'Ronde opslaan',exact:true}).click();
      await page.getByRole('button',{name:'Naar huidige training',exact:true}).click();
      await page.getByText('Parcours training',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Overzicht',exact:true}).getAttribute('data-on'),'1');
      await page.getByRole('button',{name:'Terug naar invoer',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Parcours',exact:true}).getAttribute('data-on'),'1');
      await page.waitForTimeout(600);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:'/private/tmp/epp-training-parcours-'+width+'.png',fullPage:true});
      await page.getByRole('button',{name:'Stages',exact:true}).click();
      await choice.waitFor();
      await page.waitForTimeout(600);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:'/private/tmp/epp-training-stages-'+width+'.png',fullPage:true});
      assert.equal(await page.locator('.stage-card-img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0)),true);
      await page.waitForFunction(()=>document.querySelector('main p[role="status"]').textContent==='Online bijgewerkt');
      const rounds=[...data.values()].filter(e=>e.kind==='round').map(e=>e.data);
      assert.equal(rounds.length,3);assert.equal(rounds.find(r=>r.sid==='b'&&r.type==='stage').score,37);assert.equal(rounds.find(r=>r.sid==='a').score,20);
      assert.equal(rounds.find(r=>r.sid==='b'&&r.type==='parcours').score,200);
      assert.equal(rounds.find(r=>r.sid==='a').stage,'s2');
      await page.reload();await page.getByRole('button',{name:'Training',exact:true}).click();
      await page.getByRole('button',{name:'Stages',exact:true}).click();
      await page.getByRole('button',{name:'Overzicht',exact:true}).click();
      await page.getByLabel('Schutter in trainingsoverzicht').selectOption('a');
      await page.getByText('R1: 20',{exact:true}).waitFor();
    }else{
      const choice=page.getByLabel('Schutter in trainingsoverzicht');
      await choice.selectOption('b');assert.equal(await page.locator('.shooter-score-card').count(),1);
      assert.equal(await page.getByRole('button',{name:'Ronde opslaan',exact:true}).count(),0);
      await choice.selectOption('');assert.equal(await page.locator('.shooter-score-card').count(),2);
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.waitForTimeout(600);
    assert.equal(await page.getByRole('button',{name:'Training',exact:true}).getAttribute('data-on'),'1');
    await page.screenshot({path:'/private/tmp/epp-training-'+role+'-'+width+'.png',fullPage:true});
    await page.close();console.log('PASS '+role+' '+width+': merged training, shooter dropdown and retained scores');
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
