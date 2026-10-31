export function notificationMessage(job:any) {
 const p=job.payload;
 const lines=[`Naam: ${p.name}`,`Vereniging: ${p.club}`];
 if(job.kind==='signup'){
  lines.push(`Wedstrijd: ${p.match}`,`Datum: ${p.date||'Zie wedstrijdplanning'}`,`Locatie: ${p.location||'Zie wedstrijdplanning'}`);
  for(const c of p.choices||[])lines.push(`${c.discipline}: ${c.day||p.date||''} ${c.time||'Tijdvoorkeur'}`.trim());
 }else lines.push('Een nieuw schuttersaccount is aangemaakt. Bekijk het account om het lidmaatschap te beoordelen.');
 lines.push('','Open de EPP-app: https://epp-app.nl/','Log in als verenigingsbeheerder.');
 return {subject:job.kind==='account'?`EPP: nieuw schuttersaccount bij ${p.club}`:`EPP: nieuwe wedstrijdinschrijving bij ${p.club}`,text:lines.join('\n')};
}
export async function deliverNotification(job:any,config:any,fetcher:typeof fetch=fetch){
 const message=notificationMessage(job);
 const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json','Idempotency-Key':'epp-notification/'+job.id},body:JSON.stringify({from:config.from,to:[job.recipient],...message}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)return {sent:false,retry:response.status===429||response.status>=500,error:'maildienst_http_'+response.status};
 const data=await response.json();
 if(typeof data.id!=='string'||!data.id)return {sent:false,retry:true,error:'maildienst_ongeldig_antwoord'};
 return {sent:true,providerId:data.id};
}
export async function processNotifications(db:any,config:any,fetcher:typeof fetch=fetch){
 if(!config.apiKey||!config.from)return {configured:false,sent:0,failed:0};
 const {data:jobs,error}=await db.rpc('epp_claim_notifications',{p_limit:5});if(error)throw error;
 let sent=0,failed=0;
 for(const job of jobs||[]){
  let result:any;
  try{result=await deliverNotification(job,config,fetcher);}catch{result={sent:false,retry:true,error:'maildienst_onbereikbaar'};}
  const {error:finishError}=await db.rpc('epp_complete_notification',{p_id:job.id,p_token:job.lease_token,p_sent:result.sent,p_provider_id:result.providerId||null,p_error:result.error||null,p_retry:result.retry!==false});
  if(finishError)throw finishError;
  if(result.sent)sent++;else failed++;
  // Keep requests below the provider's standard rate limit.
  if(jobs.length>1)await new Promise(resolve=>setTimeout(resolve,600));
 }
 return {configured:true,sent,failed};
}
