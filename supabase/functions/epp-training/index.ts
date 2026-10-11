import {trainingStandings} from '../_shared/training-standings.ts';
import {corsHeaders,json,serviceClient} from '../_shared/epp.ts';
import {requireAccount} from '../_shared/session.ts';

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  let body:any;try{body=await req.json();}catch{return json({ok:false,error:'invalid_json'},400);}
  try{
    const actor=await requireAccount(body);
    const db=serviceClient();
    if(body.action==='standings'){
      const target=actor.is_platform_admin?String(body.targetClubId||actor.club_code):actor.club_code;
      if(!actor.is_platform_admin&&body.targetClubId&&body.targetClubId!==actor.club_code)throw new Error('geen_toegang');
      const allRows=async(make:any)=>{const rows:any[]=[];for(let n=0;;n+=1000){const {data,error}=await make().range(n,n+999);if(error)throw error;rows.push(...data);if(data.length<1000)return rows;}};
      const accounts=await allRows(()=>db.from('app_accounts').select('id').eq('club_code',target).eq('active',true).eq('membership_approved',true).is('deleted_at',null).neq('username','kijker').order('id'));
      const profiles:any[]=[],sources:any[]=[];
      for(let n=0;n<accounts.length;n+=100){
        const ids=accounts.slice(n,n+100).map(a=>a.id);
        const linked=await allRows(()=>db.from('shooters').select('id,display_name,linked_user_id').in('linked_user_id',ids).order('id'));profiles.push(...linked);
        const entries=await allRows(()=>db.from('epp_personal_training_entities').select('account_id,kind,entity_id,data').in('account_id',ids).order('account_id').order('kind').order('entity_id'));
        for(const a of ids)sources.push({allowed:linked.filter(p=>p.linked_user_id===a).map(p=>p.id),entities:entries.filter(e=>e.account_id===a).map(e=>({kind:e.kind,id:e.entity_id,data:e.data}))});
      }
      const clubEntries=await allRows(()=>db.from('training_entities').select('kind,entity_id,data').eq('club_code',target).order('kind').order('entity_id'));
      sources.push({clubSettings:true,entities:clubEntries.map(e=>({kind:e.kind,id:e.entity_id,data:e.data}))});
      if(target!=='eppnationaal'){
        const national=await allRows(()=>db.from('training_entities').select('kind,entity_id,data').eq('club_code','eppnationaal').order('kind').order('entity_id'));
        sources.push({allowed:profiles.map(p=>p.id),entities:national.map(e=>({kind:e.kind,id:e.entity_id,data:e.data}))});
      }
      return json({ok:true,...trainingStandings(sources,profiles)});
    }
    const personal=actor.role==='schutter';
    let profile:any=null;
    if(personal){
      const {data,error}=await db.from('shooters').select('id,display_name').eq('linked_user_id',actor.id).single();if(error)throw error;profile=data;
      if(!['load','save'].includes(body.action))throw new Error('geen_schrijfrechten');
    }
    const ownEntities=(entities:any[])=>personal?[...entities,{kind:'shooter',id:profile.id,data:{id:profile.id,naam:profile.display_name}}]:entities;
    const registeredShooters=async()=>{
      const accounts:any[]=[];
      for(let offset=0;;offset+=1000){
        let accountsQuery=db.from('app_accounts').select('id');
        if(!actor.is_platform_admin)accountsQuery=accountsQuery.eq('club_code',actor.club_code);
        const {data,error}=await accountsQuery.eq('active',true).eq('membership_approved',true).is('deleted_at',null).neq('username','kijker').order('id').range(offset,offset+999);
        if(error)throw error;
        accounts.push(...(data||[]));if(!data||data.length<1000)break;
      }
      const shooters:any[]=[];
      for(let offset=0;offset<accounts.length;offset+=100){
        const {data,error}=await db.from('shooters').select('id,display_name,linked_user_id').in('linked_user_id',accounts.slice(offset,offset+100).map(a=>a.id));
        if(error)throw error;shooters.push(...(data||[]));
      }
      return shooters.sort((a,b)=>a.display_name.localeCompare(b.display_name,'nl'));
    };
    if(body.action==='list_registered_shooters'){
      if(actor.role!=='trainer')throw new Error('geen_schrijfrechten');
      return json({ok:true,shooters:(await registeredShooters()).map(s=>({id:s.id,display_name:s.display_name}))});
    }
    if(body.action==='save'){
      if(!Array.isArray(body.ops)||body.ops.length>5000)throw new Error('ongeldige_bewerking');
      for(const op of body.ops){
        if(!['shooter','round','shot','meta','parcoursBest','stageBest','legacyScore','archive'].includes(op.kind)||typeof op.id!=='string'||op.id.length>150)throw new Error('ongeldige_bewerking');
        if(op.value!==null && (!op.value || typeof op.value!=='object'))throw new Error('ongeldige_bewerking');
        if(op.kind==='shooter' && op.value && (typeof op.value.naam!=='string'||!op.value.naam.trim()||op.value.naam.length>150||op.value.id!==op.id))throw new Error('ongeldige_schutter');
        if(op.kind==='round' && op.value && (!Number.isInteger(op.value.score)||op.value.score<0||op.value.score>(op.value.type==='parcours'?250:['s1','s4','s7'].includes(op.value.stage)?50:25)))throw new Error('ongeldige_score');
        if(op.kind==='shot' && op.value && ![0,2,3,4,5].includes(op.value.score))throw new Error('ongeldige_score');
      }
      const shooterOps=body.ops.filter(op=>op.kind==='shooter'&&op.value);
      if(shooterOps.length){
        const allowed=new Map((await registeredShooters()).map(s=>[s.id,s.display_name]));
        for(const op of shooterOps){
          // Preserve existing legacy entries; newly added or renamed entries require an account.
          if(op.expected && op.expected.id===op.id && op.expected.naam===op.value.naam)continue;
          if(allowed.get(op.id)!==op.value.naam)throw new Error('persoonlijk_account_verplicht');
        }
      }
      const {data,error}=await db.rpc(personal?'epp_personal_training_apply':'epp_training_apply',{p_club:actor.club_code,p_actor:actor.id,p_ops:body.ops});
      if(error)throw error;
      return json({...data,entities:ownEntities(data.entities||[])});
    }
    if(body.action==='load'){
      const all:any[]=[];
      for(let offset=0;;offset+=1000){
        const {data,error}=await db.from(personal?'epp_personal_training_entities':'training_entities').select('kind,entity_id,data').eq(personal?'account_id':'club_code',personal?actor.id:actor.club_code).order('kind').order('entity_id').range(offset,offset+999);
        if(error)throw error;
        all.push(...(data||[]).map(r=>({kind:r.kind,id:r.entity_id,data:r.data})));
        if(!data || data.length<1000)break;
      }
      return json({ok:true,entities:ownEntities(all)});
    }
    if(body.action==='backup_status' && actor.is_admin){
      const {data,error}=await db.from('platform_backups').select('id,created_at,checksum').order('created_at',{ascending:false}).limit(20);
      if(error)throw error;
      return json({ok:true,backup:data?.[0]||null,backups:data||[]});
    }
    if(body.action==='backup_now' && actor.is_admin){
      const {data,error}=await db.rpc('epp_capture_backup');if(error)throw error;
      return json({ok:true,backupId:data});
    }
    if(body.action==='restore_preview' && actor.is_admin){
      const {data:backup,error}=await db.from('platform_backups').select('id,created_at,snapshot').eq('id',body.backupId).single();if(error)throw error;
      const {data:latest,error:stampError}=await db.from('training_entities').select('updated_at').eq('club_code',actor.club_code).order('updated_at',{ascending:false}).limit(1);if(stampError)throw stampError;
      const items=(backup.snapshot.training_entities||[]).filter(r=>r.club_code===actor.club_code&&r.data!==null);
      return json({ok:true,backupId:backup.id,createdAt:backup.created_at,expectedStamp:latest?.[0]?.updated_at||null,shooters:items.filter(r=>r.kind==='shooter').length,rounds:items.filter(r=>r.kind==='round').length,archives:items.filter(r=>r.kind==='archive').length});
    }
    if(body.action==='restore_training' && actor.is_admin){
      if(body.confirm!==body.backupId)throw new Error('bevestiging_verplicht');
      const {error}=await db.rpc('epp_restore_training',{p_actor:actor.id,p_backup:body.backupId,p_expected:body.expectedStamp});if(error)throw error;
      return json({ok:true});
    }
    return json({ok:false,error:'onbekende_actie'},400);
  }catch(e){const msg=String(e.message||'server_fout');return json({ok:false,error:msg},msg.includes('conflict')?409:['sessie_verlopen','geen_toegang','geen_schrijfrechten'].includes(msg)?401:400);}
});
