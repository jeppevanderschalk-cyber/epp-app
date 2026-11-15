export function recoveryToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');}
export function recoveryPassword(value:unknown){
  if(typeof value!=='string'||value.length<10||value.length>256)throw new Error('nieuw_wachtwoord_ongeldig');
  return value;
}
export async function sendRecoveryMail(email:string,token:string,config:{apiKey:string,from:string},fetcher:typeof fetch=fetch){
  const link='https://epp-app.nl/#wachtwoord-herstellen='+token;
  const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json','Idempotency-Key':'epp-password-reset/'+token},body:JSON.stringify({from:config.from,to:[email],subject:'EPP: stel een nieuw wachtwoord in',text:'Je hebt een nieuw wachtwoord aangevraagd voor je EPP-account.\n\nOpen deze eenmalige link om je wachtwoord te wijzigen:\n'+link+'\n\nDeze link is 30 minuten geldig. Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren. Je wachtwoord blijft ongewijzigd.'}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('resetmail_niet_verstuurd');
  const data=await response.json();if(!data.id)throw new Error('resetmail_niet_verstuurd');
}
