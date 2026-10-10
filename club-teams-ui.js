const teamError=e=>({geen_beheerrechten:'Alleen de beheerder van je eigen vereniging kan teams wijzigen.',vier_unieke_schutters_verplicht:'Selecteer vier verschillende schutters.',schutter_niet_van_vereniging:'Deze schutter is op de wedstrijddatum niet verbonden aan je vereniging.',schutter_al_in_team:'Een schutter zit al in een ander team voor deze wedstrijd en discipline.',team_conflict:'Dit team is elders gewijzigd. Haal de nieuwste versie op.',team_vast_na_score:'De teamsamenstelling staat vast zodra een teamlid een bevestigde wedstrijdscore heeft.',ongeldige_wedstrijd_of_discipline:'Kies een wedstrijd en een aangeboden discipline.'}[e.message]||(/duplicate key/.test(e.message)?'Dit teamnummer bestaat al. Kies een ander nummer.':e.message));

const ClubTeams=({directoryOnly=false})=>{
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
  React.useEffect(()=>{setData(null);setEditing(null);setStatus('');load();const timer=setInterval(load,10000);return()=>{++request.current;clearInterval(timer);};},[load]);
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
      h('label',null,'Wedstrijd',h('select',{className:'txt-in','aria-label':'Teamwedstrijd',value:matchId,disabled:busy,onChange:e=>{setMatchId(e.target.value);setEditing(null);}},h('option',{value:''},'Kies wedstrijd'),(data?.matches||[]).map(m=>h('option',{key:m.id,value:m.id},m.match_date+' · '+m.organizer)))),
      h('label',null,'Discipline',h('select',{className:'txt-in','aria-label':'Teamdiscipline',value:discipline,disabled:busy,onChange:e=>{setDiscipline(e.target.value);setEditing(null);}},(match?.offered_disciplines||['pistool','optiek']).map(d=>h('option',{key:d,value:d},label(d))))),
      matchId&&data?.canManage&&h('section',{style:{display:'grid',gap:12}},h('h3',null,'Teams van jouw vereniging'),
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
      (data?.teams||[]).map(t=>h('section',{key:t.id,style:{borderBottom:'1px solid '+C.border,padding:'12px 0',overflowWrap:'anywhere'}},
        h('div',{style:{display:'flex',justifyContent:'space-between',gap:12}},h('strong',null,(t.position?t.position+'. ':'')+'Team '+t.number+' · '+t.club),h('strong',{style:{whiteSpace:'nowrap'}},t.completed===4?t.score+' / 1000':t.completed+' / 4 scores')),
        h('ul',{style:{paddingLeft:20,marginBottom:0}},t.members.map(s=>h('li',{key:s.id},s.name+' · '+s.club+' · '+(s.score==null?'Nog geen score':s.score+' punten')))),
        data.canManage&&t.clubCode===data.clubCode&&h('div',{style:{display:'grid',gap:8,marginTop:12}},h('button',{type:'button',className:'btn btn-ghost',disabled:busy||t.locked,onClick:()=>editTeam(t)},'Team bewerken'),t.locked&&h('p',{className:'hint',style:{margin:0}},'Vastgelegd: er zijn bevestigde wedstrijdscores.'))))
    ),
    !data&&!status&&h('p',{className:'hint'},'Laden...'),
    status&&h('p',{className:'hint',role:'status'},status)
  );
};
