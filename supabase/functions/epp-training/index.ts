import {corsHeaders,json,serviceClient} from '../_shared/epp.ts';
import {requireAccount} from '../_shared/session.ts';

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  let body:any;try{body=await req.json();}catch{return json({ok:false,error:'invalid_json'},400);}
  try{
    const actor=await requireAccount(body,body.action==='save');
    const db=serviceClient();
    if(body.action==='save'){
      if(!Array.isArray(body.ops)||body.ops.length>5000)throw new Error('ongeldige_bewerking');
      for(const op of body.ops){
        if(!['shooter','round','shot','meta','parcoursBest','stageBest','legacyScore','archive'].includes(op.kind)||typeof op.id!=='string'||op.id.length>150)throw new Error('ongeldige_bewerking');
        if(op.value!==null && (!op.value || typeof op.value!=='object'))throw new Error('ongeldige_bewerking');
        if(op.kind==='shooter' && op.value && (typeof op.value.naam!=='string'||!op.value.naam.trim()||op.value.naam.length>150||op.value.id!==op.id))throw new Error('ongeldige_schutter');
        if(op.kind==='round' && op.value && (!Number.isInteger(op.value.score)||op.value.score<0||op.value.score>(op.value.type==='parcours'?250:['s1','s4','s7'].includes(op.value.stage)?50:25)))throw new Error('ongeldige_score');
        if(op.kind==='shot' && op.value && ![0,2,3,4,5].includes(op.value.score))throw new Error('ongeldige_score');
      }
      const {data,error}=await db.rpc('epp_training_apply',{p_club:actor.club_code,p_actor:actor.id,p_ops:body.ops});
      if(error)throw error;
      return json(data);
    }
    if(body.action==='load'){
      const all:any[]=[];
      for(let offset=0;;offset+=1000){
        const {data,error}=await db.from('training_entities').select('kind,entity_id,data').eq('club_code',actor.club_code).order('kind').order('entity_id').range(offset,offset+999);
        if(error)throw error;
        all.push(...(data||[]).map(r=>({kind:r.kind,id:r.entity_id,data:r.data})));
        if(!data || data.length<1000)break;
      }
      return json({ok:true,entities:all});
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
