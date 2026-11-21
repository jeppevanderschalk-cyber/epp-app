const TrainingJournal=({sid,trainingId,onEntries})=>{
 const [entries,setEntries]=React.useState([]),[content,setContent]=React.useState(''),[status,setStatus]=React.useState(''),[busy,setBusy]=React.useState(false),[ready,setReady]=React.useState(false);
 const revision=React.useRef(0);
 const call=action=>eppCall('epp-training',{clubId:eppSession().account.clubId,action,shooterId:sid,trainingId,content});
 React.useEffect(()=>{const v=++revision.current;setReady(false);setEntries([]);setContent('');setStatus('Dagboek laden...');call('journal_load').then(r=>{if(v!==revision.current)return;setEntries(r.entries);setReady(true);setStatus('');}).catch(()=>{if(v===revision.current)setStatus('Dagboek laden is niet gelukt.');});return()=>{revision.current++;};},[sid,trainingId]);
 React.useEffect(()=>{onEntries(entries);},[entries]);
 const save=async e=>{e.preventDefault();if(busy||!content.trim())return;const v=revision.current;setBusy(true);try{const r=await call('journal_add');if(v===revision.current){setEntries(r.entries);setContent('');setStatus('Aantekening online opgeslagen.');}}catch{if(v===revision.current)setStatus('Opslaan is niet gelukt. Je aantekening staat nog in het invoerveld.');}finally{setBusy(false);}};
 return h('section',{'aria-label':'Trainingsdagboek'},h('h3',null,'Trainingsdagboek'),h('p',{className:'hint'},eppSession().account.role==='trainer'?'Traineradvies is zichtbaar voor deze schutter en bevoegde trainers.':'Je eigen aantekeningen zijn privé. Traineradvies kun je hier teruglezen.'),entries.map(e=>h('article',{key:e.id,style:{marginBottom:12}},h('strong',null,e.author_name+' · '+(e.visibility==='private'?'Eigen notitie':'Traineradvies')),h('small',{style:{display:'block'}},new Date(e.created_at).toLocaleString('nl-NL')),h('p',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},e.content))),ready&&h('form',{onSubmit:save,style:{display:'grid',gap:10}},h('label',null,'Aantekening of advies',h('textarea',{className:'txt-in',maxLength:4000,rows:4,required:true,disabled:busy,value:content,onChange:e=>setContent(e.target.value)})),h('button',{className:'btn btn-gold',disabled:busy||!content.trim()},busy?'Opslaan...':'Aantekening opslaan')),status&&h('p',{role:'status',className:'hint'},status));
};
const TrainingResults=({data,currentTraining,targetClubId})=>{
 const [training,setTraining]=React.useState(''),[sid,setSid]=React.useState(''),[status,setStatus]=React.useState(''),[busy,setBusy]=React.useState(false),[entries,setEntries]=React.useState([]),[includeDiary,setIncludeDiary]=React.useState(false);
 const trainings=new Map();for(const r of data.rounds||[]){const key=EppTrainingResults.trainingKey(r);trainings.set(key,Math.max(trainings.get(key)||0,r.ts||0));}if(currentTraining&&!trainings.has(currentTraining.id))trainings.set(currentTraining.id,currentTraining.startedAt||Date.now());
 const selected=EppTrainingResults.model(data,training,sid),canJournal=!!(training&&sid&&(data.ownShooterId===sid||eppSession()?.account?.role==='trainer'));
 const change=setter=>e=>{setter(e.target.value);setEntries([]);setIncludeDiary(false);setStatus('');};
 const download=async()=>{setBusy(true);setStatus('');try{
  // Fetch saved results again so the export never contains unconfirmed local input.
  const fresh=await eppCall('epp-training',{clubId:eppSession().account.clubId,action:'standings',targetClubId});
  const diary=includeDiary&&canJournal?(await eppCall('epp-training',{clubId:eppSession().account.clubId,action:'journal_load',shooterId:sid,trainingId:training})).entries:[];
  const file=await EppTrainingResults.create(fresh,{trainingId:training,sid,club:(targetClubId?EPP_CLUBS.find(c=>c.id===targetClubId)?.label:null)||CLUB.label,entries:diary});const url=URL.createObjectURL(new Blob([file.bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=file.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);setStatus('PDF gedownload.');
 }catch(e){setStatus('PDF downloaden is niet gelukt. '+e.message);}finally{setBusy(false);}};
 return h('section',{className:'card','aria-label':'Opgeslagen trainingsresultaten'},h('div',{className:'card-head'},h('h3',null,'Opgeslagen trainingsresultaten')),h('div',{className:'card-body',style:{display:'grid',gap:12,minWidth:0}},
  h('label',null,'Training bekijken',h('select',{className:'txt-in','aria-label':'Training bekijken',value:training,disabled:busy,onChange:change(setTraining)},h('option',{value:''},'Alle trainingen'),[...trainings].sort((a,b)=>b[1]-a[1]).map(([id,ts])=>h('option',{key:id,value:id},new Date(ts).toLocaleString('nl-NL')+' · '+id)))),
  h('label',null,'Resultaten van schutter',h('select',{className:'txt-in','aria-label':'Resultaten van schutter',value:sid,disabled:busy,onChange:change(setSid)},h('option',{value:''},'Alle schutters'),(data.shooters||[]).map(s=>h('option',{key:s.id,value:s.id},s.naam)))),
  h('p',{className:'hint'},'Alle opgeslagen stages en parcoursrondes, ook van eerdere trainingen. Bekijk de scores per vereniging via Stand.'),
  selected.rounds.map(r=>h('article',{key:r.id,style:{borderBottom:'1px solid '+C.border,paddingBottom:8,overflowWrap:'anywhere'}},h('strong',null,(r.naam||data.shooters.find(s=>s.id===r.sid)?.naam||'Schutter')+' · '+(r.type==='parcours'?'Parcours':r.stage)+' · '+r.score+' punten'),h('small',{style:{display:'block'}},r.ts?new Date(r.ts).toLocaleString('nl-NL'):''),r.note&&h('p',{style:{whiteSpace:'pre-wrap'}},r.note))),
  !selected.rounds.length&&h('p',null,'Nog geen opgeslagen scores in deze selectie.'),
  canJournal&&h(TrainingJournal,{key:training+sid,sid,trainingId:training,onEntries:setEntries}),
  canJournal&&h('label',null,h('input',{type:'checkbox',checked:includeDiary,onChange:e=>setIncludeDiary(e.target.checked)}),' Dagboek toevoegen aan persoonlijke PDF'),
  h('button',{className:'btn btn-gold',disabled:busy||(!selected.rounds.length&&!selected.standings.length),onClick:download},busy?'PDF maken...':sid?'PDF per schutter downloaden':'PDF met alle standen en resultaten downloaden'),status&&h('p',{role:'status'},status)));
};
const SharedTrainingResults=({currentTraining})=>{
 const [data,setData]=React.useState(null),[error,setError]=React.useState('');
 React.useEffect(()=>{let active=true;const load=async()=>{try{const r=await eppCall('epp-training',{clubId:eppSession().account.clubId,action:'standings'});if(active){setData(r);setError('');}}catch{if(active)setError('Opgeslagen resultaten laden is niet gelukt.');}};load();const timer=eppPoll(load,10000);return()=>{active=false;clearInterval(timer);};},[]);
 return h('div',null,error&&h('p',{role:'status'},error),data?h(TrainingResults,{data,currentTraining}):h('p',{role:'status'},'Opgeslagen resultaten laden...'));
};
