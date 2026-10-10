const plannerClock=value=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
const plannerDay=value=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'short',year:'numeric'}).format(new Date(value));
const plannerSlot=value=>plannerDay(value)+' · '+plannerClock(value);
const plannerLastRound=config=>{
  const minutes=value=>/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;
  const first=minutes(config.first),last=minutes(config.last),duration=Number(config.duration),changeover=Number(config.changeover),step=duration+changeover;
  if(!Number.isFinite(first)||!Number.isFinite(last)||last<first||!Number.isInteger(duration)||duration<1||!Number.isInteger(changeover)||changeover<0)return '';
  let actual=first+Math.floor((last-first)/step)*step;
  while(actual>=first&&(config.breaks||[]).some(pause=>actual<minutes(pause.end)&&actual+duration>minutes(pause.start)))actual-=step;
  if(actual<first)return '';
  if(actual+duration>1440)return '';
  const clock=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  return clock(actual)+' – '+clock(actual+duration);
};
const plannerConfigErrors={laatste_ronde_sluit_niet_aan:'De laatste starttijd sluit niet aan op de rondeduur en wisseltijd.',ongeldige_capaciteit:'Kies een bestaande ronde en een capaciteit van 1 tot 100.',ongeldige_planning:'Controleer de starttijden, rondeduur, capaciteit en inschrijfperiode.'};
const plannerError=e=>({tijdslot_vol:'Dit tijdslot is net volgeboekt. Kies een andere tijd.',overlappende_boeking:'Deze deelnames overlappen of hebben onvoldoende pauze ertussen.',planning_conflict:'De planning is elders gewijzigd. Haal de nieuwste versie op.',boeking_conflict:'Deze inschrijving is elders gewijzigd. Haal de nieuwste versie op.',bestaande_inschrijvingen_eerst_plannen:'Er zijn bestaande inschrijvingen zonder tijdslot. Deze moeten eerst gecontroleerd worden verwerkt; de app verplaatst ze niet automatisch.',geboekte_tijdsloten_behouden:'Deze wijziging zou bestaande boekingen veranderen of de capaciteit overschrijden.',geen_beheerrechten:'Je hebt geen beheerrechten voor deze vereniging.',inschrijving_gesloten:'De inschrijving is gesloten.',persoonlijk_schutterprofiel_verplicht:'Gebruik een persoonlijk account met schutter-ID.'}[e.message]||'Dit is niet gelukt. Probeer opnieuw. Blijft het probleem bestaan, neem dan contact op met de beheerder.');

