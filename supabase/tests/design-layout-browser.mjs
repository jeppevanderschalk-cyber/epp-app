import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.css':'text/css','.jpg':'image/jpeg','.html':'text/html','.js':'text/javascript','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
const errors=[];
try{
  for(const width of [320,390,1440])for(const role of ['trainer','schutter']){
    const account={id:'test',username:'lid.test',displayName:'Test',clubId:'svbb',role,isAdmin:role==='trainer'};
    const data=new Map([
      ['shooter|a',{kind:'shooter',id:'a',data:{id:'a',naam:'Anna Test'}}],
      ['shooter|b',{kind:'shooter',id:'b',data:{id:'b',naam:'Bert Test'}}],
      ['meta|currentTraining',{kind:'meta',id:'currentTraining',data:{id:'training',mode:'parcours',stage:'s1',startedAt:Date.now()}}]
    ]);
    const page=await browser.newPage({viewport:{width,height:950}});
    page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR '+e.message)});
    await page.addInitScript(a=>{localStorage.setItem('epp-session-v2',JSON.stringify({sessionToken:'a'.repeat(64),account:a}));localStorage.setItem('epp-app-club-v1','svbb');localStorage.setItem('epp-app-role-v1',a.role);},account);
    await page.route('https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/**',async route=>{
      const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();let r={ok:true};
      if(fn==='epp-auth')r={ok:true,account};
      if(fn==='epp-training'){
        if(b.action==='save')for(const op of b.ops){const key=op.kind+'|'+op.id;if(op.value===null)data.delete(key);else data.set(key,{kind:op.kind,id:op.id,data:op.value});}
        r={ok:true,entities:[...data.values()],shooters:[{id:'a',naam:'Anna Test'},{id:'b',naam:'Bert Test'}],rounds:[],stageShots:{},bestParcours:{},bestStageAverages:{}};
      }
      if(fn==='epp-signup')r={ok:true,matches:[],shooters:[],signups:[]};
      if(fn==='epp-planner'||fn==='epp-scoring')r={ok:true,matches:[]};
      if(fn==='epp-platform')r={ok:true,ranking:[],matchRanking:[],matches:[],shooters:[],qualifications:[]};
      await route.fulfill({contentType:'application/json',body:JSON.stringify(r)});
    });
    await page.goto('http://127.0.0.1:'+server.address().port);


    for(const tab of ['Start','Training','Wedstrijden','Stand','Meer']){
      await page.locator('nav.bottomnav').getByRole('button',{name:tab,exact:true}).click();
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,role+' '+width+' '+tab+' fits');
      assert.equal(await page.locator('.epp-install-help').isVisible(),false,'installation help does not push down app content');
      if(tab==='Start'&&width===1440){
        const next=await page.locator('.home-next').boundingBox(),stages=await page.locator('.home-stages').boundingBox();
        assert.ok(Math.abs(next.y-stages.y)<2&&stages.x>next.x,'desktop overview uses two columns');
      }
      if(tab==='Training'){
        assert.equal(await page.locator('.score-form').evaluate(e=>getComputedStyle(e).paddingBottom),'0px');
        const nav=await page.locator('.bottomnav').boundingBox(),dock=await page.locator('.save-dock').boundingBox();
        assert.ok(Math.abs(dock.y+dock.height-nav.y)<2,'save dock sits above navigation');
        await page.locator('.training-action .btn').scrollIntoViewIfNeeded();
        await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
        const action=await page.locator('.training-action .btn').boundingBox(),bar=await page.locator('.save-dock').boundingBox();
        assert.ok(action.y+action.height<=bar.y,'last action can scroll completely above dock');
        await page.getByRole('button',{name:'Stages',exact:true}).click();
        if(width<700){
          await page.getByLabel('Stage voor score-invoer').selectOption('s2');
          assert.equal(await page.locator('.stage-hdr-name').innerText(),'Liggend');
        }else{
          await page.getByRole('button',{name:/^2\./}).click();
          assert.equal(await page.locator('.stage-hdr-name').innerText(),'Liggend');
        }
        await page.locator('.stage-reference summary').click();
        await page.locator('.stage-reference img').evaluate(image=>image.decode());
        assert.ok((await page.locator('.stage-reference img').boundingBox()).width<=width);
        await page.locator('.stage-reference summary').click();
      }
      if(tab==='Wedstrijden'){
        assert.equal(await page.locator('.competition-nav button').count(),6);
        for(const button of await page.locator('.competition-nav button').all()){
          const b=await button.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width,'all six match sections fit without swiping');
        }
      }
      if(tab==='Stand')for(const empty of await page.locator('.empty').all())assert.ok((await empty.boundingBox()).height<200,'empty standings stay compact');
      if(tab==='Meer'){
        await page.locator('.more-item>summary').filter({hasText:'App installeren'}).click();
        await page.getByText('iPhone / iPad: open EPP in Safari, tik op Delen en kies ‘Zet op beginscherm’.',{exact:true}).waitFor();
        assert.equal(await page.getByRole('heading',{name:'Mijn account',exact:true}).count(),1);
        if(role==='trainer'){
          assert.equal(await page.getByRole('heading',{name:'Verenigingsbeheer',exact:true}).count(),1);
          assert.equal(await page.locator('.danger-zone').count(),1);
        }else assert.equal(await page.locator('.danger-zone').count(),0);
      }
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:tmpdir()+'/epp-design-'+role+'-'+width+'-'+tab+'.png',fullPage:true});
    }
    await page.close();console.log('PASS design '+role+' '+width+': navigation, score clearance, stage reference, overview, empty states and settings');
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(r=>server.close(r));}
