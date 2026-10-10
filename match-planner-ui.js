const plannerClock=value=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
const plannerDay=value=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'short',year:'numeric'}).format(new Date(value));
const plannerSlot=value=>plannerDay(value)+' · '+plannerClock(value);
const plannerConfigErrors={laatste_ronde_sluit_niet_aan:'De laatste starttijd sluit niet aan op de rondeduur en wisseltijd.',ongeldige_capaciteit:'Kies een bestaande ronde en een capaciteit van 1 tot 100.',ongeldige_planning:'Controleer de starttijden, rondeduur, capaciteit en inschrijfperiode.'};
const plannerError=e=>({tijdslot_vol:'Dit tijdslot is net volgeboekt. Kies een andere tijd.',overlappende_boeking:'Deze deelnames overlappen of hebben onvoldoende pauze ertussen.',planning_conflict:'De planning is elders gewijzigd. Haal de nieuwste versie op.',boeking_conflict:'Deze inschrijving is elders gewijzigd. Haal de nieuwste versie op.',bestaande_inschrijvingen_eerst_plannen:'Er zijn bestaande inschrijvingen zonder tijdslot. Deze moeten eerst gecontroleerd worden verwerkt; de app verplaatst ze niet automatisch.',geboekte_tijdsloten_behouden:'Deze wijziging zou bestaande boekingen veranderen of de capaciteit overschrijden.',geen_beheerrechten:'Je hebt geen beheerrechten voor deze vereniging.',inschrijving_gesloten:'De inschrijving is gesloten.',persoonlijk_schutterprofiel_verplicht:'Gebruik een persoonlijk account met schutter-ID.'}[e.message]||e.message);

const PlannerBooking=({view,target,onSaved,onReload})=>{
  const mine=target||view.mine;
  const [choices,setChoices]=React.useState(()=>Object.fromEntries(mine.choices.map(c=>[c.discipline,c.slotId])));
  const [revision]=React.useState(mine.revision),[reason,setReason]=React.useState(''),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState(''),[conflict,setConflict]=React.useState(false);
  const open=view.managing||(view.planner.published&&Date.now()>=Date.parse(view.planner.opens_at)&&Date.now()<=Date.parse(view.planner.closes_at));
  const canBook=target||view.profile;
  const save=async cancel=>{
    if(busy)return;setBusy(true);setStatus('');
    try{
      await eppCall('epp-planner',{clubId:CLUB_ID,action:'book',matchId:view.match.id,shooterId:target?.shooterId,choices:cancel?[]:Object.entries(choices).filter(([,id])=>id).map(([discipline,slotId])=>({discipline,slotId})),expectedRevision:revision,reason});
      await onSaved();setStatus(cancel?'Online afgemeld':'Boeking online bevestigd');
    }catch(e){setStatus(plannerError(e));setConflict(e.message==='boeking_conflict');}finally{setBusy(false);}
  };
  return h('section',{style:{display:'grid',gap:12}},
    h('h3',{style:{fontSize:18,margin:0}},target?'Inschrijving wijzigen: '+target.name:'Jouw tijdsloten'),
    !canBook&&h('p',{className:'hint'},'Een persoonlijk schutterprofiel is nodig om te boeken.'),
    !open&&h('p',{className:'hint'},Date.now()<Date.parse(view.planner.opens_at)?'Inschrijving opent '+new Date(view.planner.opens_at).toLocaleString('nl-NL'):'Inschrijving gesloten'),
    view.match.offered_disciplines.map(d=>h('label',{key:d},EPP_DISCIPLINES.find(x=>x.id===d)?.label||d,
      h('select',{className:'txt-in','aria-label':'Tijdslot '+d,disabled:busy||!open||!canBook,value:choices[d]||'',onChange:e=>setChoices(p=>({...p,[d]:e.target.value}))},
        h('option',{value:''},'Niet deelnemen'),view.slots.map(s=>{
          const own=mine.choices.some(c=>c.slotId===s.id);const full=s.booked>=s.capacity&&!own;
          return h('option',{key:s.id,value:s.id,disabled:full||Date.parse(s.starts_at)<=Date.now()},plannerSlot(s.starts_at)+' – '+plannerClock(s.ends_at)+' · '+(full?'Vol':Math.max(0,s.capacity-s.booked)+' plekken vrij'));
        })))),
    target&&h('label',null,'Reden wijziging',h('input',{className:'txt-in',value:reason,disabled:busy,onChange:e=>setReason(e.target.value)})),
    h('button',{className:'btn btn-gold',disabled:busy||!open||!canBook||!Object.values(choices).some(Boolean)||(target&&reason.trim().length<3),onClick:()=>save(false)},busy?'Opslaan...':'Tijdsloten bevestigen'),
    mine.choices.length>0&&h('button',{className:'btn btn-danger',disabled:busy||!open||(target&&reason.trim().length<3),onClick:()=>{if(confirm('Deze wedstrijdinschrijving afmelden?'))save(true);}},'Afmelden'),
    status&&h('p',{className:'hint',role:'status'},status),
    conflict&&h('button',{className:'btn btn-ghost',disabled:busy,onClick:()=>{if(confirm('Niet opgeslagen wijzigingen vervallen. Nieuwste inschrijving ophalen?'))onReload();}},'Nieuwste inschrijving ophalen')
  );
};