const PlannerBooking=({view,target,onSaved,onReload,saveNotice='',onEdited})=>{
  const mine=target||view.mine;
  const [choices,setChoices]=React.useState(()=>Object.fromEntries(mine.choices.map(c=>[c.discipline,c.slotId])));
  const [days,setDays]=React.useState({});
  const [revision,setRevision]=React.useState(mine.revision),[reason,setReason]=React.useState(''),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState(''),[conflict,setConflict]=React.useState(false);
  const baseline=React.useRef(Object.fromEntries(mine.choices.map(c=>[c.discipline,c.slotId]))),feedbackRef=React.useRef(null);
  React.useEffect(()=>{
    if(busy||mine.revision===revision)return;
    const latest=Object.fromEntries(mine.choices.map(c=>[c.discipline,c.slotId]));
    const same=(a,b)=>view.match.offered_disciplines.every(d=>(a[d]||'')===(b[d]||''));
    if(same(latest,baseline.current)||same(choices,baseline.current)){
      if(!same(latest,baseline.current))setChoices(latest);
      baseline.current=latest;setRevision(mine.revision);setConflict(false);
    }else{setConflict(true);setStatus('Deze inschrijving is elders gewijzigd. Haal de nieuwste versie op.');}
  },[mine.revision,revision,busy]);
  React.useEffect(()=>{if(status)feedbackRef.current?.scrollIntoView({block:'center',behavior:'smooth'});},[status]);
  const open=view.managing||(view.planner.published&&Date.now()>=Date.parse(view.planner.opens_at)&&Date.now()<=Date.parse(view.planner.closes_at));
  const canBook=target||view.profile;
  const selected=Object.values(choices).some(Boolean);
  const changed=view.match.offered_disciplines.some(d=>(choices[d]||'')!==(mine.choices.find(c=>c.discipline===d)?.slotId||''));
  const save=async cancel=>{
    if(busy||conflict||!open||!canBook||(!cancel&&!selected))return;setBusy(true);setStatus('');onEdited?.();
    try{
      await eppCall('epp-planner',{clubId:CLUB_ID,action:'book',matchId:view.match.id,shooterId:target?.shooterId,choices:cancel?[]:Object.entries(choices).filter(([,id])=>id).map(([discipline,slotId])=>({discipline,slotId})),expectedRevision:revision,reason});
      const message=await onSaved(cancel);setStatus(message||(cancel?'Online afgemeld':'Boeking online bevestigd'));
    }catch(e){setStatus(plannerError(e));setConflict(e.message==='boeking_conflict');}finally{setBusy(false);}
  };
  return h('section',{style:{display:'grid',gap:12}},
    h('h3',{style:{fontSize:18,margin:0}},target?'Inschrijving wijzigen: '+target.name:'Jouw inschrijving'),
    !canBook&&h('p',{className:'hint'},'Een persoonlijk schutterprofiel is nodig om te boeken.'),
    !open&&h('p',{className:'hint'},Date.now()<Date.parse(view.planner.opens_at)?'Inschrijving opent '+new Date(view.planner.opens_at).toLocaleString('nl-NL'):'Inschrijving gesloten'),
    view.match.offered_disciplines.map(d=>{
      const dates=[...new Set(view.slots.map(s=>plannerDay(s.starts_at)))];
      const chosen=view.slots.find(s=>s.id===choices[d]);
      const day=days[d]||(chosen?plannerDay(chosen.starts_at):dates[0]);
      const choose=id=>{setChoices(p=>({...p,[d]:id}));setStatus('');onEdited?.();};
      return h('fieldset',{key:d,disabled:busy||!open||!canBook,style:{border:0,padding:0,margin:'8px 0',minWidth:0}},
        h('legend',{style:{fontWeight:800,marginBottom:10}},EPP_DISCIPLINES.find(x=>x.id===d)?.label||d),
        h('div',{role:'group','aria-label':'Wedstrijddag '+d,style:{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}},dates.map(date=>h('button',{key:date,type:'button','aria-pressed':date===day,className:'btn '+(date===day?'btn-gold':'btn-ghost'),style:{padding:'10px 12px',fontSize:14},onClick:()=>setDays(p=>({...p,[d]:date}))},date))),
        h('div',{role:'radiogroup','aria-label':'Tijdslot '+d,style:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(105px,1fr))',gap:8}},view.slots.filter(s=>plannerDay(s.starts_at)===day).map(s=>{
          const own=mine.choices.some(c=>c.slotId===s.id),full=s.booked>=s.capacity&&!own,past=Date.parse(s.starts_at)<=Date.now(),selected=choices[d]===s.id;
          const reserved=mine.choices.some(c=>c.discipline===d&&c.slotId===s.id);
          return h('button',{key:s.id,type:'button',role:'radio','aria-checked':selected,'aria-label':plannerSlot(s.starts_at)+(full?' · Vol':past?' · Verstreken':''),disabled:full||past,className:'btn '+(selected?'btn-gold':'btn-ghost'),style:{display:'grid',gap:5,minHeight:88,padding:'12px 8px',borderRadius:8,opacity:full||past?0.4:1},onClick:()=>choose(s.id)},h('strong',{style:{fontSize:18}},plannerClock(s.starts_at)),h('small',{style:{fontSize:12,fontWeight:600}},full?'Vol':past?'Verstreken':Math.max(0,s.capacity-s.booked)+' vrij'),h('small',{style:{fontSize:12,fontWeight:600,minHeight:15}},reserved?'Gereserveerd':selected?'Nog bevestigen':''));
        })),
        !dates.length&&h('p',{className:'hint'},'Nog geen tijdsloten beschikbaar.'),
        chosen&&h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:10}},h('span',{style:{fontSize:14,fontWeight:700}},plannerSlot(chosen.starts_at)+' – '+plannerClock(chosen.ends_at)),h('button',{type:'button',className:'btn btn-ghost',style:{padding:'8px 10px',fontSize:12},onClick:()=>choose('')},'Niet deelnemen'))
      );
    }),
    target&&h('label',null,'Reden wijziging',h('input',{className:'txt-in',value:reason,disabled:busy,onChange:e=>setReason(e.target.value)})),
    !selected&&open&&canBook&&h('p',{className:'hint',role:'status',style:{margin:0}},'Nog geen tijdslot gekozen.'),
    changed&&mine.choices.length>0&&h('p',{className:'hint',role:'status',style:{margin:0}},'Bevestig je nieuwe tijdslot. Daarna komt je oude tijdslot automatisch vrij.'),
    (status||saveNotice)&&h('p',{ref:feedbackRef,className:'hint',role:status?'alert':'status',style:{margin:0,fontWeight:800}},status||saveNotice),
    conflict&&h('button',{className:'btn btn-ghost',disabled:busy,onClick:()=>{if(confirm('Niet opgeslagen wijzigingen vervallen. Nieuwste inschrijving ophalen?'))onReload();}},'Nieuwste inschrijving ophalen'),
    mine.choices.length>0&&!changed?h('p',{className:'hint',role:'status',style:{margin:0,fontWeight:800}},'Gereserveerd'):h('button',{className:'btn btn-gold',style:{opacity:!selected?0.45:1},disabled:busy||conflict||!open||!canBook||!selected||(target&&reason.trim().length<3),onClick:()=>save(false)},busy?'Opslaan...':mine.choices.length>0?'Gewijzigd slot bevestigen':'Tijdsloten bevestigen'),
    mine.choices.length>0&&h('button',{className:'btn btn-danger',disabled:busy||conflict||!open||(target&&reason.trim().length<3),onClick:()=>{if(confirm('Deze wedstrijdinschrijving afmelden?'))save(true);}},'Afmelden'),
    !target&&(status||saveNotice).startsWith('Boeking online bevestigd')&&h('p',{className:'hint',style:{margin:0}},'Je gekozen tijdsloten zijn gereserveerd.'),
    busy&&h('p',{className:'hint',role:'status'},'Reservering online opslaan...')
  );
};

