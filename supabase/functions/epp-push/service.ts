const allowedHosts=new Set(['fcm.googleapis.com','web.push.apple.com','updates.push.services.mozilla.com']);
export function pushEndpoint(value:unknown){
 if(typeof value!=='string'||value.length>4096)throw Error('ongeldig_pushapparaat');
 let url:URL;try{url=new URL(value);}catch{throw Error('ongeldig_pushapparaat');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||(!allowedHosts.has(url.hostname)&&!/^wns[0-9a-z-]*\.notify\.windows\.com$/.test(url.hostname)))throw Error('ongeldig_pushapparaat');
 return url.href;
}
export function pushSubscription(value:any){
 const endpoint=pushEndpoint(value?.endpoint),keys=value?.keys;
 const decode=(v:any)=>{if(typeof v!=='string'||! /^[A-Za-z0-9_-]+={0,2}$/.test(v))throw Error('ongeldig_pushapparaat');try{return Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}catch{throw Error('ongeldig_pushapparaat');}};
 const publicKey=decode(keys?.p256dh),auth=decode(keys?.auth);
 if(publicKey.length!==65||publicKey[0]!==4||auth.length!==16)throw Error('ongeldig_pushapparaat');
 return {endpoint,p256dh:keys.p256dh,auth:keys.auth};
}
export function pushMessage(requestId:string){return {title:'Wachtwoordherstel gevraagd',body:'Er is een wachtwoordreset aangevraagd. Open EPP om het verzoek te bekijken.',url:'/?melding=wachtwoordherstel',tag:'epp-password-help-'+requestId};}
export async function deliverPush(subscription:any,message:any,config:any,generate:any,fetcher:typeof fetch=fetch){
 const endpoint=pushEndpoint(subscription.endpoint);
 const request=generate({endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},JSON.stringify(message),{TTL:3600,urgency:'normal',contentEncoding:'aes128gcm',vapidDetails:{subject:'https://epp-app.nl',publicKey:config.publicKey,privateKey:config.privateKey}});
 const response=await fetcher(endpoint,{method:'POST',headers:request.headers,body:request.body,redirect:'manual',signal:AbortSignal.timeout(10000)});
 return {sent:response.status>=200&&response.status<300,expired:[404,410].includes(response.status),retry:response.status===429||response.status>=500,error:response.ok?null:'push_http_'+response.status};
}
export async function processPush(db:any,config:any,generate:any,fetcher:typeof fetch=fetch){
 if(!config.publicKey||!config.privateKey)return {configured:false,sent:0,failed:0};
 const {data:jobs,error}=await db.rpc('epp_claim_push_jobs',{p_limit:8});if(error)throw error;
 let sent=0,failed=0;
 for(const job of jobs||[]){
  let result:any;
  try{result=await deliverPush(job,pushMessage(job.request_id),config,generate,fetcher);}catch{result={sent:false,expired:false,retry:true,error:'push_onbereikbaar'};}
  const {error:finishError}=await db.rpc('epp_finish_push_job',{p_id:job.id,p_lease:job.lease_token,p_sent:result.sent,p_expired:result.expired,p_retry:result.retry,p_error:result.error});if(finishError)throw finishError;
  if(result.sent)sent++;else failed++;
 }
 return {configured:true,sent,failed};
}