const PlannerEditor=({view,onSaved,onReload})=>{
  const m=view.match;
  const defaults={first:'09:00',last:'16:00',duration:30,changeover:0,capacity:4,gap:0,opens:new Date().toISOString(),closes:new Date(m.match_date+'T08:00:00+01:00').toISOString(),breaks:[],overrides:[],published:false};
  const [config,setConfig]=React.useState(view.planner?.config||defaults),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState(''),[confirmed,setConfirmed]=React.useState(false);
  const [revision]=React.useState(view.planner?.revision||0),[conflict,setConflict]=React.useState(false);
  const field=(key,label,type)=>h('label',{key},label,h('input',{className:'txt-in',type,value:config[key],required:true,min:type==='number'?key==='capacity'||key==='duration'?1:0:undefined,max:type==='number'?key==='capacity'?100:180:undefined,onChange:e=>setConfig(p=>({...p,[key]:type==='number'?Number(e.target.value):e.target.value}))}));
  const dateField=(key,label)=>{
    const local=new Date(config[key]);const text=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(config[key])?config[key]:Number.isNaN(local.valueOf())?'':new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(local).replace(' ','T');
    return h('label',{key},label,h('input',{className:'txt-in',type:'datetime-local',required:true,value:text,onChange:e=>{if(e.target.value)setConfig(p=>({...p,[key]:e.target.value}));}}));
  };
  const list=(key,labels)=>h('div',null,config[key].map((row,i)=>h('div',{key:i,style:{display:'flex',gap:8,flexWrap:'wrap',alignItems:'end'}},labels.map(([k,label,type])=>h('label',{key:k,style:{flex:'1 1 100px'}},label,h('input',{className:'txt-in',type,required:true,min:type==='number'?1:undefined,max:type==='number'?100:undefined,value:row[k],onChange:e=>setConfig(p=>({...p,[key]:p[key].map((r,j)=>j===i?{...r,[k]:type==='number'?Number(e.target.value):e.target.value}:r)}))}))),h('button',{type:'button',className:'btn btn-ghost','aria-label':'Verwijder '+key+' '+(i+1),onClick:()=>setConfig(p=>({...p,[key]:p[key].filter((_,j)=>j!==i)}))},'×'))),h('button',{type:'button',className:'btn btn-ghost',onClick:()=>setConfig(p=>({...p,[key]:[...p[key],key==='breaks'?{start:'12:00',end:'13:00'}:{start:'09:00',capacity:p.capacity}]}))},key==='breaks'?'+ Pauze':'+ Afwijkende capaciteit'));
  return h('form',{style:{display:'grid',gap:12},onSubmit:async e=>{
    e.preventDefault();if(busy||!confirmed)return;setBusy(true);setStatus('');
    try{await eppCall('epp-planner',{clubId:CLUB_ID,action:'configure',matchId:m.id,config,expectedRevision:revision});await onSaved();setStatus('Planning online opgeslagen');}
    catch(error){setStatus(plannerConfigErrors[error.message]||plannerError(error));setConflict(error.message==='planning_conflict');}finally{setBusy(false);}
  }},h('h3',{style:{fontSize:18}},'Planning instellen'),h('p',{className:'hint'},eppFmtMatchDates(m)),h('fieldset',{disabled:busy,style:{border:0,padding:0,minWidth:0,display:'grid',gap:12}},
    field('first','Eerste ronde start','time'),field('last','Laatste ronde start','time'),field('duration','Rondeduur (minuten)','number'),field('changeover','Wisseltijd (minuten)','number'),field('capacity','Schietplaatsen per ronde','number'),field('gap','Minimale pauze tussen deelnames (minuten)','number'),dateField('opens','Inschrijving opent'),dateField('closes','Inschrijving sluit'),
    list('breaks',[['start','Pauze vanaf','time'],['end','Pauze tot','time']]),list('overrides',[['start','Start ronde','time'],['capacity','Schietplaatsen','number']]),
    h('label',{className:'chk-row'},h('input',{type:'checkbox',checked:config.published,onChange:e=>setConfig(p=>({...p,published:e.target.checked}))}),'Planner publiceren'),
    h('label',{className:'chk-row'},h('input',{type:'checkbox',checked:confirmed,onChange:e=>setConfirmed(e.target.checked)}),'Onze vereniging organiseert deze wedstrijd'),
    h('button',{type:'submit',className:'btn btn-gold',disabled:!confirmed},busy?'Opslaan...':'Planning opslaan')),
    status&&h('p',{className:'hint',role:'status'},status),conflict&&h('button',{type:'button',className:'btn btn-ghost',disabled:busy,onClick:()=>{if(confirm('Niet opgeslagen wijzigingen vervallen. Nieuwste planning ophalen?'))onReload();}},'Nieuwste planning ophalen'));
};

