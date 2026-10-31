const API='https://api.mollie.com';
export const PRICE_CENTS=1200;
export const DISCIPLINES=['pistool','optiek'];
export const SCOPES='organizations.read profiles.read onboarding.read payments.read payments.write refunds.read';
export function configured(config){return !!(config.clientId&&config.clientSecret&&/^[a-f0-9]{64}$/i.test(config.encryptionKey||''));}
export function quote(choices){
  if(!Array.isArray(choices)||choices.length<1||choices.length>2||new Set(choices.map(c=>c.discipline)).size!==choices.length||choices.some(c=>!DISCIPLINES.includes(c.discipline)||!c.slotId))throw Error('ongeldige_boeking');
  return PRICE_CENTS*choices.length;
}
export function checkoutUrl(value){
  try{const url=new URL(value);return url.protocol==='https:'&&['www.mollie.com','mollie.com','checkout.mollie.com'].includes(url.hostname)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export async function seal(value,key,aad){
  if(!/^[a-f0-9]{64}$/i.test(key||''))throw Error('betaalconfiguratie_ontbreekt');
  const bytes=Uint8Array.from(key.match(/../g),c=>parseInt(c,16));
  const cryptoKey=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(aad)},cryptoKey,new TextEncoder().encode(JSON.stringify(value))));
  return JSON.stringify({v:1,iv:btoa(String.fromCharCode(...iv)),data:btoa(String.fromCharCode(...ciphertext))});
}
export async function unseal(value,key,aad){
  try{
    const envelope=JSON.parse(value);if(envelope.v!==1)throw Error();
    const bytes=Uint8Array.from(key.match(/../g),c=>parseInt(c,16));
    const cryptoKey=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['decrypt']);
    const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(envelope.iv),c=>c.charCodeAt(0)),additionalData:new TextEncoder().encode(aad)},cryptoKey,Uint8Array.from(atob(envelope.data),c=>c.charCodeAt(0)));
    return JSON.parse(new TextDecoder().decode(decoded));
  }catch{throw Error('betaalaccount_opnieuw_koppelen');}
}
export async function mollie(path,token,{method='GET',body,key}={},fetcher=fetch){
  if(!/^\/(v2|oauth2)\//.test(path))throw Error('ongeldige_providerroute');
  let response;
  try{response=await fetcher(API+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});}catch{throw Error('betaaldienst_onbereikbaar');}
  if(!response.ok)throw Error('betaaldienst_http_'+response.status);
  try{return await response.json();}catch{throw Error('ongeldig_providerantwoord');}
}
export async function tokens(config,grant,fetcher=fetch){
  let response;
  try{response=await fetcher(API+'/oauth2/tokens',{method:'POST',headers:{Authorization:'Basic '+btoa(config.clientId+':'+config.clientSecret),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(grant).toString(),signal:AbortSignal.timeout(12000)});}catch{throw Error('betaaldienst_onbereikbaar');}
  if(!response.ok)throw Error('betaalaccount_opnieuw_koppelen');
  const data=await response.json();
  if(!data.access_token||!data.refresh_token||!Number.isFinite(data.expires_in))throw Error('ongeldig_providerantwoord');
  return {accessToken:data.access_token,refreshToken:data.refresh_token,expiresAt:Date.now()+data.expires_in*1000};
}
export function paymentRequest(order,config){
  if(order.amount_cents!==quote(order.choices)||order.currency!=='EUR')throw Error('ongeldig_bedrag');
  const webhook=new URL(config.functionUrl);webhook.searchParams.set('route','webhook');webhook.searchParams.set('order',order.id);
  const redirect=new URL(config.publicUrl);redirect.searchParams.set('payment',order.id);redirect.searchParams.set('match',order.match_id);
  return {amount:{currency:'EUR',value:(order.amount_cents/100).toFixed(2)},profileId:order.profile_id,description:'EPP '+order.id+' · '+order.choices.map(c=>c.discipline==='pistool'?'Standaard':'Optics').join(' + '),method:'ideal',metadata:{eppOrderId:order.id,club:order.club_code},webhookUrl:webhook.href,redirectUrl:redirect.href,...(order.provider_mode==='test'?{testmode:true}:{})};
}
export function verifiedPayment(order,payment){
  if(!/^tr_[A-Za-z0-9]+$/.test(payment?.id||'')||order.provider_id&&order.provider_id!==payment.id||payment.mode!==(order.provider_mode||'live')||payment.profileId!==order.profile_id||payment.metadata?.eppOrderId!==order.id||payment.metadata?.club!==order.club_code||payment.amount?.currency!=='EUR'||payment.amount?.value!==(order.amount_cents/100).toFixed(2))throw Error('betaling_verificatie_mislukt');
  if(!['open','pending','paid','failed','expired','canceled'].includes(payment.status))throw Error('betaling_verificatie_mislukt');
  const refunded=payment.amountRefunded?.value||'0.00';
  if(!/^\d+\.\d{2}$/.test(refunded)||payment.amountRefunded&&payment.amountRefunded.currency!=='EUR')throw Error('betaling_verificatie_mislukt');
  const cents=Math.round(Number(refunded)*100);if(cents>order.amount_cents)throw Error('betaling_verificatie_mislukt');
  return {id:payment.id,status:payment.status,refunded:cents,checkout:checkoutUrl(payment._links?.checkout?.href),expiresAt:payment.expiresAt||null};
}
export function publicOrder(order){
  return order?{id:order.id,status:order.status,registrationCanceled:order.registration_canceled===true,testMode:order.provider_mode==='test',providerId:order.provider_id,amountCents:order.amount_cents,currency:order.currency,choices:order.choices,expectedRevision:order.expected_revision,checkoutUrl:checkoutUrl(order.checkout_url),expiresAt:order.expires_at,confirmedAt:order.confirmed_at,refundedCents:order.refunded_cents||0,createdAt:order.created_at}:null;
}
