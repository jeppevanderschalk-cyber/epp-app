import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/epp-audit-tools/node_modules/playwright/index.mjs');
const browser=await chromium.launch({headless:true});
const errors=[];
try{
  for(const viewport of [{width:390,height:844},{width:1440,height:1000}]){
    const context=await browser.newContext({viewport});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    try{
      await page.goto('https://epp-app.nl/?release=single-match-score',{waitUntil:'domcontentloaded'});
      await page.locator('#loginClub').selectOption('mercurius75');
      await page.locator('#loginRole').selectOption('trainer');
      await page.locator('#loginPassword').fill(process.env.EPP_TEST_PASSWORD);
      await page.locator('.login-submit').click();
      await page.getByText('Volledig Parcours',{exact:true}).waitFor({timeout:30000});
      await page.getByRole('status').filter({hasText:/Online bijgewerkt|Online opgeslagen/}).first().waitFor({timeout:30000});
      assert.equal((await page.locator('.club-tag').innerText()).toUpperCase(),"SV MERCURIUS '75");
      await page.getByRole('button',{name:'Meer',exact:true}).click();
      await page.getByText("Accounts - SV Mercurius '75",{exact:true}).waitFor();
      await page.getByRole('button',{name:'Back-up maken',exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:'/private/tmp/epp-live-'+viewport.width+'.png',fullPage:true});
      await page.getByRole('button',{name:'Landelijk',exact:true}).click();
      await page.getByText('Score bevestigen',{exact:true}).waitFor();
      assert(await page.getByLabel('Wedstrijd',{exact:true}).count()>0);
      assert.equal(await page.getByLabel('Ronde',{exact:true}).count(),0);
      assert.equal(await page.getByText('Rondenummer',{exact:true}).count(),0);
      await page.getByRole('button',{name:'Meer',exact:true}).click();
      await page.getByRole('button',{name:'Inschrijven voor wedstrijden',exact:true}).click();
      await page.getByRole('button',{name:'Groepslijst',exact:true}).first().waitFor({timeout:30000});
      console.log('PASS live browser '+viewport.width+': login, correct club, accounts, backups, no round controls and registration calendar');
    }finally{
      await page.evaluate(async()=>{if(typeof eppCall==='function')try{await eppCall('epp-auth',{clubId:'mercurius75',action:'logout'});}catch{}}).catch(()=>{});
      await context.close();
    }
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
