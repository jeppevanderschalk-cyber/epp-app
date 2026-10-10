import {corsHeaders,json,serviceClient} from '../_shared/epp.ts';
import {requireAccount} from '../_shared/session.ts';

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  let body:any;try{body=await req.json();}catch{return json({ok:false,error:'invalid_json'},400);}
  try{
    const actor=await requireAccount(body);
    const db=serviceClient();
    if(body.action==='list_matches'){
      const {data,error}=await db.from('epp_matches').select('id,organizer,location,match_date,match_dates,deadline,offered_disciplines,notes,organizer_email').eq('club_id',actor.club_code).order('match_date',{ascending:true,nullsFirst:false});
      if(error)throw error;
      const {data:planned,error:pErr}=await db.from('epp_match_planners').select('match_id,published').in('match_id',(data||[]).map(m=>m.id));if(pErr)throw pErr;
      return json({ok:true,matches:data.filter(m=>!planned.some(p=>p.match_id===m.id&&p.published)).map(m=>({...m,planning_pending:planned.some(p=>p.match_id===m.id)}))});
    }
    const {data:club,error:clubError}=await db.from('clubs').select('id').eq('code',actor.club_code).single();if(clubError)throw clubError;
    let query=db.from('shooters').select('id,display_name,memberships!inner(club_id)').eq('memberships.club_id',club.id);
    if(actor.role==='schutter')query=query.eq('linked_user_id',actor.id);
    const {data:allowed,error:allowedError}=await query;if(allowedError)throw allowedError;
    if(body.action==='list_shooters')return json({ok:true,shooters:(allowed||[]).map(s=>({id:s.id,naam:s.display_name}))});
    if(!allowed?.some(s=>s.id===body.shooterId))throw new Error('alleen_eigen_inschrijving');
    if(body.action==='my_signups'){
      const {data:matches,error:mErr}=await db.from('epp_matches').select('id').eq('club_id',actor.club_code);if(mErr)throw mErr;
      const {data,error}=await db.from('epp_signups').select('match_id,epp_signup_disciplines(discipline,time_block,specific_time)').eq('shooter_id',body.shooterId).in('match_id',(matches||[]).map(m=>m.id));if(error)throw error;
      return json({ok:true,signups:data});
    }
    if(['save_signup','delete_signup'].includes(body.action)){
      const {data,error}=await db.rpc('epp_signup_save',{p_actor:actor.id,p_club:actor.club_code,p_match:body.matchId,p_shooter:body.shooterId,p_disciplines:body.disciplines||[],p_delete:body.action==='delete_signup'});
      if(error)throw error;
      return json(data);
    }
    return json({ok:false,error:'onbekende_actie'},400);
  }catch(e){return json({ok:false,error:e.message||'server_fout'},['sessie_verlopen','geen_toegang','alleen_eigen_inschrijving'].includes(e.message)?401:400);}
});