const PlannerEditor=({view,onSaved,onReload,saveNotice='',onEdited})=>{
  const m=view.match;
  const defaults={first:'09:00',last:'16:00',duration:30,changeover:0,capacity:4,gap:0,opens:new Date().toISOString(),closes:new Date(m.match_date+'T08:00:00+01:00').toISOString(),breaks:[],overrides:[],published:false};
  const [config,setConfig]=React.useState(view.planner?.config||defaults),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState(''),[confirmed,setConfirmed]=React.useState(false);
  const [revision]=React.useState(view.planner?.revision||0),[conflict,setConflict]=React.useState(false);
  const inputValue=(value,type)=>type==='number'&&value!==''?Number(value):value;
  const field=(key,label,type)=>h('label',{key},label,h('input',{className:'txt-in',type,value:config[key],required:true,min:type==='number'?key==='capacity'||key==='duration'?1:0:undefined,max:type==='number'?key==='capacity'?100:180:undefined,onChange:e=>setConfig(p=>({...p,[key]:inputValue(e.target.value,type)}))}));
  const dateField=(key,label)=>{
    const local=new Date(config[key]);const text=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(config[key])?config[key]:Number.isNaN(local.valueOf())?'':new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(local).replace(' ','T');
    return h('label',{key},label,h('input',{className:'txt-in',type:'datetime-local',required:true,value:text,onChange:e=>{if(e.target.value)setConfig(p=>({...p,[key]:e.target.value}));}}));
  };
  const list=(key,labels)=>h('div',null,config[key].map((row,i)=>h('div',{key:i,style:{display:'flex',gap:8,flexWrap:'wrap',alignItems:'end'}},labels.map(([k,label,type])=>h('label',{key:k,style:{flex:'1 1 100px'}},label,h('input',{className:'txt-in',type,required:true,min:type==='number'?1:undefined,max:type==='number'?100:undefined,value:row[k],onChange:e=>setConfig(p=>({...p,[key]:p[key].map((r,j)=>j===i?{...r,[k]:inputValue(e.target.value,type)}:r)}))}))),h('button',{type:'button',className:'btn btn-ghost','aria-label':'Verwijder '+key+' '+(i+1),onClick:()=>setConfig(p=>({...p,[key]:p[key].filter((_,j)=>j!==i)}))},'×'))),h('button',{type:'button',className:'btn btn-ghost',onClick:()=>setConfig(p=>({...p,[key]:[...p[key],key==='breaks'?{start:'12:00',end:'13:00'}:{start:'09:00',capacity:p.capacity}]}))},key==='breaks'?'+ Pauze':'+ Afwijkende capaciteit'));
  return h('form',{style:{display:'grid',gap:12},onChange:()=>{setStatus('');onEdited?.();},onSubmit:async e=>{
    e.preventDefault();if(busy||!confirmed)return;setBusy(true);setStatus('');onEdited?.();
    try{await eppCall('epp-planner',{clubId:CLUB_ID,action:'configure',matchId:m.id,config,expectedRevision:revision});const message=await onSaved();setStatus(message||'Planning online opgeslagen');}
    catch(error){setStatus(plannerConfigErrors[error.message]||plannerError(error));setConflict(error.message==='planning_conflict');}finally{setBusy(false);}
  }},h('h3',{style:{fontSize:18}},'Planning instellen'),h('p',{className:'hint'},eppFmtMatchDates(m)),h('fieldset',{disabled:busy,style:{border:0,padding:0,minWidth:0,display:'grid',gap:12}},
    field('first','Eerste ronde start','time'),field('last','Laatste ronde start uiterlijk','time'),field('duration','Rondeduur (minuten)','number'),field('changeover','Wisseltijd (minuten)','number'),
    plannerLastRound(config)&&h('p',{className:'hint',role:'status',style:{margin:0}},'Laatste ronde: '+plannerLastRound(config)),
    field('capacity','Schietplaatsen per ronde','number'),field('gap','Minimale pauze tussen deelnames (minuten)','number'),dateField('opens','Inschrijving opent'),dateField('closes','Inschrijving sluit'),
    list('breaks',[['start','Pauze vanaf','time'],['end','Pauze tot','time']]),list('overrides',[['start','Start ronde','time'],['capacity','Schietplaatsen','number']]),
    h('label',{className:'chk-row'},h('input',{type:'checkbox',checked:config.published,onChange:e=>setConfig(p=>({...p,published:e.target.checked}))}),'Planner publiceren'),
    h('label',{className:'chk-row'},h('input',{type:'checkbox',checked:confirmed,onChange:e=>setConfirmed(e.target.checked)}),'Onze vereniging organiseert deze wedstrijd'),
    h('button',{type:'submit',className:'btn btn-gold',disabled:!confirmed},busy?'Opslaan...':'Planning opslaan')),
    (status||saveNotice)&&h('p',{className:'hint',role:conflict?'alert':'status',style:{margin:0,padding:'10px 0',fontWeight:700}},status||saveNotice),conflict&&h('button',{type:'button',className:'btn btn-ghost',disabled:busy,onClick:()=>{if(confirm('Niet opgeslagen wijzigingen vervallen. Nieuwste planning ophalen?'))onReload();}},'Nieuwste planning ophalen'));
};

