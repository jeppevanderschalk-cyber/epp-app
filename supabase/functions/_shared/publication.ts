export const PUBLICATION_VERSION='EPP_PUBLICATION_2026_10_V1';
export const ANONYMOUS_NAME='Anonieme schutter';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export async function publicationVisibility(db,ids,viewerId){
  const allowed=new Set();
  const unique=[...new Set(ids.filter(uuid))];
  for(let offset=0;offset<unique.length;offset+=200){
    const {data,error}=await db.rpc('epp_publication_states',{p_shooters:unique.slice(offset,offset+200)});if(error)throw error;
    for(const row of data||[])if(row.allowed===true||(viewerId&&row.account_id===viewerId))allowed.add(row.shooter_id);
  }
  return allowed;
}
export function hideIdentity(row,visible){
  if(visible)return row;
  return {...row,name:ANONYMOUS_NAME,club:null,publicId:null,qualification:null,publicationHidden:true};
}
export function hideTrainingNames(data,visible){
  const strip=value=>{
    if(!value||typeof value!=='object')return value;
    if(Array.isArray(value))return value.map(strip);
    return Object.fromEntries(Object.entries(value).filter(([key])=>!['name','naam','display_name','displayName','first_name','last_name','email','club','clubs','publicId','public_id','qualification'].includes(key)).map(([key,v])=>[key,strip(v)]));
  };
  const bestParcours=Object.fromEntries(Object.entries(data.bestParcours||{}).map(([id,row])=>[id,visible.has(id)?row:strip(row)]));
  const bestStageAverages=Object.fromEntries(Object.entries(data.bestStageAverages||{}).map(([stage,rows])=>[stage,Object.fromEntries(Object.entries(rows).map(([id,row])=>[id,visible.has(id)?row:strip(row)]))]));
  return {...data,bestParcours,bestStageAverages,shooters:data.shooters.map(s=>visible.has(s.id)?s:{...strip(s),naam:ANONYMOUS_NAME}),rounds:data.rounds.map(r=>visible.has(r.sid)?r:{...strip(r),naam:ANONYMOUS_NAME})};
}
export async function hideTeamIdentities(db,data,actor){
  const ids=[...(data.shooters||[]).map(s=>s.id),...(data.teams||[]).flatMap(t=>(t.members||[]).map(m=>m.id))];
  const visible=await publicationVisibility(db,ids,actor.id);
  const ownOperational=s=>actor.role==='trainer'&&actor.is_admin&&(actor.is_platform_admin||(s.clubs||[]).some(c=>c.code===actor.club_code));
  return {...data,shooters:(data.shooters||[]).map(s=>visible.has(s.id)||ownOperational(s)?s:{...hideIdentity(s,false),clubs:[]}),teams:(data.teams||[]).map(t=>({...t,members:(t.members||[]).map(m=>hideIdentity(m,visible.has(m.id)||(actor.role==='trainer'&&actor.is_admin&&(actor.is_platform_admin||t.clubCode===actor.club_code))))}))};
}
