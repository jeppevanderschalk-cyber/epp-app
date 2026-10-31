import {corsHeaders,json,serviceClient,sha256Hex} from '../_shared/epp.ts';
import {requireAccount} from '../_shared/session.ts';
import {configured,SCOPES,tokens,mollie,seal,publicOrder} from './provider.ts';
import {paymentService} from './service.ts';

const config={clientId:Deno.env.get('MOLLIE_CLIENT_ID'),clientSecret:Deno.env.get('MOLLIE_CLIENT_SECRET'),encryptionKey:Deno.env.get('EPP_PAYMENT_ENCRYPTION_KEY'),publicUrl:Deno.env.get('EPP_PUBLIC_APP_URL')||'https://epp-app.nl/',functionUrl:Deno.env.get('SUPABASE_URL')+'/functions/v1/epp-payments'};
const ready=configured(config),enabled=ready&&Deno.env.get('EPP_PAYMENTS_ENABLED')==='true'&&!!Deno.env.get('EPP_PAYMENT_WORKER_SECRET');
const safeError=e=>{
  const message=String(e?.message||'');
  return /^(geen_|sessie_|persoonlijk_|betaling_|betalingen_|betaalaccount_|betaalde_|betaalinstelling_|bestaande_inschrijvingen_|alleen_standaard_|ongeldige_|ongeldig_|tijdslot_|boeking_|discipline_|dubbele_|overlappende_|inschrijving_|wedstrijd_|betaaldienst_|wachtwoord_|vereniging_)/.test(message)?message:'betaling_verwerken_mislukt';
};
const redirect=status=>new Response(null,{status:303,headers:{Location:config.publicUrl+'?payments='+status,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  const url=new URL(req.url),route=url.searchParams.get('route');
  const db=serviceClient(),service=paymentService(db,config);
  try{
    if(route==='oauth_callback'&&req.method==='GET'){
      if(!ready)return redirect('not_configured');
      const state=url.searchParams.get('state');if(!/^[a-f0-9]{64}$/.test(state||''))return redirect('failed');
      const {data:states,error}=await db.from('epp_payment_oauth_states').delete().eq('token_hash',await sha256Hex(state)).gt('expires_at',new Date().toISOString()).select('*');if(error)throw error;
      const stateRow=states?.[0];if(!stateRow||url.searchParams.has('error')||!url.searchParams.get('code'))return redirect('failed');
      const {data:actor}=await db.from('app_accounts').select('*').eq('id',stateRow.actor_id).single();
      if(!actor?.active||actor.deleted_at||actor.role!=='trainer'||!actor.is_admin||!(actor.club_code===stateRow.club_code||actor.is_platform_admin))return redirect('failed');
      const credentials=await tokens(config,{grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:config.functionUrl+'?route=oauth_callback'});
      const organization=await mollie('/v2/organizations/me',credentials.accessToken);
      if(!/^org_[A-Za-z0-9]+$/.test(organization.id||''))throw Error('ongeldig_providerantwoord');
      const {data:old}=await db.from('epp_payment_accounts').select('organization_id,profile_id').eq('club_code',stateRow.club_code).maybeSingle();
      if(old&&old.organization_id!==organization.id)throw Error('betaalaccount_gewijzigd');
      const {error:saveError}=await db.from('epp_payment_accounts').upsert({club_code:stateRow.club_code,organization_id:organization.id,organization_name:organization.name||stateRow.club_code,profile_id:old?.profile_id||null,credentials:await seal(credentials,config.encryptionKey,'club:'+stateRow.club_code),can_receive:false,updated_at:new Date().toISOString()});if(saveError)throw saveError;
      const {error:auditError}=await db.from('epp_payment_audit').insert({actor_id:actor.id,club_code:stateRow.club_code,action:'connect_account'});if(auditError)throw auditError;
      return redirect('connected');
    }
    if(route==='webhook'&&req.method==='POST'){
      if(!ready)return json({ok:false},503);
      const orderId=url.searchParams.get('order');if(!uuid(orderId))return json({ok:false},400);
      const body=await req.text();if(body.length>2048)return json({ok:false},400);
      const id=new URLSearchParams(body).get('id');
      // A webhook is a notification, never proof of payment. Fetch from the
      // frozen recipient's account and verify every field before committing.
      await service.sync(await service.orderById(orderId),id);
      return json({ok:true});
    }
    if(route==='reconcile'&&req.method==='POST'){
      const secret=Deno.env.get('EPP_PAYMENT_WORKER_SECRET');
      if(!ready||!secret||await sha256Hex(req.headers.get('authorization')||'')!==await sha256Hex('Bearer '+secret))return json({ok:false,error:'geen_toegang'},401);
      const {data:orders,error}=await db.from('epp_payment_orders').select('*').in('status',['creating','open','pending']).order('updated_at').limit(20);if(error)throw error;
      let checked=0,failed=0;
      for(const order of orders||[])try{if(!order.provider_id&&!enabled)continue;await (order.provider_id?service.sync(order):service.create(order));checked++;}catch{failed++;}
      return json({ok:true,checked,failed});
    }
    if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
    const body=await req.json(),actor=await requireAccount(body);
    const {data:match,error:matchError}=await db.from('epp_matches').select('id,club_id,organizer,payment_required,archived_at').eq('id',body.matchId).single();if(matchError||!match||match.archived_at)throw Error('wedstrijd_niet_beschikbaar');
    const {data:planner}=await db.from('epp_match_planners').select('owner_club').eq('match_id',match.id).maybeSingle();
    const owner=planner?.owner_club||match.club_id;
    const managing=actor.role==='trainer'&&actor.is_admin&&(actor.club_code===owner||actor.is_platform_admin);
    if(body.action==='settings'){
      if(!managing)throw Error('geen_beheerrechten');
      const {data:account,error}=await db.from('epp_payment_accounts').select('organization_id,organization_name,profile_id,can_receive').eq('club_code',owner).maybeSingle();if(error)throw error;
      const {data:runtime}=await db.from('epp_payment_runtime').select('enabled,mode').eq('singleton',true).single();
      return json({ok:true,configured:ready,enabled:enabled&&runtime?.enabled===true,required:match.payment_required,unitPriceCents:1200,testMode:runtime?.mode==='test',ownerClub:owner,account});
    }
    if(['connect','profiles','select_profile','configure'].includes(body.action)){
      if(!managing)throw Error('geen_beheerrechten');
      if(!ready)throw Error('betaalaccount_niet_gereed');
      if(body.action==='connect'){
        const state=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
        const {error}=await db.from('epp_payment_oauth_states').insert({token_hash:await sha256Hex(state),club_code:owner,actor_id:actor.id,expires_at:new Date(Date.now()+10*60*1000).toISOString()});if(error)throw error;
        const consent=new URL('https://my.mollie.com/oauth2/authorize');consent.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.functionUrl+'?route=oauth_callback',state,scope:SCOPES,response_type:'code',locale:'nl_NL'}).toString();
        return json({ok:true,url:consent.href});
      }
      if(body.action==='configure'){
        if(typeof body.required!=='boolean')throw Error('ongeldige_betaalinstelling');
        if(body.required&&!enabled)throw Error('betalingen_nog_niet_actief');
        if(body.required){const {credentials}=await service.access(owner);const onboarding=await mollie('/v2/onboarding/me',credentials.accessToken);if(!onboarding.canReceivePayments)throw Error('betaalaccount_niet_gereed');}
        await service.rpc('epp_payment_configure',{p_actor:actor.id,p_match:match.id,p_enabled:body.required});return json({ok:true});
      }
      const {credentials}=await service.access(owner);
      if(body.action==='profiles'){
        let path='/v2/profiles?limit=250',profiles=[];
        do{const page=await mollie(path,credentials.accessToken);profiles.push(...(page._embedded?.profiles||[]).map(p=>({id:p.id,name:p.name,website:p.website})));const next=page._links?.next?.href;path=next&&new URL(next).origin==='https://api.mollie.com'?new URL(next).pathname+new URL(next).search:null;}while(path&&profiles.length<1000);
        return json({ok:true,profiles});
      }
      if(!/^pfl_[A-Za-z0-9]+$/.test(body.profileId||''))throw Error('ongeldig_betaalprofiel');
      const profile=await mollie('/v2/profiles/'+body.profileId,credentials.accessToken);
      const onboarding=await mollie('/v2/onboarding/me',credentials.accessToken);
      if(profile.id!==body.profileId)throw Error('ongeldig_betaalprofiel');
      const {error}=await db.from('epp_payment_accounts').update({profile_id:profile.id,can_receive:onboarding.canReceivePayments===true,updated_at:new Date().toISOString()}).eq('club_code',owner);if(error)throw error;
      const {error:auditError}=await db.from('epp_payment_audit').insert({actor_id:actor.id,club_code:owner,action:'select_profile:'+profile.id});if(auditError)throw auditError;
      return json({ok:true,canReceive:onboarding.canReceivePayments===true});
    }
    const {data:profile}=await db.from('shooters').select('id').eq('linked_user_id',actor.id).maybeSingle();
    if(body.action==='retry_review'){
      if(!managing)throw Error('geen_beheerrechten');
      if(!uuid(body.orderId))throw Error('ongeldige_betaling');
      const order=await service.orderById(body.orderId);
      if(order.match_id!==match.id||order.status!=='review')throw Error('ongeldige_betaling');
      return json({ok:true,order:await service.retryReview(actor,order,body.providerId||order.provider_id)});
    }
    if(body.action==='checkout'){
      if(!enabled)throw Error('betalingen_nog_niet_actief');
      const order=await service.rpc('epp_payment_reserve',{p_actor:actor.id,p_match:match.id,p_choices:body.choices,p_expected:body.expectedRevision});
      return json({ok:true,order:await service.create(order)});
    }
    if(body.action==='status'){
      if(!uuid(body.orderId))throw Error('ongeldige_betaling');
      const order=await service.orderById(body.orderId);
      if(order.match_id!==match.id||(!managing&&order.shooter_id!==profile?.id))throw Error('geen_toegang');
      return json({ok:true,order:order.provider_id?await service.sync(order):publicOrder(order)});
    }
    throw Error('onbekende_actie');
  }catch(e){
    if(route==='oauth_callback')return redirect('failed');
    const message=safeError(e);return json({ok:false,error:message},route==='webhook'?503:['geen_toegang','geen_beheerrechten','sessie_verlopen'].includes(message)?401:400);
  }
});
