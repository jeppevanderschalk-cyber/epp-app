(function(root){
 'use strict';
 const clean=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
 const trainingKey=r=>r.trainingId||'datum:'+new Date(r.ts||0).toISOString().slice(0,10);
 function model(data,trainingId='',sid=''){
  const rounds=(data.rounds||[]).filter(r=>(!trainingId||trainingKey(r)===trainingId)&&(!sid||r.sid===sid));
  const shooters=(data.shooters||[]).filter(s=>(!sid||s.id===sid)&&(rounds.some(r=>r.sid===s.id)||(!trainingId&&(data.bestParcours?.[s.id]||Object.values(data.bestStageAverages||{}).some(g=>g[s.id])))));
  const standings=[];
  for(const stage of ['parcours','s1','s2','s3','s4','s5','s6','s7']){
   const rows=shooters.map(s=>{const rr=rounds.filter(r=>r.sid===s.id&&(stage==='parcours'?r.type==='parcours':r.type==='stage'&&r.stage===stage));
    const summary=!trainingId&&(stage==='parcours'?data.bestParcours?.[s.id]:data.bestStageAverages?.[stage]?.[s.id]);
    if(!rr.length&&!summary)return null;
    const best=summary&&stage==='parcours'?summary:rr.length?root.EppScoreRanking.best(rr.map(r=>({...r,final_score:r.score}))):{};
    const groups=new Map();for(const r of rr){const key=trainingKey(r);const g=groups.get(key)||[];g.push(r.score);groups.set(key,g);}
    const stageAverage=trainingId?rr.reduce((n,r)=>n+r.score,0)/rr.length:summary?summary.avg:Math.max(...[...groups.values()].map(g=>g.reduce((a,b)=>a+b,0)/g.length));
    return {sid:s.id,name:s.naam,stage,count:rr.length,score:stage==='parcours'?best.score:stageAverage,best};
   }).filter(Boolean).sort((a,b)=>stage==='parcours'?root.EppScoreRanking.compare({...a.best,final_score:a.score},{...b.best,final_score:b.score}):b.score-a.score);
   if(stage==='parcours'){const ranked=root.EppScoreRanking.rank(rows.map(r=>({...r.best,final_score:r.score,result:r})));rows.splice(0,rows.length,...ranked.map(r=>({...r.result,rank:r.position})));}else rows.forEach((r,i)=>{const previous=rows[i-1];r.rank=previous&&previous.score===r.score?previous.rank:i+1;});
   standings.push(...rows);
  }
  return {rounds,standings,shooters};
 }
 async function create(data,{trainingId='',sid='',club='',entries=[],now=new Date(),resources}={}){
  // Compute ranks against every participant before selecting a personal report.
  const full=model(data,trainingId),m={...full,rounds:full.rounds.filter(r=>!sid||r.sid===sid),standings:full.standings.filter(r=>!sid||r.sid===sid)};
  if(!m.rounds.length&&!m.standings.length)throw Error('Geen opgeslagen resultaten voor deze selectie.');
  const {pdf,fontkit,fontBytes}=resources||await root.EppPlannerPdf.dependencies();
  const doc=await pdf.PDFDocument.create();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(fontBytes[0],{subset:true}),bold=await doc.embedFont(fontBytes[1],{subset:true});
  doc.setTitle('EPP Trainingsresultaten');doc.setAuthor('EPP');doc.setCreationDate(now);
  const W=595.28,H=841.89,M=38,ink=pdf.rgb(.08,.12,.18),muted=pdf.rgb(.35,.38,.42);let page,y;
  const stamp=now.toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'});
  const start=()=>{page=doc.addPage([W,H]);y=H-M;line('EPP - Trainingsresultaten',16,true);line(club,10);line((trainingId?'Training: '+trainingId:'Alle trainingen')+' | Export: '+stamp,8);y-=12;};
  function line(value,size=10,strong=false){
   const f=strong?bold:font,text=clean(value),parts=[];let current='';
   for(const ch of text){if(current&&f.widthOfTextAtSize(current+ch,size)>W-M*2){parts.push(current);current='';}current+=ch;}parts.push(current);
   for(const part of parts){if(y<55)start();page.drawText(part,{x:M,y:y-size,size,font:f,color:ink});y-=size*1.5;}
  }
  start();
  if(sid)line('Schutter: '+(full.shooters.find(s=>s.id===sid)?.naam||'Schutter'),12,true);
  line('Standen binnen de geselecteerde training(en)',12,true);
  line(trainingId?'Parcours: beste ronde. Stages: gemiddelde van de rondes. Stages worden apart gerangschikt.':'Verenigingsstand: beste parcoursronde en hoogste stagegemiddelde per training.',9);
  for(const r of m.standings)line(r.rank+'. '+r.name+' | '+(r.stage==='parcours'?'Parcours':r.stage.toUpperCase())+' | '+r.score.toLocaleString('nl-NL',{maximumFractionDigits:2})+' punten | '+r.count+' opgeslagen '+(r.count===1?'ronde':'rondes'));
  y-=12;line('Alle opgeslagen rondes',12,true);
  for(const r of [...m.rounds].sort((a,b)=>(a.ts||0)-(b.ts||0))){
   line((r.naam||full.shooters.find(s=>s.id===r.sid)?.naam||'Schutter')+' | '+(r.type==='parcours'?'Parcours':String(r.stage).toUpperCase())+' | '+r.score+' punten',10,true);
   line((r.ts?new Date(r.ts).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'}):'Datum onbekend')+' | Training: '+trainingKey(r),8);
   const counts=['hits5','hits4','hits3','hits2','misses'].filter(k=>r[k]!=null).map(k=>({hits5:'5 punten',hits4:'4 punten',hits3:'3 punten',hits2:'2 punten',misses:'Missers'}[k])+': '+r[k]);
   if(counts.length)line(counts.join(' | '),9);
   for(const [key,label] of [['stage_time_ms','Stagetijd'],['rapid_time_ms','Snelvuurtijd'],['total_time_ms','Eindtijd'],['penalty_time_ms','Straftijd']])if(r[key]!=null)line(label+': '+(r[key]/1000)+' seconden',9);
   if(r.rapid_score!=null)line('Snelvuurscore: '+r.rapid_score,9);
   if(r.penalty_points!=null)line('Strafpunten: '+r.penalty_points,9);
   if(r.penalty_reason)line('Reden strafcorrectie: '+r.penalty_reason,9);
   if(r.note)line('Notitie: '+r.note,9);y-=7;
  }
  if(sid&&trainingId&&entries.length){y-=10;line('Trainingsdagboek',12,true);for(const e of entries){line(e.author_name+' | '+new Date(e.created_at).toLocaleString('nl-NL')+' | '+(e.visibility==='private'?'Eigen notitie':'Traineradvies'),9,true);line(e.content);y-=7;}}
  const pages=doc.getPages();pages.forEach((p,i)=>p.drawText('EPP | '+(i+1)+' / '+pages.length,{x:M,y:24,size:8,font,color:muted}));
  return {bytes:await doc.save(),filename:'EPP-training-'+(sid?'schutter-':'overzicht-')+now.toISOString().slice(0,10)+'.pdf'};
 }
 root.EppTrainingResults={model,trainingKey,create};
})(globalThis);
