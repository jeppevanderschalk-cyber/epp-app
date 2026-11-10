import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=resolve(import.meta.dirname,'../..');
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/^\/$/,'/index.html'));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(p)]||'application/octet-stream');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:844}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/functions/v1/**',async route=>{const b=route.request().postDataJSON();requests.push(b);await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({ok:false,error:b.username==='duplicate'&&b.autoClub?'vereniging_kiezen_nodig':'ongeldig_wachtwoord'})});});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const name=page.getByLabel('Gebruikersnaam of e-mailadres',{exact:true}),pw=page.getByLabel('Wachtwoord',{exact:true}),club=page.locator('#loginClubLabel'),submit=page.getByRole('button',{name:'Inloggen',exact:true});
 assert.equal(await club.isVisible(),false);
 await name.fill('anne');await pw.fill('wrong-password');await submit.click();await page.getByText(/Controleer je gebruikersnaam/).waitFor();assert.equal(requests.at(-1).autoClub,true);assert.equal(await club.isVisible(),false);
 await name.fill('duplicate');await submit.click();await page.getByText(/Deze inlognaam komt/).waitFor();assert.equal(await club.isVisible(),true);
 await page.locator('#loginClub').selectOption('apgs');await submit.click();await page.getByText(/Controleer je gebruikersnaam/).waitFor();assert.equal(requests.at(-1).clubId,'apgs');assert.equal(requests.at(-1).autoClub,false);
 await name.fill('anne@example.nl');assert.equal(await club.isVisible(),false);await submit.click();await page.getByText(/Controleer je gebruikersnaam/).waitFor();assert.equal(requests.at(-1).autoClub,true);assert.equal(requests.at(-1).email,'anne@example.nl');
 await page.getByLabel('Inloggen als').selectOption('hoofdbeheer');await pw.fill('wrong-password');await submit.click();await page.getByText(/Controleer je gebruikersnaam/).waitFor();assert.equal(requests.at(-1).autoClub,false);assert.equal(requests.at(-1).clubId,'eppnationaal');
 assert.deepEqual(errors,[]);await page.close();console.log('PASS '+width+': no club picker, automatic username/email login, duplicate fallback, reset on account switch, head login');
}}finally{await browser.close();await new Promise(r=>server.close(r));}
