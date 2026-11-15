import webpush from 'npm:web-push@3.6.7';
import {corsHeaders,json,serviceClient,sha256Hex} from '../_shared/epp.ts';
import {requireAccount} from '../_shared/session.ts';
import {pushSubscription,pushEndpoint,deliverPush,processPush} from './service.ts';
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
 let body:any;try{body=await req.json();}catch{return json({ok:false,error:'invalid_json'},400);}
 const db=serviceClient(),config={publicKey:Deno.env.get('EPP_PUSH_PUBLIC_KEY'),privateKey:Deno.env.get('EPP_PUSH_PRIVATE_KEY')};
 try{
  if(body.action==='worker'){
   const secret=Deno.env.get('EPP_PUSH_WORKER_SECRET');
   if(!secret||await sha256Hex(req.headers.get('authorization')||'')!==await sha256Hex('Bearer '+secret))return json({ok:false,error:'geen_toegang'},401);
   if(body.selfCheck===true){
    if(!config.publicKey||!config.privateKey)throw Error('push_niet_ingesteld');
    const detail=webpush.generateRequestDetails({endpoint:'https://fcm.googleapis.com/fcm/send/crypto-check',keys:{p256dh:config.publicKey,auth:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/=/g,'')}},'EPP crypto check',{vapidDetails:{subject:'https://epp-app.nl',publicKey:config.publicKey,privateKey:config.privateKey},contentEncoding:'aes128gcm'});
    return json({ok:true,cryptoReady:!!detail.body&&!!detail.headers.Authorization});
   }
   const result=await processPush(db,config,webpush.generateRequestDetails.bind(webpush));
   return json({ok:result.configured,...result},result.configured?200:503);
  }
  const actor=await requireAccount(body);
  if(body.action==='settings')return json({ok:true,ready:!!(config.publicKey&&config.privateKey),publicKey:config.publicKey||null});
  if(body.action==='unsubscribe'){
   const endpoint=pushEndpoint(body.endpoint);
   const {error}=await db.from('epp_push_subscriptions').delete().eq('account_id',actor.id).eq('endpoint',endpoint);if(error)throw error;
   return json({ok:true});
  }
  if(!actor.is_admin||actor.role!=='trainer')throw Error('geen_beheerrechten');
  if(body.action==='subscribe'){
   if(!config.publicKey||!config.privateKey)throw Error('push_niet_ingesteld');
   const s=pushSubscription(body.subscription);
   // Reject malformed curve points before storing a device registration.
   const raw=Uint8Array.from(atob(s.p256dh.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
   await crypto.subtle.importKey('raw',raw,{name:'ECDH',namedCurve:'P-256'},true,[]);
   const {error}=await db.rpc('epp_register_push_device',{p_actor:actor.id,p_endpoint:s.endpoint,p_key:s.p256dh,p_auth:s.auth});if(error)throw error;
   return json({ok:true});
  }
  if(body.action==='test'){
   const {data,error}=await db.rpc('epp_prepare_push_test',{p_actor:actor.id,p_endpoint:pushEndpoint(body.endpoint)});if(error)throw error;
   if(!data?.[0])throw Error('pushapparaat_niet_gevonden');
   const result=await deliverPush(data[0],{title:'EPP-testmelding',body:'Telefoonmeldingen staan aan. Je ontvangt hier meldingen bij een verzoek om wachtwoordherstel.',url:'/?melding=wachtwoordherstel',tag:'epp-push-test'},config,webpush.generateRequestDetails.bind(webpush));
   if(result.expired)await db.from('epp_push_subscriptions').delete().eq('account_id',actor.id).eq('endpoint',data[0].endpoint);
   if(!result.sent)throw Error('testmelding_niet_verstuurd');
   return json({ok:true});
  }
  return json({ok:false,error:'onbekende_actie'},400);
 }catch(e){const code=String(e.message||'push_mislukt');return json({ok:false,error:/^[a-z_]+$/.test(code)?code:'push_mislukt'},['sessie_verlopen','geen_toegang','geen_beheerrechten'].includes(code)?401:400);}
});
