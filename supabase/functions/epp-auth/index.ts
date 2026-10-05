import {corsHeaders,json,serviceClient,isKnownClub,checkPassword,sha256Hex} from '../_shared/epp.ts';
import {passwordHash,randomSalt} from '../_shared/trainer-auth.ts';
import {requireAccount,createSession} from '../_shared/session.ts';

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  let body:any;try{body=await req.json();}catch{return json({ok:false,error:'invalid_json'},400);}
  if(!isKnownClub(body.clubId))return json({ok:false,error:'onbekende_club'},403);
  const db=serviceClient();
  try{
    if(body.action==='login'){
      if(typeof body.password!=='string'||body.password.length>256)return json({ok:false,error:'ongeldig_wachtwoord'},401);
      let username=String(body.username||'').trim().toLowerCase();
      if(!username){
        if(await checkPassword(body.clubId,body.password,'TRAINER'))username='beheer';
        else if(await checkPassword(body.clubId,body.password,'MEMBER'))username='kijker';
        else return json({ok:false,error:'ongeldig_wachtwoord'},401);
      }
      const {data:account,error}=await db.from('app_accounts').select('*').eq('club_code',body.clubId).eq('username',username).maybeSingle();
      if(error)throw error;
      if(!account?.active || account.locked_until && Date.parse(account.locked_until)>Date.now())return json({ok:false,error:'ongeldig_wachtwoord'},401);
      const valid=account.legacy ? await checkPassword(body.clubId,body.password,account.role==='trainer'?'TRAINER':'MEMBER') : await passwordHash(body.password,account.password_salt,account.iterations)===account.password_hash;
      if(!valid){await db.rpc('epp_account_failure',{p_id:account.id});return json({ok:false,error:'ongeldig_wachtwoord'},401);}
      const salt=account.legacy?randomSalt():account.password_salt;
      const {error:updateError}=await db.from('app_accounts').update({legacy:false,password_salt:salt,password_hash:account.legacy?await passwordHash(body.password,salt):account.password_hash,failed_attempts:0,locked_until:null}).eq('id',account.id);
      if(updateError)throw updateError;
      return json({ok:true,...await createSession(db,account)});
    }
    const actor=await requireAccount(body);
    if(body.action==='session')return json({ok:true,account:{id:actor.id,username:actor.username,displayName:actor.display_name,role:actor.role,clubId:actor.club_code,isAdmin:actor.is_admin}});
    if(body.action==='logout'){
      const {error}=await db.from('app_sessions').delete().eq('token_hash',await sha256Hex(body.sessionToken));if(error)throw error;
      return json({ok:true});
    }
    if(body.action==='change_password'){
      if(typeof body.newPassword!=='string'||body.newPassword.length<10||body.newPassword.length>256||body.newPassword===body.password)return json({ok:false,error:'nieuw_wachtwoord_ongeldig'},400);
      const {data:old,error}=await db.from('app_accounts').select('*').eq('id',actor.id).single();if(error)throw error;
      if(await passwordHash(String(body.password||''),old.password_salt,old.iterations)!==old.password_hash)return json({ok:false,error:'ongeldig_wachtwoord'},401);
      const salt=randomSalt();
      const {error:changeError}=await db.rpc('epp_change_account_password',{p_actor:actor.id,p_old_hash:old.password_hash,p_salt:salt,p_hash:await passwordHash(body.newPassword,salt)});
      if(changeError)throw changeError;
      return json({ok:true});
    }
    if(!actor.is_admin || actor.role!=='trainer')throw new Error('geen_beheerrechten');
    if(body.action==='list_accounts'){
      const {data,error}=await db.from('app_accounts').select('id,username,display_name,role,is_admin,active').eq('club_code',actor.club_code).order('display_name');if(error)throw error;
      return json({ok:true,accounts:data});
    }
    if(body.action==='create_account'){
      const username=String(body.username||'').trim().toLowerCase(),name=String(body.displayName||'').trim();
      if(!/^[a-z0-9._-]{3,50}$/.test(username)||name.length<2||name.length>100||typeof body.newPassword!=='string'||body.newPassword.length<10||body.newPassword.length>256)throw new Error('ongeldige_accountgegevens');
      const salt=randomSalt();
      const {data,error}=await db.rpc('epp_create_account',{p_actor:actor.id,p_username:username,p_name:name,p_role:body.role==='schutter'?'schutter':'trainer',p_admin:body.isAdmin===true,p_salt:salt,p_hash:await passwordHash(body.newPassword,salt),p_shooter:body.role==='schutter'?body.shooterId:null});
      if(error)throw error;
      return json({ok:true,accountId:data});
    }
    if(body.action==='disable_account'){
      if(body.accountId===actor.id)throw new Error('eigen_account_niet_blokkeren');
      const {error}=await db.rpc('epp_disable_account',{p_actor:actor.id,p_target:body.accountId});
      if(error)throw error;
      return json({ok:true});
    }
    return json({ok:false,error:'onbekende_actie'},400);
  }catch(e){return json({ok:false,error:String(e.message||'server_fout')},['sessie_verlopen','geen_toegang','geen_beheerrechten'].includes(e.message)?401:400);}
});