const MatchPlanner=({matchId,manage=false})=>{
  const [view,setView]=React.useState(null),[status,setStatus]=React.useState(''),[version,setVersion]=React.useState(0),[target,setTarget]=React.useState(null);
  const [planningNotice,setPlanningNotice]=React.useState('');
  const [bookingNotice,setBookingNotice]=React.useState('');
  const bookingRef=React.useRef(null);
  const loadRequest=React.useRef(0);
  React.useEffect(()=>{if(target)bookingRef.current?.scrollIntoView({block:'start',behavior:'smooth'});},[target]);
  const load=React.useCallback(async()=>{
    const request=++loadRequest.current;
    try{const r=await eppCall('epp-planner',{clubId:CLUB_ID,action:'view',matchId});if(request===loadRequest.current){setView(r);setStatus('');}return r;}catch(e){if(request===loadRequest.current)setStatus(plannerError(e));}
  },[matchId]);
  React.useEffect(()=>{let active=true;load();const timer=setInterval(()=>{if(active)load();},10000);return()=>{active=false;clearInterval(timer);};},[load]);
  const saved=async(planning=false,cancel=false)=>{
    const latest=await load();
    if(latest){setVersion(v=>v+1);setTarget(null);setStatus('Online opgeslagen');}
    if(planning){
      const message=latest?'Planning online opgeslagen.':'Planning online opgeslagen. De tijdsloten konden niet worden vernieuwd; probeer de planning opnieuw te laden.';
      setPlanningNotice(message);return message;
    }
    const message=(cancel?'Online afgemeld':'Boeking online bevestigd')+(latest?'':'. De tijdsloten konden niet worden vernieuwd; laad de planning opnieuw.');
    setBookingNotice(message);return message;
  };
  const reload=async()=>{const latest=await load();if(!latest)return;setVersion(v=>v+1);if(target)setTarget(latest.roster.find(r=>r.shooterId===target.shooterId)||null);};
  return h('section',{style:{display:'grid',gap:14}},
    status&&h('p',{className:'hint',role:'status'},status),
    !view?h('p',{className:'hint'},'Planner laden...'):h(React.Fragment,null,
      manage&&view.managing&&h(PlannerEditor,{key:'editor-'+version,view,onSaved:()=>saved(true),onReload:reload,saveNotice:planningNotice,onEdited:()=>setPlanningNotice('')}),
      view.planner&&h(React.Fragment,null,
        (!manage||view.profile||target)&&h('div',{ref:bookingRef},h(PlannerBooking,{key:'booking-'+version+(target?.shooterId||''),view,target,onSaved:cancel=>saved(false,cancel),onReload:reload,saveNotice:bookingNotice,onEdited:()=>setBookingNotice('')})),
        manage&&!view.profile&&!target&&bookingNotice&&h('p',{className:'hint',role:'status'},bookingNotice),
        h('details',null,h('summary',{style:{fontWeight:700}},'Alle tijdsloten ('+view.slots.length+')'),
        h('h3',{style:{fontSize:18,margin:0}},'Tijdsloten'),
        h('div',{style:{display:'grid',gap:6}},view.slots.map(s=>h('div',{key:s.id,style:{display:'flex',gap:8,justifyContent:'space-between',borderBottom:'1px solid '+C.border,padding:'8px 0'}},h('span',{style:{minWidth:0,overflowWrap:'anywhere'}},plannerSlot(s.starts_at)+' – '+plannerClock(s.ends_at)),h('span',null,s.booked+'/'+s.capacity))))),
        manage&&view.managing&&h(React.Fragment,null,h('h3',{style:{fontSize:18}},'Deelnemers per ronde'),
          view.roster.some(r=>r.choices.some(c=>!c.slotId))&&h('section',null,h('h4',null,'Nog in te plannen'),view.roster.filter(r=>r.choices.some(c=>!c.slotId)).map(r=>h('div',{key:r.shooterId||r.name,style:{display:'grid',gap:6,padding:'10px 0',borderBottom:'1px solid '+C.border}},h('strong',null,r.name),h('small',null,(r.preferences||[]).map(p=>(EPP_DISCIPLINES.find(d=>d.id===p.discipline)?.label||p.discipline)+' · '+(p.specific_time||p.time_block)).join(', ')),h('button',{className:'btn btn-ghost',disabled:!r.shooterId,onClick:()=>setTarget(r)},r.shooterId?'Tijdslot toewijzen':'Eerst schutter-ID koppelen in groepslijst')))),
          view.slots.map(s=>h('section',{key:s.id},h('h4',{style:{margin:'12px 0 6px'}},plannerSlot(s.starts_at)+' · '+s.booked+'/'+s.capacity),view.roster.filter(r=>r.choices.some(c=>c.slotId===s.id)).map(r=>h('div',{key:r.shooterId,style:{padding:'8px 0',borderBottom:'1px solid '+C.border,display:'grid',gap:6}},h('strong',null,r.name),h('small',null,r.clubs.join(', ')+' · '+r.publicId+' · '+r.choices.filter(c=>c.slotId===s.id).map(c=>EPP_DISCIPLINES.find(d=>d.id===c.discipline)?.label||c.discipline).join(', ')),h('button',{className:'btn btn-ghost',onClick:()=>setTarget(r)},'Verplaatsen / afmelden'))))),
          h('details',null,h('summary',null,'Recente wijzigingen'),view.audit.map(a=>h('p',{key:a.id,className:'hint'},new Date(a.created_at).toLocaleString('nl-NL')+' · '+a.action+' · '+a.actor_id+(a.reason?' · '+a.reason:'')))))
      )));
};

