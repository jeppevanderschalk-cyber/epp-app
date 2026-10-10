const scoringError=e=>({schutter_in_bewerking:'Deze schutter wordt door een andere invoerder verwerkt.',reservering_verlopen:'De reservering is verlopen. Reserveer opnieuw voordat je opslaat.',geen_wedstrijdrechten:'Je hebt geen invoerrechten voor deze wedstrijd.',uitslag_definitief:'De uitslag is definitief; invoer is gesloten.',invoer_nog_actief:'Er zijn nog actieve reserveringen. Laat de invoerders eerst afronden.',wedstrijd_conflict:'De wedstrijdrechten zijn elders gewijzigd. Haal de nieuwste gegevens op.',publiceer_eerst_wedstrijdplanner:'Publiceer eerst de wedstrijdplanner als organisator.'}[e.message]||eppPlatformError(e.message));

const useScoreReservation=(matchId,shooterId,discipline,enabled)=>{
  const [lease,setLease]=React.useState(null),[status,setStatus]=React.useState(''),[retry,setRetry]=React.useState(0);
  const scope=[matchId,shooterId,discipline,retry].join(':');
  React.useEffect(()=>{
    let active=true,timer;
    setLease(null);setStatus('');
    if(!enabled||!matchId||!shooterId)return;
    const token=newId(),payload={clubId:CLUB_ID,matchId,shooterId,discipline,leaseToken:token};
    const release=()=>eppCall('epp-scoring',{...payload,action:'release'}).catch(()=>{});
    const claim=async()=>{
      try{
        await eppCall('epp-scoring',{...payload,action:'claim'});
        if(!active){await release();return;}
        setLease({scope,token});setStatus('Gereserveerd voor jouw invoer');
      }catch(e){if(active){clearInterval(timer);setLease(null);setStatus(scoringError(e));}}
    };
    claim();timer=setInterval(claim,25000);
    return()=>{active=false;clearInterval(timer);release();};
  },[scope,enabled]);
  return {token:lease?.scope===scope?lease.token:null,status,retry:()=>setRetry(v=>v+1)};
};

const MatchScoringManagement=({matchId,discipline,onClosed})=>{
  const [data,setData]=React.useState(null),[search,setSearch]=React.useState(''),[target,setTarget]=React.useState(''),[status,setStatus]=React.useState(''),[busy,setBusy]=React.useState(false);
  const load=React.useCallback(async()=>{try{const r=await eppCall('epp-scoring',{clubId:CLUB_ID,action:'view',matchId,discipline});setData(r);}catch(e){setStatus(scoringError(e));}},[matchId,discipline]);
  React.useEffect(()=>{setData(null);load();const timer=setInterval(load,10000);return()=>clearInterval(timer);},[load]);
  const control=async(control,accountId,enabled)=>{
    if(busy||!data)return;
    if(control==='close'&&!confirm('Deze wedstrijduitslag definitief maken? Hierna kunnen geen scores meer worden ingevoerd of gecorrigeerd.'))return;
    setBusy(true);setStatus('');
    try{await eppCall('epp-scoring',{clubId:CLUB_ID,action:'control',matchId,control,accountId,enabled,expectedRevision:data.revision});await load();if(control==='close')onClosed();setStatus(control==='close'?'Uitslag definitief gemaakt':'Invoerrechten opgeslagen');}
    catch(e){setStatus(scoringError(e));await load();}finally{setBusy(false);}
  };
  if(!data)return h('p',{className:'hint',role:'status'},status||'Wedstrijdrechten laden...');
  const assigned=new Set(data.scorers.map(s=>s.account_id));
  const names=new Map(data.accounts.map(a=>[a.id,a.display_name]));
  return h('section',{style:{display:'grid',gap:12}},
    h('p',{className:'hint',role:'status'},data.closed?'Uitslag definitief':'Wedstrijdinvoer open'),
    data.managing&&h('details',null,h('summary',{style:{padding:'12px 0',fontWeight:800}},'Wedstrijdinvoerders beheren'),
      h('div',{style:{display:'grid',gap:12}},
        h('input',{className:'txt-in',type:'search','aria-label':'Invoerder zoeken',placeholder:'Zoek naam of vereniging',value:search,onChange:e=>setSearch(e.target.value)}),
        h('select',{className:'txt-in','aria-label':'Wedstrijdinvoerder',value:target,onChange:e=>setTarget(e.target.value)},h('option',{value:''},'Kies persoonlijk account'),data.accounts.filter(a=>!assigned.has(a.id)&&(a.display_name+' '+a.club_code).toLowerCase().includes(search.toLowerCase())).map(a=>h('option',{key:a.id,value:a.id},a.display_name+' · '+a.club_code))),
        h('button',{className:'btn btn-gold',disabled:busy||!target||data.closed,onClick:()=>control('scorer',target,true)},'Invoerrechten geven'),
        data.accounts.filter(a=>assigned.has(a.id)).map(a=>h('div',{key:a.id,style:{display:'flex',gap:12,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap'}},h('span',null,a.display_name+' · '+a.club_code),h('button',{className:'btn btn-ghost',disabled:busy,onClick:()=>control('scorer',a.id,false)},'Rechten intrekken'))),
        h('button',{className:'btn btn-ghost',disabled:busy||data.closed,onClick:()=>control('close',null,true)},'Uitslag definitief maken'),
        h('details',null,h('summary',null,'Laatste scorewijzigingen'),data.audit.map((a,i)=>h('p',{key:i,className:'hint'},names.get(a.actor_id)||'Wedstrijdinvoerder',' · ',new Date(a.created_at).toLocaleString('nl-NL'),' · ',a.result?.final_score,' punten',a.reason?' · '+a.reason:''))))),
    status&&h('p',{className:'hint',role:'status'},status)
  );
};
