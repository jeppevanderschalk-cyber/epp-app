import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html'));if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
    let approved=false,registered=false,account=null;
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>d.accept());
    await page.route('**/functions/v1/**',async route=>{
      const b=route.request().postDataJSON(),fn=route.request().url().split('/').pop();
      let r={ok:true,matches:[],shooters:[],ranking:[],matchRanking:[],qualifications:[],events:[],signups:[],entities:[]},status=200;
      if(fn==='epp-auth'){
        if(b.action==='login'&&b.username==='kijker'){account={id:'viewer',username:'kijker',clubId:'svbb',role:'schutter'};r={ok:true,sessionToken:'a'.repeat(64),account};}
        else if(b.action==='register_member'){assert.equal(b.registrationClubId,'apgs');assert.equal(b.email,'same.name@example.nl');registered=true;r={ok:true,pendingApproval:true,account:{clubId:'apgs'}};}
        else if(b.action==='login'){
          assert.equal(registered,true);assert.equal(b.email,'same.name@example.nl');assert.equal(b.clubId,'apgs');
          if(!approved){r={ok:false,error:'vereniging_goedkeuring_nodig'};status=403;}
          else{account={id:'member',username:'lid.email',displayName:'Shared Name',clubId:'apgs',role:'schutter',isAdmin:false};r={ok:true,sessionToken:'b'.repeat(64),account};}
        }else if(b.action==='session')r={ok:true,account};
        else if(b.action==='approve_member'){assert.equal(b.accountId,'member');approved=true;r={ok:true};}
      }
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(r)});
    });
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByRole('button',{name:'Ik heb nog geen account',exact:true}).click();
    await page.getByText('Eigen account aanmaken',{exact:true}).waitFor({timeout:5000}).catch(async e=>{console.log(await page.locator('body').innerText());console.log(errors);await page.screenshot({path:'/private/tmp/epp-approval-debug.png',fullPage:true});throw e;});
    await page.locator('#root select').selectOption('apgs');
    await page.locator('#root').getByLabel('Voornaam',{exact:true}).fill('Shared');
    await page.locator('#root').getByLabel('Achternaam',{exact:true}).fill('Name');
    await page.locator('#root').getByLabel('E-mailadres',{exact:true}).fill('same.name@example.nl');
    await page.getByLabel('Eigen wachtwoord',{exact:true}).fill('TestPassword123');
    await page.getByLabel('Herhaal wachtwoord',{exact:true}).fill('TestPassword123');
    await page.getByRole('button',{name:'Account aanmaken',exact:true}).click();
    await page.getByText('Account aangemaakt. Je vereniging moet je lidmaatschap eerst goedkeuren. Daarna kun je inloggen.',{exact:true}).waitFor();
    await page.getByLabel('Wachtwoord',{exact:true}).fill('TestPassword123');
    await page.getByRole('button',{name:'Inloggen',exact:true}).click();
    await page.getByText('Je account wacht op goedkeuring door je vereniging. Neem contact op met je verenigingsbeheerder.',{exact:true}).waitFor();
    assert.equal(await page.locator('#root').isVisible(),false);
    // Exercise the real approval control, then return to the unchanged login form.
    await page.evaluate(()=>{window.approvalRoot=ReactDOM.createRoot(document.getElementById('root'));approvalRoot.render(h(MembershipApproval,{account:{id:'member',display_name:'Shared Name',email:'same.name@example.nl',membership_approved:false,active:true},onApproved:async()=>{document.getElementById('root').hidden=true;}}));document.getElementById('root').hidden=false;document.getElementById('loginGate').hidden=true;});
    await page.getByRole('button',{name:'Lidmaatschap goedkeuren',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('root').hidden);
    await page.evaluate(()=>{approvalRoot.unmount();eppShowLoginGate();});
    await page.getByRole('button',{name:'Inloggen',exact:true}).click();
    await page.locator('nav.bottomnav').waitFor();
    assert.equal(await page.evaluate(()=>eppSession().account.clubId),'apgs');
    assert.equal(await page.evaluate(()=>localStorage.getItem(EPP_SESSION_KEY)),null);
    assert.ok(await page.evaluate(()=>sessionStorage.getItem(EPP_SESSION_KEY)));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:'/private/tmp/epp-approved-registration-'+width+'.png'});
    await page.close();console.log('PASS '+width+': registration, pending denial, approval, email login, correct club, session-only storage');
  }
}finally{await browser.close();await new Promise(r=>server.close(r));}