const PlannerMatchCard=({match})=>{
  const [expanded,setExpanded]=React.useState(false);
  return h('section',{className:'match-card'},
    h('div',{className:'match-hd'},h('div',null,h('div',{className:'match-org'},match.organizer),h('div',{className:'match-sub'},eppFmtMatchDates(match)),match.location&&h('div',{className:'match-sub'},match.location))),
    h('button',{className:'btn btn-gold btn-full','aria-expanded':expanded,onClick:()=>setExpanded(v=>!v)},expanded?'SLUITEN':'DOE MEE'),
    expanded&&h('div',{style:{marginTop:16}},h(MatchPlanner,{matchId:match.id}))
  );
};

const MatchPlannerCatalog=({excludeIds=[]})=>{
  const [matches,setMatches]=React.useState([]),[status,setStatus]=React.useState('');
  React.useEffect(()=>{let active=true;const load=()=>eppCall('epp-planner',{clubId:CLUB_ID,action:'catalog'}).then(r=>{if(active){setMatches(r.matches);setStatus('');}}).catch(e=>{if(active)setStatus(plannerError(e));});load();const timer=setInterval(load,10000);return()=>{active=false;clearInterval(timer);};},[]);
  return h('section',{style:{display:'grid',gap:16}},status&&h('p',{className:'hint',role:'status'},status),matches.filter(m=>!excludeIds.includes(m.id)).map(m=>h(PlannerMatchCard,{key:m.id,match:m})));
};

