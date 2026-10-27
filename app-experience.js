(function(root){
  'use strict';
  const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('nl').trim();
  function filterRanking(items,{query='',club='',category='',onlyId=''}={}){
    const words=normalize(query).split(/\s+/).filter(Boolean);
    return (items||[]).filter(item=>(!club||item.club===club)&&(!category||item.category===category)&&(!onlyId||item.shooterId===onlyId||item.id===onlyId)&&words.every(word=>normalize([item.name,item.club,item.publicId].join(' ')).includes(word)));
  }
  function progress(current,archives,sid){
    const unique=new Map();
    for(const training of [...(archives||[]),current||{}])for(const round of training.rounds||[]){
      if(round.sid===sid&&Number.isFinite(round.score))unique.set(round.id,round);
    }
    const rounds=[...unique.values()].sort((a,b)=>a.ts-b.ts),parcours=rounds.filter(r=>r.type==='parcours');
    const recent=parcours.slice(-5),previous=parcours.slice(-10,-5);
    const mean=items=>items.length?items.reduce((n,r)=>n+r.score,0)/items.length:null;
    return {rounds,parcours,recent,latest:parcours.at(-1),average:mean(recent),change:recent.length===5&&previous.length===5?mean(recent)-mean(previous):null};
  }
  function draftKey(account,scope){return 'epp-draft-v1:'+encodeURIComponent(account?.clubId||'')+':'+encodeURIComponent(account?.id||account?.username||'')+':'+scope;}
  function readDraft(storage,key){try{const data=JSON.parse(storage.getItem(key)||'null');return data&&data.version===1&&data.fields&&typeof data.fields==='object'?data:null;}catch{return null;}}
  function writeDraft(storage,key,fields){try{storage.setItem(key,JSON.stringify({version:1,updatedAt:Date.now(),fields}));return true;}catch{return false;}}
  root.EppUx={normalize,filterRanking,progress,draftKey,readDraft,writeDraft};
})(typeof globalThis!=='undefined'?globalThis:window);
