const IndependentTeams=({data,matchId,discipline,onSaved})=>{
  const groups=data?.teamGroups||[];
  const [selectedGroup,setSelectedGroup]=React.useState(''),[editing,setEditing]=React.useState(null),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState(''),[links,setLinks]=React.useState({});
  const group=groups.find(g=>g.id===selectedGroup)||groups[0];
  const team=(data?.teams||[]).find(t=>t.groupId===group?.id);
  React.useEffect(()=>{setEditing(null);setStatus('');setLinks({});},[matchId,discipline,group?.id]);
  if(!group)return null;
  const used=new Set((data.teams||[]).filter(t=>t.id!==team?.id).flatMap(t=>t.members.map(m=>m.id)));
  const active=editing?.members||team?.members.map(m=>m.id)||[];
  const reserves=group.members.filter(m=>!active.includes(m.id));
  const save=async remove=>{
    if(busy||!group.canManage||(!remove&&!editing))return;
    if(remove&&!confirm('Deze teamopstelling verwijderen? Individuele inschrijvingen en scores blijven behouden.'))return;
    setBusy(true);setStatus('');
    try{
      await eppCall('epp-teams',{clubId:CLUB_ID,action:remove?'delete_group_lineup':'save_group_lineup',groupId:group.id,matchId,discipline,members:remove?[]:editing.members,expectedRevision:editing?.revision??team?.revision??0});
      setEditing(null);await onSaved();setStatus(remove?'Teamopstelling verwijderd':'Teamopstelling online opgeslagen');
    }catch(e){setStatus(teamError(e));}finally{setBusy(false);}
  };
  const link=async member=>{
    if(busy||!links[member.memberId])return;setBusy(true);setStatus('');
    try{await eppCall('epp-teams',{clubId:CLUB_ID,action:'link_group_member',groupId:group.id,memberId:member.memberId,shooterId:links[member.memberId],expectedRevision:group.revision});await onSaved();setLinks({});setStatus('Schutterprofiel gekoppeld');}
    catch(e){setStatus(teamError(e));}finally{setBusy(false);}
  };
  return h('section',{'aria-label':'Zelfstandig team',style:{display:'grid',gap:12,border:'1px solid '+C.border,borderRadius:12,padding:16,minWidth:0}},
    h('h3',{style:{margin:0}},group.name+' · zelfstandig team'),
    groups.length>1&&h('label',null,'Teamgroep',h('select',{className:'txt-in',value:group.id,disabled:busy,onChange:e=>setSelectedGroup(e.target.value)},groups.map(g=>h('option',{key:g.id,value:g.id},g.name)))),
    h('p',{className:'hint',style:{margin:0}},group.members.length+' teamleden. Kies per wedstrijd en discipline vier schutters; de overige teamleden zijn reserve. Iedereen behoudt de eigen vereniging en individuele uitslag.'),
    h('ul',{style:{margin:0,paddingLeft:20}},group.members.map(m=>h('li',{key:m.memberId},m.name+(m.id?' · '+(m.clubs||[]).map(c=>c.name).join(' / '):' · Nog geen schutterprofiel gekoppeld')))),
    group.canLink&&group.members.filter(m=>!m.id).map(m=>h('div',{key:m.memberId,style:{display:'grid',gap:8}},h('label',null,'Schutterprofiel voor '+m.name,h('select',{className:'txt-in','aria-label':'Schutterprofiel voor '+m.name,value:links[m.memberId]||'',disabled:busy,onChange:e=>setLinks(p=>({...p,[m.memberId]:e.target.value}))},h('option',{value:''},'Kies het juiste schutterprofiel'),(data.shooters||[]).map(s=>h('option',{key:s.id,value:s.id,disabled:group.members.some(m=>m.id===s.id)},s.name+' · '+s.publicId)))),h('button',{className:'btn btn-ghost',disabled:busy||!links[m.memberId],onClick:()=>link(m)},'Profiel koppelen aan '+m.name))),
    !matchId&&h('p',{className:'hint'},'Kies een wedstrijd om de vier schutters voor de teamuitslag aan te wijzen.'),
    matchId&&group.canManage&&!editing&&h('button',{className:'btn btn-gold',disabled:busy||team?.locked||group.members.filter(m=>m.id).length<4,onClick:()=>{setStatus('');setEditing({revision:team?.revision||0,members:team?.members.map(m=>m.id)||['','','','']});}},team?'Opstelling wijzigen':'Vier schutters aanwijzen'),
    matchId&&group.canManage&&group.members.filter(m=>m.id).length<4&&h('p',{className:'hint'},'Er moeten eerst minstens vier schutterprofielen aan dit team gekoppeld zijn.'),
    matchId&&team?.locked&&h('p',{className:'hint'},'De opstelling staat vast: er zijn bevestigde wedstrijdscores.'),
    matchId&&!!active.length&&h('p',{className:'hint'},'Reserve: '+(reserves.map(m=>m.name).join(', ')||'geen')),
    editing&&h('fieldset',{disabled:busy||team?.locked,style:{border:0,padding:0,margin:0,minWidth:0,display:'grid',gap:12}},
      h('legend',null,'Opstelling '+group.name),
      editing.members.map((id,i)=>h('label',{key:i},'Teamschutter '+(i+1),h('select',{className:'txt-in','aria-label':group.name+' schutter '+(i+1),value:id,onChange:e=>setEditing(p=>({...p,members:p.members.map((v,j)=>j===i?e.target.value:v)}))},h('option',{value:''},'Kies schutter'),group.members.filter(m=>m.id).map(m=>h('option',{key:m.id,value:m.id,disabled:used.has(m.id)||(editing.members.includes(m.id)&&m.id!==id)},m.name))))),
      h('button',{className:'btn btn-gold',disabled:editing.members.some(id=>!id)||new Set(editing.members).size!==4,onClick:()=>save(false)},'Opstelling opslaan'),
      team&&h('button',{className:'btn btn-danger',onClick:()=>save(true)},'Opstelling verwijderen')),
    editing&&h('button',{className:'btn btn-ghost',disabled:busy,onClick:()=>setEditing(null)},'Sluiten'),
    status&&h('p',{className:'hint',role:'status'},status)
  );
};

