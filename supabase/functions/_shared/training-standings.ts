import '../../../score-ranking.js';
const rules=(globalThis as any).EppScoreRanking;
export function trainingStandings(sources:any[],profiles:any[]=[]){
 const names=new Map(profiles.map(p=>[p.id,p.display_name])),bestParcours:any={},bestStageAverages:any={},rounds=new Map();let stageShots:any={};
 const best=(sid:string,r:any)=>{if(!bestParcours[sid]||rules.compare({...r,final_score:r.score},{...bestParcours[sid],final_score:bestParcours[sid].score})<0)bestParcours[sid]=r;};
 const stage=(sid:string,key:string,r:any)=>{const items=bestStageAverages[key]||={};if(!items[sid]||r.avg>items[sid].avg)items[sid]=r;};
 for(const source of sources){
  const allowed=(sid:string)=>!source.allowed||source.allowed.includes(sid);
  for(const e of source.entities){if(!e.data)continue;const d=e.data;
   if(e.kind==='shooter'&&allowed(e.id)&&!names.has(e.id))names.set(e.id,d.naam);
   if(e.kind==='meta'&&e.id==='stageShots'&&source.clubSettings)stageShots=d;
   if(e.kind==='parcoursBest'&&allowed(e.id))best(e.id,d);
   if(e.kind==='stageBest'){const [key,sid]=e.id.split(':');if(allowed(sid))stage(sid,key,d);}
   const entries=e.kind==='round'?[d]:e.kind==='archive'&&!d.excludedFromStand?d.rounds||[]:[];
   for(const r of entries)if(allowed(r.sid)&&Number.isFinite(r.score))rounds.set(r.id,{...r,source:r.source||'handmatig'});
  }
 }
 const averages=new Map();
 for(const r of rounds.values()){
  if(r.type==='parcours')best(r.sid,r);
  if(r.type==='stage'){const key=r.sid+'|'+r.trainingId+'|'+r.stage;const g=averages.get(key)||{sid:r.sid,stage:r.stage,scores:[]};g.scores.push(r.score);averages.set(key,g);}
 }
 for(const g of averages.values())stage(g.sid,g.stage,{avg:g.scores.reduce((a:number,b:number)=>a+b,0)/g.scores.length,rounds:g.scores.length});
 const shooters=[...names].map(([id,naam])=>({id,naam})).sort((a,b)=>a.naam.localeCompare(b.naam,'nl'));
 return {shooters,bestParcours,bestStageAverages,stageShots,rounds:[...rounds.values()].map(r=>({...r,naam:names.get(r.sid)||'Schutter'})).sort((a,b)=>(b.ts||0)-(a.ts||0))};
}