const MatchPlanner=({matchId,manage=false})=>{
  const [view,setView]=React.useState(null),[status,setStatus]=React.useState(''),[version,setVersion]=React.useState(0),[target,setTarget]=React.useState(null);
  const load=React.useCallback(async()=>{
    try{const r=await eppCall('epp-planner',{clubId:CLUB_ID,action:'view',matchId});setView(r);setStatus('');return r;}catch(e){setStatus(plannerError(e));}
  },[matchId]);
  React.useEffect(()=>{let active=true;load();const timer=setInterval(()=>{if(active)load();},10000);return()=>{active=false;clearInterval(timer);};},[load]);
  const saved=async()=>{await load();setVersion(v=>v+1);setTarget(null);setStatus('Online opgeslagen');};
  const reload=async()=>{const latest=await load();if(!latest)return;setVersion(v=>v+1);if(target)setTarget(latest.roster.find(r=>r.shooterId===target.shooterId)||null);};
  return h('section',{style:{display:'grid',gap:14}},
    status&&h('p',{className:'hint',role:'status'},status),
    !view?h('p',{className:'hint'},'Planner laden...'):h(React.Fragment,null,
      manage&&view.managing&&h(PlannerEditor,{key:'editor-'+version,view,onSaved:saved,onReload:reload}),
      view.planner&&h(React.Fragment,null,
        h('h3',{style:{fontSize:18,margin:0}},'Tijdsloten'),
        h('div',{style:{display:'grid',gap:6}},view.slots.map(s=>h('div',{key:s.id,style:{display:'flex',gap:8,justifyContent:'space-between',borderBottom:'1px solid '+C.border,padding:'8px 0'}},h('span',{style:{minWidth:0,overflowWrap:'anywhere'}},plannerSlot(s.starts_at)+' – '+plannerClock(s.ends_at)),h('span',null,s.booked+'/'+s.capacity)))),
        (!manage||view.profile||target)&&h(PlannerBooking,{key:'booking-'+version+(target?.shooterId||''),view,target,onSaved:saved,onReload:reload}),
        manage&&view.managing&&h(React.Fragment,null,h('h3',{style:{fontSize:18}},'Deelnemers per ronde'),
          view.roster.some(r=>r.choices.some(c=>!c.slotId))&&h('section',null,h('h4',null,'Nog in te plannen'),view.roster.filter(r=>r.choices.some(c=>!c.slotId)).map(r=>h('div',{key:r.shooterId||r.name,style:{display:'grid',gap:6,padding:'10px 0',borderBottom:'1px solid '+C.border}},h('strong',null,r.name),h('small',null,(r.preferences||[]).map(p=>(EPP_DISCIPLINES.find(d=>d.id===p.discipline)?.label||p.discipline)+' · '+(p.specific_time||p.time_block)).join(', ')),h('button',{className:'btn btn-ghost',disabled:!r.shooterId,onClick:()=>setTarget(r)},r.shooterId?'Tijdslot toewijzen':'Eerst schutter-ID koppelen in groepslijst')))),
          view.slots.map(s=>h('section',{key:s.id},h('h4',{style:{margin:'12px 0 6px'}},plannerSlot(s.starts_at)+' · '+s.booked+'/'+s.capacity),view.roster.filter(r=>r.choices.some(c=>c.slotId===s.id)).map(r=>h('div',{key:r.shooterId,style:{padding:'8px 0',borderBottom:'1px solid '+C.border,display:'grid',gap:6}},h('strong',null,r.name),h('small',null,r.clubs.join(', ')+' · '+r.publicId+' · '+r.choices.filter(c=>c.slotId===s.id).map(c=>EPP_DISCIPLINES.find(d=>d.id===c.discipline)?.label||c.discipline).join(', ')),h('button',{className:'btn btn-ghost',onClick:()=>setTarget(r)},'Verplaatsen / afmelden'))))),
          h('details',null,h('summary',null,'Recente wijzigingen'),view.audit.map(a=>h('p',{key:a.id,className:'hint'},new Date(a.created_at).toLocaleString('nl-NL')+' · '+a.action+' · '+a.actor_id+(a.reason?' · '+a.reason:'')))))
      )));
};

