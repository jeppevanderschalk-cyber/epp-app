const HeadClubSelector=({clubs,value,onChange,disabled})=>h('label',{className:'head-club-selector'},
  h('span',null,'Vereniging'),
  h('select',{'aria-label':'Vereniging bekijken',value,onChange:e=>onChange(e.target.value),disabled},
    h('option',{value:''},'Hoofdbeheer'),clubs.filter(c=>c.code!==eppSession()?.account?.clubId).map(c=>h('option',{key:c.code,value:c.code},c.naam))));

const HeadClubViewer=({clubId,clubs,onChange,onExit})=>{
  const [snapshot,setSnapshot]=React.useState(null),[status,setStatus]=React.useState('Laden...'),[tab,setTab]=React.useState('training');
  React.useEffect(()=>{
    let active=true;
    const load=async()=>{
      try{
        const result=await eppCall('epp-head-view',{clubId:eppSession().account.clubId,action:'view',targetClubId:clubId});
        if(active){setSnapshot({...result,payload:EppStore.decode(result.entities||[])});setStatus('Online bijgewerkt');}
      }catch(e){if(active)setStatus('Bekijken mislukt: '+e.message);}
    };
    load();const timer=setInterval(load,10000);return()=>{active=false;clearInterval(timer);};
  },[clubId]);
  const payload=snapshot?.payload;
  const clubName=snapshot?.club?.naam||clubs.find(c=>c.code===clubId)?.naam||clubId;
  return h('div',{className:'app'},h('style',null,CSS),
    h('header',{className:'topbar'},h('div',{className:'topbar-inner'},
      h('div',{className:'topbar-logo'},h(EPPLogo,{size:53})),
      h('div',{className:'topbar-title'},h('h1',null,'EPP score app'),h('div',{className:'topbar-sub'},'Europees Praktijk Parcours')),
      h(HeadClubSelector,{clubs,value:clubId,onChange})),h('div',{className:'gold-stripe'})),
    h('main',{className:'main'},
      h('div',{style:{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:16}},h('strong',{style:{overflowWrap:'anywhere'}},clubName),h('span',{className:'hint'},'Alleen bekijken')),
      h('p',{role:'status',className:'hint'},status),
      !payload?h('p',{className:'hint'},'Gegevens laden...'):tab==='training'
        ?h(TabTraining,{shooters:payload.shooters||[],currentTraining:ensureTraining(payload.currentTraining),archives:payload.archives||[],isTrainer:false})
        :h(TabStand,{shooters:payload.shooters||[],bestParcours:payload.bestParcours||{},bestStageAverages:payload.bestStageAverages||{},maxOf:key=>({...DEFAULT_SHOTS,...payload.stageShots}[key]||0)*5,qualificationRecords:snapshot.qualifications||[]})),
    h('nav',{className:'bottomnav',style:{gridTemplateColumns:'repeat(3,1fr)'}},
      [['training','Training',Icon.chart],['stand','Stand',Icon.trophy]].map(([id,label,icon])=>h('button',{key:id,className:'bnav-btn','data-on':tab===id?'1':'0',onClick:()=>setTab(id)},icon(),label)),
      h('button',{className:'bnav-btn',onClick:onExit},Icon.gear(),'Hoofdbeheer')));
};

const HeadWorkspace=()=>{
  const [clubs,setClubs]=React.useState([]),[club,setClub]=React.useState(''),[status,setStatus]=React.useState('');
  React.useEffect(()=>{let active=true;eppCall('epp-head-view',{clubId:eppSession().account.clubId,action:'catalog'}).then(r=>{if(active)setClubs(r.clubs);}).catch(e=>{if(active)setStatus('Verenigingen laden mislukt: '+e.message);});return()=>{active=false;};},[]);
  const select=id=>{if(!id||clubs.some(c=>c.code===id)){setClub(id);setStatus('');}};
  // Keep the original workspace and its pending input alive while viewing another club.
  return h(React.Fragment,null,
    h('div',{hidden:!!club},h(App,{headClubs:clubs,onHeadClubChange:select})),
    club&&h(HeadClubViewer,{key:club,clubId:club,clubs,onChange:select,onExit:()=>select('')}),
    status&&h('div',{className:'toast',role:'status'},status));
};
