import {json,serviceClient,sha256Hex} from '../_shared/epp.ts';
import {processNotifications} from './delivery.ts';
Deno.serve(async req=>{
 if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
 const secret=Deno.env.get('EPP_NOTIFICATION_SECRET');
 const bearer=req.headers.get('authorization')||'';
 if(!secret||await sha256Hex(bearer)!==await sha256Hex('Bearer '+secret))return json({ok:false,error:'geen_toegang'},401);
 try{
  const result=await processNotifications(serviceClient(),{apiKey:Deno.env.get('RESEND_API_KEY'),from:Deno.env.get('EPP_NOTIFICATION_FROM')});
  return json({ok:result.configured,...result},result.configured?200:503);
 }catch{return json({ok:false,error:'meldingen_verwerken_mislukt'},500);}
});
