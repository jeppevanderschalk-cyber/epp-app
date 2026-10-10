import {corsHeaders,json,serviceClient} from '../_shared/epp.ts';
import {requireAccount} from '../_shared/session.ts';

async function rows(query:()=>any){
  const all:any[]=[];
  for(let offset=0;;offset+=1000){const {data,error}=await query().range(offset,offset+999);if(error)throw error;all.push(...data);if(data.length<1000)return all;}
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  try{
    const body=await req.json(),actor=await requireAccount(body),db=serviceClient();
    const rpc=async(name:string,args:any)=>{const {data,error}=await db.rpc(name,args);if(error)throw error;return data;};
    if(body.action==='catalog'){
      const states=await rows(()=>db.from('epp_scoring_matches').select('*,match:epp_matches(id,organizer,match_date,offered_disciplines)').order('match_id'));
      const assignments=await rows(()=>db.from('epp_match_scorers').select('match_id').eq('account_id',actor.id).order('match_id'));
      const head=actor.role==='trainer'&&actor.is_admin&&actor.is_platform_admin;
      const own=actor.role==='trainer'&&actor.is_admin?await rows(()=>{
        let query=db.from('epp_match_planners').select('owner_club,match:epp_matches(id,organizer,match_date,offered_disciplines)').eq('published',true).order('match_id');
        if(!head)query=query.eq('owner_club',actor.club_code);
        return query;
      }):[];
      const allowed=states.filter(s=>head||(actor.role==='trainer'&&actor.is_admin&&s.owner_club===actor.club_code)||assignments.some(a=>a.match_id===s.match_id));
      return json({ok:true,matches:[...allowed.map(s=>({...s.match,scoring:true,can_score:!s.closed,closed:s.closed})),...own.filter(p=>!states.some(s=>s.organizer===p.match.organizer&&s.match_date===p.match.match_date)).map(p=>({...p.match,scoring:true,can_score:true,closed:false}))]});
    }
    const access=await rpc('epp_scoring_prepare',{p_actor:actor.id,p_match:body.matchId});
    const matchId=access.matchId,discipline=body.discipline||'pistool';
    if(body.action==='control'){
      await rpc('epp_scoring_control',{p_actor:actor.id,p_match:matchId,p_action:body.control,p_target:body.accountId||null,p_enabled:body.enabled===true,p_expected:body.expectedRevision});
      return json({ok:true});
    }
    if(['claim','release'].includes(body.action)){
      const lease=await rpc('epp_scoring_lease',{p_actor:actor.id,p_match:matchId,p_shooter:body.shooterId,p_discipline:discipline,p_token:body.leaseToken,p_release:body.action==='release'});
      return json({ok:true,lease});
    }
    if(body.action==='confirm_result'){
      if(body.roundId!==access.roundId)throw new Error('ongeldige_ronde');
      const result=await rpc('epp_scoring_submit',{p_actor:actor.id,p_match:matchId,p_shooter:body.shooterId,p_discipline:discipline,p_token:body.leaseToken,p_counts:{hits5:body.hits5,hits4:body.hits4,hits3:body.hits3,hits2:body.hits2,misses:body.misses,penaltyPoints:body.penaltyPoints,rapid:body.rapid,rapidTimeMs:body.rapidTimeMs,totalTimeMs:body.totalTimeMs,penaltyTimeMs:body.penaltyTimeMs,penaltyReason:body.penaltyReason},p_key:body.idempotencyKey,p_expected:body.expectedRevision,p_reason:body.reason||''});
      return json({ok:true,result});
    }
    const {data:division,error:dErr}=await db.from('divisions').select('id').eq('naam',discipline==='optiek'?'Open':'EPP pistool').single();if(dErr)throw dErr;
    if(body.action==='get_result'){
      const {data:result,error}=await db.from('results').select('*').eq('round_id',access.roundId).eq('shooter_id',body.shooterId).eq('division_id',division.id).maybeSingle();if(error)throw error;
      return json({ok:true,result});
    }
    if(body.action==='prepare_match')return json({ok:true,round:{id:access.roundId},access});
    if(body.action!=='view'&&body.action!=='match_participants')throw new Error('onbekende_actie');
    const signups=await rows(()=>db.from('epp_signups').select('shooter:shooters(id,display_name,public_id,home_club:clubs!shooters_home_club_id_fkey(naam)),disciplines:epp_signup_disciplines(discipline,specific_time)').eq('match_id',matchId).order('id'));
    const leases=await rows(()=>db.from('epp_score_leases').select('shooter_id,discipline,actor_id,expires_at').eq('match_id',matchId).gt('expires_at',new Date().toISOString()).order('shooter_id'));
    const shooters=signups.filter(s=>s.shooter&&s.disciplines.some((d:any)=>d.discipline===discipline)).map(s=>({...s.shooter,club:s.shooter.home_club?.naam,lease:leases.find(l=>l.shooter_id===s.shooter.id&&l.discipline===discipline)||null}));
    const accounts=access.managing?await rows(()=>db.from('app_accounts').select('id,display_name,club_code').eq('active',true).eq('must_change_password',false).like('username','lid.%').order('id')):[];
    const scorers=access.managing?await rows(()=>db.from('epp_match_scorers').select('account_id').eq('match_id',matchId).order('account_id')):[];
    const {data:audit,error:auditError}=access.managing?await db.from('result_audit').select('actor_id,action,reason,created_at,result:results!inner(round_id,shooter_id,final_score)').eq('result.round_id',access.roundId).order('created_at',{ascending:false}).limit(30):{data:[],error:null};if(auditError)throw auditError;
    return json({ok:true,...access,planned:true,shooters,accounts,scorers,audit});
  }catch(e){const message=String(e.message||'server_fout');return json({ok:false,error:message},/conflict|in_bewerking/.test(message)?409:/geen_|sessie_/.test(message)?403:400);}
});