const MatchPlannerCatalog=()=>{
  const [matches,setMatches]=React.useState([]),[status,setStatus]=React.useState('');
  React.useEffect(()=>{let active=true;const load=()=>eppCall('epp-planner',{clubId:CLUB_ID,action:'catalog'}).then(r=>{if(active){setMatches(r.matches);setStatus('');}}).catch(e=>{if(active)setStatus(plannerError(e));});load();const timer=setInterval(load,10000);return()=>{active=false;clearInterval(timer);};},[]);
  return h('section',{style:{display:'grid',gap:16}},status&&h('p',{className:'hint',role:'status'},status),matches.map(m=>h('details',{key:m.id},h('summary',{style:{fontWeight:800,padding:'12px 0'}},m.organizer+' · '+eppFmtMatchDates(m)),h(MatchPlanner,{matchId:m.id}))));
};

const PlatformAccessManagement=()=>{
  const [clubs,setClubs]=React.useState([]),[accounts,setAccounts]=React.useState([]),[club,setClub]=React.useState('svbb'),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState('');
  const [matches,setMatches]=React.useState([]),[match,setMatch]=React.useState(''),[access,setAccess]=React.useState(null);
  const request=React.useRef(0);
  const load=async()=>{try{const r=await eppCall('epp-auth',{clubId:CLUB_ID,action:'list_club_access'});setClubs(r.clubs);setAccounts(r.accounts);}catch(e){setStatus(e.message);}};
  React.useEffect(()=>{load();},[]);
  React.useEffect(()=>{let active=true;eppCall('epp-scoring',{clubId:CLUB_ID,action:'catalog'}).then(r=>{if(active)setMatches(r.matches);}).catch(e=>{if(active)setStatus(e.message);});return()=>{active=false;};},[]);
  React.useEffect(()=>{
    const version=++request.current;setAccess(null);
    if(match)eppCall('epp-scoring',{clubId:CLUB_ID,action:'view',matchId:match}).then(r=>{if(request.current===version)setAccess(r);}).catch(e=>{if(request.current===version)setStatus(e.message);});
    return()=>{request.current++;};
  },[match]);
  const toggleScorer=async(a,enabled)=>{
    if(!access||!confirm((enabled?'Scoorderrechten geven aan ':'Scoorderrechten intrekken voor ')+a.display_name+' voor deze wedstrijd?'))return;
    const version=request.current,selected=match;setBusy(true);setStatus('');
    try{
      await eppCall('epp-scoring',{clubId:CLUB_ID,action:'control',matchId:access.matchId,control:'scorer',accountId:a.id,enabled,expectedRevision:access.revision});
      setStatus('Scoorderrechten opgeslagen.');
    }catch(e){setStatus(e.message==='wedstrijd_conflict'?'Rechten zijn intussen gewijzigd. Controleer de bijgewerkte lijst en probeer opnieuw.':e.message);}
    finally{
      try{const r=await eppCall('epp-scoring',{clubId:CLUB_ID,action:'view',matchId:selected});if(request.current===version)setAccess(r);}catch(e){if(request.current===version){setAccess(null);setStatus(e.message);}}
      setBusy(false);
    }
  };
  return h('section',null,h('div',{className:'card-head'},h('div',{className:'eyebrow'},'Hoofdbeheer · verenigingsrechten')),h('div',{className:'card-body',style:{display:'grid',gap:12}},
    h('label',null,'Vereniging',h('select',{className:'txt-in','aria-label':'Vereniging voor beheerrechten',value:club,disabled:busy,onChange:e=>setClub(e.target.value)},clubs.map(c=>h('option',{key:c.code,value:c.code},c.naam)))),
    h('label',null,'Wedstrijd voor scoorderrechten',h('select',{className:'txt-in','aria-label':'Wedstrijd voor scoorderrechten',value:match,disabled:busy,onChange:e=>{setStatus('');setMatch(e.target.value);}},h('option',{value:''},'Kies wedstrijd'),matches.map(m=>h('option',{key:m.id,value:m.id},eppFmtDate(m.match_date)+' · '+m.organizer+(m.closed?' · Definitief':''))))),
    accounts.filter(a=>a.club_code===club&&!a.is_platform_admin).map(a=>{const scorer=access?.scorers?.some(s=>s.account_id===a.id),eligible=access?.accounts?.some(s=>s.id===a.id);return h('div',{key:a.id,role:'group','aria-label':a.display_name,style:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',borderBottom:'1px solid '+C.border,padding:'10px 0'}},h('div',{style:{flex:'1 1 100%',minWidth:0,overflowWrap:'anywhere'}},a.display_name,h('small',{style:{display:'block'}},(a.is_admin?'Verenigingsbeheerder':'Schutter')+(scorer?' · Scoorder voor deze wedstrijd':''))),h('button',{className:'btn '+(a.is_admin?'btn-danger':'btn-gold'),disabled:busy,onClick:async()=>{
      if(!confirm((a.is_admin?'Beheerrechten intrekken voor ':'Beheerrechten geven aan ')+a.display_name+'?'))return;setBusy(true);setStatus('');
      try{await eppCall('epp-auth',{clubId:CLUB_ID,action:'set_club_admin',accountId:a.id,enabled:!a.is_admin});await load();setStatus('Rechten opgeslagen. De gebruiker moet opnieuw inloggen.');}catch(e){setStatus(e.message);}finally{setBusy(false);}
    }},a.is_admin?'Beheerrechten intrekken':'Beheerrechten geven'),h('button',{className:'btn '+(scorer?'btn-danger':'btn-gold'),disabled:busy||!access||!access.managing||(!scorer&&(!eligible||access.closed)),style:{opacity:busy||!access||!access.managing||(!scorer&&(!eligible||access.closed))?0.45:1},onClick:()=>toggleScorer(a,!scorer)},scorer?'Scoorderrechten intrekken':'Scoorderrechten geven'));}),
    status&&h('p',{className:'hint',role:'status'},status)));
};
