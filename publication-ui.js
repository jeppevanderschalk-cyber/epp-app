const PUBLICATION_CHOICE_TEXT='Ik geef toestemming om mijn naam, vereniging en resultaten (scores en tijden) in de EPP-app aan andere gebruikers te tonen.';
const PublicationChoice=({allowed,onChange,disabled=false})=>h('section',{style:{display:'grid',gap:10}},
  h('h3',{style:{fontSize:18,margin:0}},'Privacy en publicatie'),
  h('p',{className:'hint'},'Je vereniging en wedstrijdorganisatie gebruiken je gegevens voor accountbeheer, inschrijving en uitslagverwerking. De publicatiekeuze hieronder is vrijwillig.'),
  h('label',{className:'chk-row'},h('input',{type:'checkbox','aria-label':'Toestemming voor publicatie',checked:allowed,disabled,onChange:e=>onChange(e.target.checked)}),h('span',null,PUBLICATION_CHOICE_TEXT)),
  h('p',{className:'hint'},'Zonder toestemming kun je gewoon een account aanmaken en meedoen. Andere gebruikers zien in gedeelde klassementen “Anonieme schutter”. Jijzelf en bevoegde beheerders houden toegang tot de gegevens die voor deelname nodig zijn.'),
  h('details',null,h('summary',null,'Welke gegevens worden gedeeld?'),
    h('p',{className:'hint'},'Dit betreft de naam en vereniging bij je trainings- en wedstrijdresultaten uit je account. E-mailadres, inloggegevens en betaalgegevens worden met deze keuze niet gepubliceerd. Je kunt toestemming op elk moment wijzigen of intrekken via Meer → Privacy en publicatie.'),
    h('p',{className:'hint'},'Eerder door organisatoren gepubliceerde historische uitslagen zijn een aparte bron. Neem voor een correctie of verwijderverzoek daarin contact op met de organiserende vereniging.'),
    h('p',{className:'hint'},'Ben je jonger dan 16 jaar? Geef geen zelfstandige publicatietoestemming; overleg met je ouder of voogd en je vereniging.')));

const PublicationPreference=()=>{
  const [allowed,setAllowed]=React.useState(false),[loaded,setLoaded]=React.useState(false),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState('');
  React.useEffect(()=>{let active=true;eppCall('epp-auth',{clubId:CLUB_ID,action:'get_publication_consent'}).then(r=>{if(active){setAllowed(r.consent.allowed===true);setLoaded(true);}}).catch(()=>{if(active)setStatus('Je publicatiekeuze kon niet worden opgehaald. Open dit onderdeel opnieuw.');});return()=>{active=false;};},[]);
  return h('section',{style:{display:'grid',gap:12}},h(PublicationChoice,{allowed,onChange:value=>{setAllowed(value);setStatus('');},disabled:busy||!loaded}),
    h('button',{className:'btn btn-gold',disabled:busy||!loaded,onClick:async()=>{if(busy||!loaded)return;setBusy(true);setStatus('');try{const r=await eppCall('epp-auth',{clubId:CLUB_ID,action:'set_publication_consent',allowed});setAllowed(r.consent.allowed===true);setStatus(r.consent.allowed?'Publicatietoestemming opgeslagen.':'Toestemming ingetrokken. Je naam en vereniging worden bij nieuwe opvragingen van gedeelde klassementen afgeschermd.');}catch{setStatus('Opslaan is niet gelukt. Je eerdere keuze blijft gelden. Probeer opnieuw.');}finally{setBusy(false);}}},busy?'Opslaan...':'Publicatiekeuze opslaan'),
    status&&h('p',{className:'hint',role:'status'},status));
};
