(function(root){
  'use strict';
  function stable(value){
    if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  const equal=(a,b)=>stable(a==null?null:a)===stable(b==null?null:b);
  function flatten(p){
    const out={};const add=(kind,id,data)=>{out[kind+'|'+id]={kind,id,data};};
    (p.shooters||[]).forEach(s=>add('shooter',s.id,s));
    (p.cameraShots||[]).forEach(s=>add('shot',s.id,s));
    const t=p.currentTraining;
    if(t){const meta={...t};delete meta.rounds;delete meta.updatedAt;add('meta','currentTraining',meta);(t.rounds||[]).forEach(r=>add('round',r.id,r));}
    add('meta','stageShots',p.stageShots||{});
    Object.entries(p.bestParcours||{}).forEach(([id,data])=>add('parcoursBest',id,data));
    Object.entries(p.bestStageAverages||{}).forEach(([stage,items])=>Object.entries(items||{}).forEach(([id,data])=>add('stageBest',stage+':'+id,data)));
    Object.entries(p.scores||{}).forEach(([id,data])=>add('legacyScore',id,data));
    (p.archives||[]).forEach(a=>add('archive',a.id,a));
    return out;
  }
  function decode(entities){
    const p={schema:3,shooters:[],cameraShots:[],scores:{},stageShots:{},bestParcours:{},bestStageAverages:{},archives:[],tombstones:{}};
    const rounds=[];
    for(const e of entities){if(!e.data)continue;
      if(e.kind==='shooter')p.shooters.push(e.data);
      if(e.kind==='shot')p.cameraShots.push(e.data);
      if(e.kind==='round')rounds.push(e.data);
      if(e.kind==='meta'&&e.id==='currentTraining')p.currentTraining=e.data;
      if(e.kind==='meta'&&e.id==='stageShots')p.stageShots=e.data;
      if(e.kind==='parcoursBest')p.bestParcours[e.id]=e.data;
      if(e.kind==='legacyScore')p.scores[e.id]=e.data;
      if(e.kind==='archive')p.archives.push(e.data);
      if(e.kind==='stageBest'){const cut=e.id.indexOf(':');const stage=e.id.slice(0,cut),sid=e.id.slice(cut+1);(p.bestStageAverages[stage]||={})[sid]=e.data;}
    }
    if(p.currentTraining)p.currentTraining={...p.currentTraining,rounds:rounds.filter(r=>r.trainingId===p.currentTraining.id).sort((a,b)=>a.ts-b.ts)};
    p.shooters.sort((a,b)=>a.naam.localeCompare(b.naam,'nl'));
    p.archives.sort((a,b)=>(b.closedAt||0)-(a.closedAt||0));
    return p;
  }
  function diff(base,wanted){
    const a=flatten(base),b=flatten(wanted),out=[];
    for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
      const old=a[key]?.data||null,next=b[key]?.data||null;
      if(!equal(old,next)){const e=b[key]||a[key];out.push({kind:e.kind,id:e.id,expected:old,value:next});}
    }
    return out;
  }
  function rebase(base,wanted,remote){
    const r=flatten(remote),ops=diff(base,wanted),conflicts=[];
    for(const op of ops){const key=op.kind+'|'+op.id,now=r[key]?.data||null;
      if(!equal(now,op.expected)&&!equal(now,op.value)){conflicts.push({kind:op.kind,id:op.id});continue;}
      if(op.value===null)delete r[key];else r[key]={kind:op.kind,id:op.id,data:op.value};
    }
    return {payload:decode(Object.values(r)),conflicts};
  }
  root.EppStore={stable,equal,flatten,decode,diff,rebase};
})(typeof globalThis!=='undefined'?globalThis:window);
