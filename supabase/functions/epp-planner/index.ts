import {corsHeaders,json,serviceClient} from '../_shared/epp.ts';
import {requireAccount} from '../_shared/session.ts';

async function allRows(query:()=>any){
  const rows:any[]=[];
  for(let offset=0;;offset+=1000){const {data,error}=await query().range(offset,offset+999);if(error)throw error;rows.push(...data);if(data.length<1000)return rows;}
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  try{
    const body=await req.json();const actor=await requireAccount(body);const db=serviceClient();
    if(body.action==='catalog'){
      const matches=await allRows(()=>db.from('epp_match_planners').select('match_id,published,owner_club,match:epp_matches(id,organizer,location,match_date,match_dates,offered_disciplines)').eq('published',true).order('match_id'));
      const {data:profile,error:profileError}=await db.from('shooters').select('id').eq('linked_user_id',actor.id).maybeSingle();if(profileError)throw profileError;
      if(profile){
        const mine=await allRows(()=>db.from('epp_signups').select('match_id').eq('shooter_id',profile.id).order('id'));
        if(mine.length){const unpublished=await allRows(()=>db.from('epp_match_planners').select('match_id,published,owner_club,match:epp_matches(id,organizer,location,match_date,match_dates,offered_disciplines)').eq('published',false).in('match_id',mine.map(m=>m.match_id)).order('match_id'));matches.push(...unpublished);}
      }
      return json({ok:true,matches:matches.map(p=>p.match).filter(Boolean).sort((a,b)=>String(a.match_date).localeCompare(String(b.match_date)))});
    }
    const {data:match,error:matchError}=await db.from('epp_matches').select('*').eq('id',body.matchId).single();if(matchError)throw new Error('wedstrijd_niet_gevonden');
    const {data:planner,error:pErr}=await db.from('epp_match_planners').select('*').eq('match_id',match.id).maybeSingle();if(pErr)throw pErr;
    const managing=actor.role==='trainer'&&actor.is_admin&&actor.club_code===(planner?.owner_club||match.club_id);
    if(body.action==='configure'){
      if(!managing)throw new Error('geen_beheerrechten');
      const {data,error}=await db.rpc('epp_planner_configure',{p_actor:actor.id,p_match:match.id,p_config:body.config,p_expected:body.expectedRevision});if(error)throw error;
      return json({ok:true,planner:data});
    }
    if(!planner&&!managing)throw new Error('planner_niet_beschikbaar');
    const {data:profile,error:profileError}=await db.from('shooters').select('id,display_name,public_id').eq('linked_user_id',actor.id).maybeSingle();if(profileError)throw profileError;
    if(planner&&!planner.published&&!managing){
      const {data:mine,error:mineError}=await db.from('epp_signups').select('id').eq('match_id',match.id).eq('shooter_id',profile?.id||'00000000-0000-0000-0000-000000000000').maybeSingle();if(mineError)throw mineError;if(!mine)throw new Error('planner_niet_beschikbaar');
    }
    if(body.action==='book'){
      const shooterId=managing&&body.shooterId?body.shooterId:profile?.id;
      if(!shooterId)throw new Error('persoonlijk_schutterprofiel_verplicht');
      const {data,error}=await db.rpc('epp_planner_book',{p_actor:actor.id,p_match:match.id,p_shooter:shooterId,p_choices:body.choices,p_expected:body.expectedRevision,p_reason:body.reason||''});if(error)throw error;
      return json(data);
    }
    if(body.action==='view'){
      const slots=planner?await allRows(()=>db.from('epp_match_slots').select('*').eq('match_id',match.id).order('starts_at')):[];
      const signups=await allRows(()=>db.from('epp_signups').select('id,shooter_id,shooter_name,planner_revision,epp_signup_disciplines(discipline,slot_id,specific_time,time_block)').eq('match_id',match.id).order('id'));
      const counts=new Map();for(const s of signups)for(const d of s.epp_signup_disciplines)if(d.slot_id)counts.set(d.slot_id,(counts.get(d.slot_id)||0)+1);
      let roster:any[]=[],audit:any[]=[];
      if(managing){
        const ids=signups.map(s=>s.shooter_id).filter(Boolean);const profiles=ids.length?await allRows(()=>db.from('shooters').select('id,public_id,memberships(club:clubs(naam))').in('id',ids).order('id')):[];
        roster=signups.filter(s=>s.epp_signup_disciplines.length).map(s=>{const p=profiles.find(p=>p.id===s.shooter_id);return {shooterId:s.shooter_id,name:s.shooter_name,publicId:p?.public_id,clubs:[...new Set((p?.memberships||[]).map((m:any)=>m.club?.naam).filter(Boolean))],revision:s.planner_revision,preferences:s.epp_signup_disciplines.filter((d:any)=>!d.slot_id),choices:s.epp_signup_disciplines.map((d:any)=>({discipline:d.discipline,slotId:d.slot_id}))};});
        const {data,error}=await db.from('epp_planner_audit').select('id,action,actor_id,reason,created_at').eq('match_id',match.id).order('created_at',{ascending:false}).limit(20);if(error)throw error;audit=data;
      }
      const mine=signups.find(s=>s.shooter_id===profile?.id);
      return json({ok:true,match:{id:match.id,organizer:match.organizer,location:match.location,match_date:match.match_date,match_dates:match.match_dates,deadline:match.deadline,offered_disciplines:match.offered_disciplines},planner,managing,profile,slots:slots.map(s=>({...s,booked:counts.get(s.id)||0})),mine:{revision:mine?.planner_revision||0,choices:(mine?.epp_signup_disciplines||[]).map((d:any)=>({discipline:d.discipline,slotId:d.slot_id}))},roster,audit});
    }
    return json({ok:false,error:'onbekende_actie'},400);
  }catch(e){return json({ok:false,error:e.message||'server_fout'},['sessie_verlopen','geen_toegang','geen_beheerrechten','alleen_eigen_inschrijving'].includes(e.message)?401:400);}
});