const teamError=e=>({geen_beheerrechten:'Je hebt geen rechten om dit team te wijzigen.',schutter_niet_in_teamgroep:'Kies vier gekoppelde schutters uit deze teamgroep.',teamlid_al_gekoppeld:'Dit teamlid heeft al een gekoppeld schutterprofiel.',schutter_al_in_teamgroep:'Dit schutterprofiel is al aan de teamgroep gekoppeld.',vier_unieke_schutters_verplicht:'Selecteer vier verschillende schutters.',schutter_niet_van_vereniging:'Deze schutter is op de wedstrijddatum niet verbonden aan je vereniging.',schutter_al_in_team:'Een schutter zit al in een ander team voor deze wedstrijd en discipline.',team_conflict:'Dit team is elders gewijzigd. Haal de nieuwste versie op.',team_vast_na_score:'De teamsamenstelling staat vast zodra een teamlid een bevestigde wedstrijdscore heeft.',ongeldige_wedstrijd_of_discipline:'Kies een wedstrijd en een aangeboden discipline.'}[e.message]||(/duplicate key/.test(e.message)?'Dit teamnummer bestaat al. Kies een ander nummer.':e.message));

const ClubTeams=({directoryOnly=false,resultsOnly=false})=>{
  const [data,setData]=React.useState(null),[matchId,setMatchId]=React.useState(''),[discipline,setDiscipline]=React.useState('pistool');
  const [query,setQuery]=React.useState(''),[status,setStatus]=React.useState(''),[busy,setBusy]=React.useState(false),[editing,setEditing]=React.useState(null);
  const request=React.useRef(0);
  const editorRef=React.useRef(null);
  React.useEffect(()=>{if(editing)editorRef.current?.scrollIntoView({block:'start',behavior:'smooth'});},[editing?.id]);
  const load=React.useCallback(async()=>{
    const sequence=++request.current;
    try{const r=await eppCall('epp-teams',{clubId:CLUB_ID,action:'context',matchId:directoryOnly?null:matchId||null,discipline});if(sequence===request.current){setData(r);return r;}}
    catch(e){if(sequence===request.current)setStatus('Ophalen mislukt: '+teamError(e));}
  },[matchId,discipline,directoryOnly]);
  React.useEffect(()=>{setData(null);setEditing(null);setStatus('');load();const timer=eppPoll(load,10000);return()=>{++request.current;clearInterval(timer);};},[load]);
  React.useEffect(()=>{const m=data?.matches.find(m=>m.id===matchId);if(m&&!m.offered_disciplines.includes(discipline))setDiscipline(m.offered_disciplines[0]);},[data,matchId,discipline]);
  const own=(data?.shooters||[]).filter(s=>s.clubs.some(c=>c.code===data.clubCode));
  const ownTeams=(data?.teams||[]).filter(t=>t.clubCode===data.clubCode);
  const used=new Set((data?.teams||[]).filter(t=>t.id!==editing?.id).flatMap(t=>t.members.map(s=>s.id)));
  const begin=team=>{setStatus('');setEditing(team?{id:team.id,number:team.number,revision:team.revision,members:team.members.map(s=>s.id)}:{id:newId(),number:Array.from({length:99},(_,i)=>i+1).find(n=>!ownTeams.some(t=>t.number===n)),revision:0,members:['','','','']});};
  const editTeam=team=>{
    if(busy||!data?.canManage||team.clubCode!==data.clubCode||team.locked)return;
    if(editing&&!confirm('Niet opgeslagen teamwijzigingen vervallen. Doorgaan?'))return;
    begin(team);
  };
  const save=async remove=>{
    if(busy||!editing)return;if(remove&&!confirm('Dit team verwijderen? Individuele scores blijven behouden.'))return;
    setBusy(true);setStatus('');
    try{await eppCall('epp-teams',{clubId:CLUB_ID,action:remove?'delete':'save',matchId,discipline,teamId:editing.id,number:Number(editing.number),members:editing.members,expectedRevision:editing.revision});setEditing(null);await load();setStatus(remove?'Team verwijderd':'Team online opgeslagen');}
    catch(e){setStatus(teamError(e));}finally{setBusy(false);}
  };
  const label=d=>({pistool:'Pistool',optiek:'Open (Optics)',pcc:'PCC'}[d]||d);
  const match=data?.matches.find(m=>m.id===matchId);
  const visible=(data?.shooters||[]).filter(s=>(s.name+' '+s.publicId+' '+s.clubs.map(c=>c.name).join(' ')).toLocaleLowerCase('nl').includes(query.toLocaleLowerCase('nl')));
  return h('section',{style:{display:'grid',gap:16,minWidth:0}},
    directoryOnly?h(React.Fragment,null,
      h('h3',null,'Schutters en verenigingen'),
      h('input',{className:'txt-in',type:'search','aria-label':'Zoek schutter of vereniging',value:query,onChange:e=>setQuery(e.target.value)}),
      visible.map(s=>h('div',{key:s.id,style:{padding:'12px 0',borderBottom:'1px solid '+C.border,overflowWrap:'anywhere'}},h('strong',null,s.name),h('div',{className:'hint'},s.clubs.map(c=>c.name).join(' · ')||'Geen vereniging gekoppeld'),h('small',{className:'hint'},s.publicId)))
    ):h(React.Fragment,null,
      h('h2',null,resultsOnly?'Teamuitslag':'Teams samenstellen'),
      h('p',{className:'hint'},resultsOnly?'De totaalscore is de som van de vier bevestigde wedstrijdscores. Teams met vier scores worden gerangschikt per wedstrijd en discipline.':'Verenigingsteams bestaan uit vier schutters van dezelfde vereniging. Zelfstandige teams kiezen per wedstrijd en discipline vier schutters uit hun teamgroep. Bekijk de gezamenlijke scores bij Teamuitslag.'),
      h('label',null,'Wedstrijd',h('select',{className:'txt-in','aria-label':'Teamwedstrijd',value:matchId,disabled:busy,onChange:e=>{setMatchId(e.target.value);setEditing(null);}},h('option',{value:''},'Kies wedstrijd'),(data?.matches||[]).map(m=>h('option',{key:m.id,value:m.id},m.match_date+' · '+m.organizer)))),
      h('label',null,'Discipline',h('select',{className:'txt-in','aria-label':'Teamdiscipline',value:discipline,disabled:busy,onChange:e=>{setDiscipline(e.target.value);setEditing(null);}},(match?.offered_disciplines||['pistool','optiek']).map(d=>h('option',{key:d,value:d},label(d))))),
      !resultsOnly&&h(IndependentTeams,{data,matchId,discipline,onSaved:load}),
      matchId&&!resultsOnly&&data?.canManage&&h('section',{style:{display:'grid',gap:12}},h('h3',null,'Teams van jouw vereniging'),
        h('select',{className:'txt-in','aria-label':'Eigen team',disabled:busy,value:editing?.id||'',onChange:e=>{if(editing&&!confirm('Niet opgeslagen teamwijzigingen vervallen. Doorgaan?'))return;const t=ownTeams.find(t=>t.id===e.target.value);if(t)begin(t);else setEditing(null);}},h('option',{value:''},'Kies team'),ownTeams.map(t=>h('option',{key:t.id,value:t.id},'Team '+t.number+' · '+t.club+(t.locked?' · vastgelegd':'')))),
        !editing&&h('button',{className:'btn btn-ghost',disabled:busy||ownTeams.length>=99,onClick:()=>begin(null)},'Nieuw team'),
        editing&&h('fieldset',{ref:editorRef,disabled:busy||ownTeams.find(t=>t.id===editing.id)?.locked,style:{border:0,padding:0,minWidth:0,display:'grid',gap:12}},
          h('legend',{style:{fontWeight:800,marginBottom:12}},editing.revision>0?'Team bewerken':'Nieuw team'),
          h('label',null,'Teamnummer',h('input',{className:'txt-in',type:'number',min:1,max:99,value:editing.number,onChange:e=>setEditing(p=>({...p,number:e.target.value}))})),
          editing.members.map((id,i)=>h('label',{key:i},'Schutter '+(i+1),h('select',{className:'txt-in','aria-label':'Teamlid '+(i+1),value:id,onChange:e=>setEditing(p=>({...p,members:p.members.map((v,j)=>j===i?e.target.value:v)}))},h('option',{value:''},'Kies schutter'),own.map(s=>h('option',{key:s.id,value:s.id,disabled:used.has(s.id)||(editing.members.includes(s.id)&&s.id!==id)},s.name+' · '+s.clubs.map(c=>c.name).join(' / ')))))),
          h('button',{className:'btn btn-gold',disabled:editing.members.some(id=>!id)||new Set(editing.members).size!==4,onClick:()=>save(false)},busy?'Opslaan...':'Team opslaan'),
          editing.revision>0&&h('button',{className:'btn btn-ghost',onClick:()=>save(true)},'Team verwijderen')),
        editing&&h('button',{className:'btn btn-ghost',disabled:busy,onClick:()=>setEditing(null)},'Sluiten'),
        editing&&ownTeams.find(t=>t.id===editing.id)?.locked&&h('p',{className:'hint'},'Dit team is vastgelegd omdat er bevestigde wedstrijdscores zijn.'),
        status.includes('elders gewijzigd')&&h('button',{className:'btn btn-ghost',disabled:busy,onClick:async()=>{if(confirm('Niet opgeslagen wijzigingen vervallen. Nieuwste team ophalen?')){const r=await load();const t=r?.teams.find(t=>t.id===editing?.id);if(t)begin(t);else setEditing(null);}}},'Nieuwste team ophalen')),
      h('h3',null,'Teamuitslag · '+label(discipline)),
      !matchId&&h('p',{className:'hint'},'Kies wedstrijd'),
      matchId&&!(data?.teams||[]).length&&h('p',{className:'hint'},'Nog geen teams'),
      (data?.teams||[]).map(t=>h('section',{key:t.id,style:{overflowWrap:'anywhere'}},
        h('details',{className:'team-result'},h('summary',null,h('strong',null,(t.position?t.position+'. ':'')+(t.groupId?(t.teamName||t.club):'Team '+t.number+' · '+t.club)),h('strong',{style:{whiteSpace:'nowrap'}},t.completed===4?t.score+' / 1000':t.score+' punten · '+t.completed+' / 4 scores')),
        h('ul',{style:{paddingLeft:20,marginBottom:0}},t.members.map(s=>h('li',{key:s.id},s.name+' · '+s.club+' · '+(s.score==null?'Nog geen score':s.score+' punten'))))),
        !resultsOnly&&!t.groupId&&data.canManage&&t.clubCode===data.clubCode&&h('div',{style:{display:'grid',gap:8,marginTop:12}},h('button',{type:'button',className:'btn btn-ghost',disabled:busy||t.locked,onClick:()=>editTeam(t)},'Team bewerken'),t.locked&&h('p',{className:'hint',style:{margin:0}},'Vastgelegd: er zijn bevestigde wedstrijdscores.'))))
    ),
    !data&&!status&&h('p',{className:'hint'},'Laden...'),
    status&&h('p',{className:'hint',role:'status'},status)
  );
};
