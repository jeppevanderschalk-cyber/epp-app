import {mollie,tokens,seal,unseal,paymentRequest,verifiedPayment,publicOrder} from './provider.ts';
export function paymentService(db,config,fetcher=fetch){
  const rpc=async(name,args)=>{const {data,error}=await db.rpc(name,args);if(error)throw error;return data;};
  const orderById=async id=>{const {data,error}=await db.from('epp_payment_orders').select('*').eq('id',id).single();if(error||!data)throw Error('betaling_niet_gevonden');return data;};
  const account=async club=>{const {data,error}=await db.from('epp_payment_accounts').select('*').eq('club_code',club).single();if(error||!data)throw Error('betaalaccount_niet_gereed');return data;};
  const access=async club=>{
    const row=await account(club);let credentials=await unseal(row.credentials,config.encryptionKey,'club:'+club);
    if(credentials.expiresAt<Date.now()+15*60*1000){
      credentials=await tokens(config,{grant_type:'refresh_token',refresh_token:credentials.refreshToken},fetcher);
      const {error}=await db.from('epp_payment_accounts').update({credentials:await seal(credentials,config.encryptionKey,'club:'+club),updated_at:new Date().toISOString()}).eq('club_code',club).eq('organization_id',row.organization_id);if(error)throw error;
    }
    return {row,credentials};
  };
  const accept=async(order,payment)=>{
    const verified=verifiedPayment(order,payment);
    if(!order.provider_id){
      const {error}=await db.from('epp_payment_orders').update({provider_id:verified.id,checkout_url:verified.checkout,expires_at:verified.expiresAt,updated_at:new Date().toISOString()}).eq('id',order.id).is('provider_id',null);if(error)throw error;
      order=await orderById(order.id);if(order.provider_id!==verified.id)throw Error('betaling_verificatie_mislukt');
    }
    await rpc('epp_payment_apply',{p_order:order.id,p_provider:verified.id,p_status:verified.status,p_refunded:verified.refunded});
    return publicOrder(await orderById(order.id));
  };
  const sync=async(order,id=order.provider_id)=>{
    if(!/^tr_[A-Za-z0-9]+$/.test(id||''))throw Error('ongeldige_betaling');
    const {row,credentials}=await access(order.club_code);
    if(row.organization_id!==order.organization_id)throw Error('betaalaccount_gewijzigd');
    return accept(order,await mollie('/v2/payments/'+id+(order.provider_mode==='test'?'?testmode=true':''),credentials.accessToken,{},fetcher));
  };
  const create=async order=>{
    if(order.provider_id)return sync(order);
    if(order.status==='review')throw Error('betaling_controle_nodig');
    // Freeze the creation token as well as the request/idempotency key. Mollie's
    // idempotency scope includes the credential. Never retry an ambiguous old POST
    // using a different token, which could create a second charge.
    if(Date.now()-Date.parse(order.created_at)>45*60*1000){
      const {error}=await db.from('epp_payment_orders').update({status:'review',last_error:'creation_needs_review'}).eq('id',order.id).is('provider_id',null);if(error)throw error;
      throw Error('betaling_controle_nodig');
    }
    if(!order.create_token){
      const {row,credentials}=await access(order.club_code);
      if(row.organization_id!==order.organization_id)throw Error('betaalaccount_gewijzigd');
      const {error}=await db.from('epp_payment_orders').update({create_token:await seal(credentials,config.encryptionKey,'order:'+order.id)}).eq('id',order.id).is('create_token',null);if(error)throw error;
      order=await orderById(order.id);
    }
    const credentials=await unseal(order.create_token,config.encryptionKey,'order:'+order.id);
    if(credentials.expiresAt<Date.now()+60000)throw Error('betaling_controle_nodig');
    const payment=await mollie('/v2/payments',credentials.accessToken,{method:'POST',body:paymentRequest(order,config),key:'epp-payment/'+order.id},fetcher);
    return accept(order,payment);
  };
  const retryReview=async(actor,order,id=order.provider_id)=>{
    if(!/^tr_[A-Za-z0-9]+$/.test(id||''))throw Error('ongeldige_betaling');
    const {row,credentials}=await access(order.club_code);
    if(row.organization_id!==order.organization_id)throw Error('betaalaccount_gewijzigd');
    const payment=await mollie('/v2/payments/'+id+(order.provider_mode==='test'?'?testmode=true':''),credentials.accessToken,{},fetcher);
    const verified=verifiedPayment(order,payment);
    if(verified.status!=='paid'||verified.refunded>0)throw Error('betaling_controle_nodig');
    await accept(order,payment);
    await rpc('epp_payment_retry_review',{p_actor:actor.id,p_order:order.id});
    return publicOrder(await orderById(order.id));
  };
  return {rpc,account,access,orderById,sync,create,accept,retryReview};
}