const MembershipApproval=({account,onApproved})=>{
  const [busy,setBusy]=React.useState(false),[status,setStatus]=React.useState('');
  if(account.membership_approved!==false)return null;
  return h('div',{style:{flexBasis:'100%'}},h('p',{className:'hint'},'Lidmaatschap nog niet goedgekeurd',account.email?' · '+account.email:''),h('button',{className:'btn btn-gold',disabled:busy||account.active===false,onClick:async()=>{
    if(busy||!confirm('Bevestig dat '+account.display_name+' lid is van deze vereniging. Daarna krijgt dit account toegang.'))return;
    setBusy(true);setStatus('');try{await eppCall('epp-auth',{clubId:CLUB_ID,action:'approve_member',accountId:account.id});await onApproved();}catch(e){setStatus('Goedkeuring niet opgeslagen. Controleer je verbinding en rechten.');}finally{setBusy(false);}
  }},busy?'Goedkeuren...':'Lidmaatschap goedkeuren'),status&&h('p',{role:'alert',className:'hint'},status));
};
const PlatformAccessManagement=()=>{
  const head=eppSession()?.account?.isPlatformAdmin===true,ownClub=eppSession()?.account?.clubId||CLUB_ID;
  const [clubs,setClubs]=React.useState([]),[accounts,setAccounts]=React.useState([]),[club,setClub]=React.useState('svbb'),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState('');
  const [matches,setMatches]=React.useState([]),[match,setMatch]=React.useState(''),[access,setAccess]=React.useState(null);
  const request=React.useRef(0);
  const load=async()=>{try{const r=await eppCall('epp-auth',{clubId:CLUB_ID,action:head?'list_club_access':'list_accounts'});setClubs(r.clubs||[]);setAccounts((r.accounts||[]).map(a=>({...a,club_code:a.club_code||ownClub})));if(!head)setClub(ownClub);}catch(e){setStatus(scoringError(e));}};
  React.useEffect(()=>{load();},[]);
  const catalogRequest=React.useRef(0);
  const refreshMatches=async()=>{const version=++catalogRequest.current;try{const r=await eppCall('epp-scoring',{clubId:CLUB_ID,action:'catalog'});if(version!==catalogRequest.current)return;const available=r.matches||[];setMatches(available);setMatch(current=>current|| (available.length===1?available[0].id:''));}catch(e){if(version===catalogRequest.current)setStatus(scoringError(e));}};
  React.useEffect(()=>{refreshMatches();const timer=setInterval(refreshMatches,10000);return()=>{clearInterval(timer);catalogRequest.current++;};},[]);
  React.useEffect(()=>{
    const version=++request.current;setAccess(null);
    if(match)eppCall('epp-scoring',{clubId:CLUB_ID,action:'view',matchId:match}).then(r=>{if(request.current===version)setAccess(r);}).catch(e=>{if(request.current===version)setStatus(scoringError(e));});
    return()=>{request.current++;};
  },[match]);
  const toggleScorer=async(a,enabled)=>{
    if(!access||!confirm((enabled?'Scoorderrechten geven aan ':'Scoorderrechten intrekken voor ')+a.display_name+' voor deze wedstrijd?'))return;
    const version=request.current,selected=match;setBusy(true);setStatus('');
    try{
      await eppCall('epp-scoring',{clubId:CLUB_ID,action:'control',matchId:access.matchId,control:'scorer',accountId:a.id,enabled,expectedRevision:access.revision});
      setStatus('Scoorderrechten opgeslagen.');
    }catch(e){setStatus(e.message==='wedstrijd_conflict'?'Rechten zijn intussen gewijzigd. Controleer de bijgewerkte lijst en probeer opnieuw.':scoringError(e));}
    finally{
      try{const r=await eppCall('epp-scoring',{clubId:CLUB_ID,action:'view',matchId:selected});if(request.current===version)setAccess(r);}catch(e){if(request.current===version){setAccess(null);setStatus(e.message);}}
      setBusy(false);
    }
  };
  const remove=async a=>{
    if(busy)return;setBusy(true);setStatus('');
    try{if(await removeAccountWithConfirmation(a)){
      setAccounts(p=>p.filter(item=>item.id!==a.id));
      setStatus('Account verwijderd. Scores en inschrijvingen zijn behouden.');await load();
    }}catch(e){setStatus(e.message);}finally{setBusy(false);}
  };
  return h('section',null,h('div',{className:'card-head'},h('div',{className:'eyebrow'},head?'Hoofdbeheer · verenigingsrechten':'Scoorderrechten')),h('div',{className:'card-body',style:{display:'grid',gap:12}},
    head&&h('label',null,'Vereniging',h('select',{className:'txt-in','aria-label':'Vereniging voor beheerrechten',value:club,disabled:busy,onChange:e=>setClub(e.target.value)},clubs.map(c=>h('option',{key:c.code,value:c.code},c.naam)))),
    h('label',null,'Wedstrijd voor scoorderrechten',h('select',{className:'txt-in','aria-label':'Wedstrijd voor scoorderrechten',value:match,disabled:busy,onChange:e=>{setStatus('');setMatch(e.target.value);}},h('option',{value:''},'Kies wedstrijd'),matches.map(m=>h('option',{key:m.id,value:m.id},eppFmtDate(m.match_date)+' · '+m.organizer+(m.closed?' · Definitief':''))))),
    h('button',{className:'btn btn-ghost',disabled:busy,onClick:refreshMatches},'Wedstrijden verversen'),
    !matches.length&&h('p',{className:'hint',role:'status'},'Er zijn nog geen gepubliceerde wedstrijden beschikbaar. Sla de wedstrijdplanner op met Planner publiceren aangevinkt.'),
    matches.length>0&&!match&&h('p',{className:'hint'},'Kies eerst de wedstrijd waarvoor je scoorderrechten wilt geven.'),
    access?.closed&&h('p',{className:'hint'},'Deze uitslag is definitief. Nieuwe scoorders toevoegen is niet meer mogelijk.'),
    access&&!access.managing&&h('p',{className:'hint'},'Alleen de organiserende vereniging of hoofdbeheer kan scoorderrechten voor deze wedstrijd wijzigen.'),
    accounts.filter(a=>a.club_code===club&&a.membership_approved===false).map(a=>h('div',{key:'approval-'+a.id},h('strong',null,a.display_name),h(MembershipApproval,{account:a,onApproved:load}))),
    accounts.filter(a=>a.club_code===club&&!a.is_platform_admin).map(a=>{const scorer=access?.scorers?.some(s=>s.account_id===a.id),eligible=access?.accounts?.some(s=>s.id===a.id);return h('div',{key:a.id,role:'group','aria-label':a.display_name,style:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',borderBottom:'1px solid '+C.border,padding:'10px 0'}},h('div',{style:{flex:'1 1 100%',minWidth:0,overflowWrap:'anywhere'}},a.display_name,h('small',{style:{display:'block'}},(a.is_admin?'Verenigingsbeheerder':'Schutter')+(a.active===false?' · Geblokkeerd':'')+(scorer?' · Scoorder voor deze wedstrijd':''))),head&&h('button',{className:'btn '+(a.is_admin?'btn-danger':'btn-gold'),disabled:busy||a.active===false||a.membership_approved===false,onClick:async()=>{
      if(!confirm((a.is_admin?'Beheerrechten intrekken voor ':'Beheerrechten geven aan ')+a.display_name+'?'))return;setBusy(true);setStatus('');
      try{await eppCall('epp-auth',{clubId:CLUB_ID,action:'set_club_admin',accountId:a.id,enabled:!a.is_admin});await load();setStatus('Rechten opgeslagen. De gebruiker moet opnieuw inloggen.');}catch(e){setStatus(e.message);}finally{setBusy(false);}
    }},a.is_admin?'Beheerrechten intrekken':'Beheerrechten geven'),h('button',{className:'btn '+(scorer?'btn-danger':'btn-gold'),disabled:busy||a.active===false||a.membership_approved===false||!access||!access.managing||(!scorer&&(!eligible||access.closed)),style:{opacity:busy||a.active===false||a.membership_approved===false||!access||!access.managing||(!scorer&&(!eligible||access.closed))?0.45:1},onClick:()=>toggleScorer(a,!scorer)},scorer?'Scoorderrechten intrekken':'Scoorderrechten geven'),head&&a.id!==eppSession()?.account?.id&&h('button',{className:'btn btn-danger',disabled:busy,onClick:()=>remove(a)},'Account verwijderen'));}),
    status&&h('p',{className:'hint',role:'status'},status)));
};
