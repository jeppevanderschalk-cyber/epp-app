import {corsHeaders,json,serviceClient} from '../_shared/epp.ts';
import {requireAccount} from '../_shared/session.ts';

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  try{
    const body=await req.json(),actor=await requireAccount(body),db=serviceClient();
    const discipline=body.discipline||'pistool';
    if(!['pistool','optiek','pcc'].includes(discipline))throw new Error('ongeldige_discipline');
    if(body.action==='context'){
      const {data,error}=await db.rpc('epp_team_context',{p_actor:actor.id,p_match:body.matchId||null,p_discipline:discipline});
      if(error)throw error;return json(data);
    }
    if(body.action==='save'||body.action==='delete'){
      if(!actor.is_admin||actor.role!=='trainer')throw new Error('geen_beheerrechten');
      const {data,error}=await db.rpc('epp_team_save',{p_actor:actor.id,p_match:body.matchId,p_discipline:discipline,p_team:body.teamId,p_number:body.number,p_members:body.members||[],p_expected:body.expectedRevision,p_delete:body.action==='delete'});
      if(error)throw error;return json(data);
    }
    return json({ok:false,error:'onbekende_actie'},400);
  }catch(e){return json({ok:false,error:e.message||'server_fout'},['geen_toegang','sessie_verlopen','geen_beheerrechten'].includes(e.message)?401:400);}
});
