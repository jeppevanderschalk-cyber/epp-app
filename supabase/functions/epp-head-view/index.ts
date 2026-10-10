import {corsHeaders,json,serviceClient} from '../_shared/epp.ts';
import {requireAccount} from '../_shared/session.ts';
import {requireHeadViewer} from './access.ts';

async function allRows(query: () => any) {
  const rows:any[]=[];
  for(let offset=0;;offset+=1000){
    const {data,error}=await query().range(offset,offset+999);
    if(error)throw error;
    rows.push(...(data||[]));
    if(!data||data.length<1000)return rows;
  }
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  try{
    const body=await req.json();
    // Authenticate the original account; viewing never changes its club or session.
    const actor=await requireAccount(body);
    requireHeadViewer(actor,body.action);
    const db=serviceClient();
    if(body.action==='catalog'){
      const clubs=await allRows(()=>db.from('clubs').select('code,naam').eq('actief',true).order('code'));
      return json({ok:true,clubs});
    }
    if(typeof body.targetClubId!=='string')throw new Error('onbekende_club');
    const {data:club,error}=await db.from('clubs').select('id,code,naam').eq('code',body.targetClubId).eq('actief',true).maybeSingle();
    if(error)throw error;if(!club)throw new Error('onbekende_club');
    const entities=await allRows(()=>db.from('training_entities').select('kind,entity_id,data').eq('club_code',club.code).order('kind').order('entity_id'));
    const qualifications=await allRows(()=>db.from('shooter_qualifications').select('id,shooter_id,title,qualification_year,source,average_score,shooter:shooters!inner(memberships!inner(club_id)),division:divisions!inner(naam)').eq('shooter.memberships.club_id',club.id).eq('division.naam','EPP pistool').eq('active',true).lte('qualification_year',new Date().getFullYear()).order('qualification_year',{ascending:false}).order('id'));
    return json({ok:true,club,readOnly:true,entities:entities.map(r=>({kind:r.kind,id:r.entity_id,data:r.data})),qualifications:qualifications.map(({shooter,division,...q})=>q)});
  }catch(e){return json({ok:false,error:String(e.message||'server_fout')},/geen_|alleen_lezen|sessie_|wachtwoord_/.test(e.message)?403:400);}
});
