(function(root){
  const fields=['final_score','hits5','rapid_score','rapid_time_ms','total_time_ms'];
  function compare(a,b){
    for(const key of fields){
      if(a[key]==null||b[key]==null)return 0;
      const d=Number(a[key])-Number(b[key]);
      if(d)return key.endsWith('_ms')?d:-d;
    }
    return 0;
  }
  // Missing historical measurements form a shared, provisional group.
  function rank(rows){
    function groups(items,depth){
      if(depth===fields.length||items.length<2)return [items];
      const key=fields[depth];
      if(items.some(r=>r[key]==null))return [items];
      const values=[...new Set(items.map(r=>Number(r[key])))].sort((a,b)=>key.endsWith('_ms')?a-b:b-a);
      return values.flatMap(value=>groups(items.filter(r=>Number(r[key])===value),depth+1));
    }
    let position=1;
    return groups(rows,0).flatMap(group=>{
      const pos=position;position+=group.length;
      return group.map(row=>({...row,position:pos,provisional:group.length>1&&group.some(r=>fields.some(k=>r[k]==null))}));
    });
  }
  function time(value){return value==null?'Onbekend':(value/1000).toFixed(value%10===0?2:3)+' s';}
  function best(rows){
    const top=rank(rows).filter(r=>r.position===1);
    return top.sort((a,b)=>fields.filter(k=>a[k]!=null).length-fields.filter(k=>b[k]!=null).length)[0];
  }
  function milliseconds(value){
    if(value===''||value==null)return null;
    const text=String(value).trim().replace(',','.');
    if(!/^\d+(?:\.\d{1,3})?$/.test(text))return NaN;
    const n=Math.round(Number(text)*1000);
    return Number.isSafeInteger(n)&&n>0?n:NaN;
  }
  function parcoursMilliseconds(value){
    if(value===''||value==null)return null;
    const match=String(value).trim().match(/^(\d+)[:,.](\d{1,2})(?:[.,](\d{1,3}))?$/);
    if(!match||Number(match[2])>=60)return NaN;
    const n=(Number(match[1])*60+Number(match[2]))*1000+Number((match[3]||'').padEnd(3,'0'));
    return Number.isSafeInteger(n)&&n>0?n:NaN;
  }
  function parcoursTime(value){
    if(value==null)return 'Onbekend';
    const seconds=Math.floor(value/1000);
    const fraction=value%1000;
    return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+(fraction?'.'+String(fraction).padStart(3,'0'):'');
  }
  function counted(rapid,rest,rapidTime,totalTime,penalty=0,penaltyTime=0,reason=''){
    const keys=['hits5','hits4','hits3','hits2','misses'];
    const valid=(part,count)=>keys.every(k=>Number.isSafeInteger(Number(part[k]))&&Number(part[k])>=0)&&keys.reduce((sum,k)=>sum+Number(part[k]),0)===count;
    if(!valid(rapid,10)||!valid(rest,40))throw new Error('Vereist: 10 snelvuurschoten + 40 overige schoten.');
    const rt=milliseconds(rapidTime),tt=milliseconds(totalTime),pt=String(penaltyTime)==='0'?0:milliseconds(penaltyTime);
    if(!Number.isSafeInteger(rt)||!Number.isSafeInteger(tt)||tt<rt||!Number.isSafeInteger(pt)||pt<0)throw new Error('Controleer snelvuurtijd, totaaltijd en straftijd.');
    const pen=Number(penalty);
    if(!Number.isSafeInteger(pen)||pen<0||((pen>0||pt>0)&&reason.trim().length<3))throw new Error('Controleer strafpunten en reden.');
    const total=Object.fromEntries(keys.map(k=>[k,Number(rapid[k])+Number(rest[k])]));
    const score=keys.reduce((sum,k,i)=>sum+total[k]*[5,4,3,2,0][i],0)-pen;
    if(score<0||score>250)throw new Error('Eindscore buiten bereik.');
    return {...total,final_score:score,rapid_score:keys.reduce((sum,k,i)=>sum+Number(rapid[k])*[5,4,3,2,0][i],0),rapid_counts:rapid,rapid_time_ms:rt,measured_total_time_ms:tt,total_time_ms:tt+pt,penalty_points:pen,penalty_time_ms:pt,penalty_reason:reason,scoring_version:'EPP_TIEBREAK_V2'};
  }
  const api={compare,rank,best,time,milliseconds,parcoursMilliseconds,parcoursTime,counted};
  root.EppScoreRanking=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
