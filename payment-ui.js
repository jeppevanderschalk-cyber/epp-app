const paymentMoney=cents=>new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(cents/100);
const paymentLabel=status=>({creating:'Betaling wordt voorbereid',open:'Wacht op betaling',pending:'Betaling wordt verwerkt',paid:'Betaald en bevestigd',failed:'Betaling mislukt',expired:'Betaling verlopen',canceled:'Betaling afgebroken',review:'Betaling wordt door de beheerder gecontroleerd'}[status]||'Nog niet betaald');
const paymentError=e=>({betaling_loopt_al:'Er loopt al een betaling. Rond deze af of wacht tot de betaalstatus is bijgewerkt.',betaling_verplicht:'Betaal eerst om je inschrijving te bevestigen.',betaling_controle_nodig:'Je reservering wordt vastgehouden. De beheerder moet de betaalstatus controleren; betaal niet opnieuw.',betaalaccount_niet_gereed:'Het eigen betaalaccount van de vereniging is nog niet gereed.',betalingen_nog_niet_actief:'Online betalen is nog niet geactiveerd.',betaalinstelling_vast:'De betaalinstelling kan niet meer veranderen nadat een betaling is gestart.',bestaande_inschrijvingen_eerst_controleren:'Er zijn al inschrijvingen. Controleer deze eerst voordat je verplichte betaling activeert.',betaalde_inschrijving_wijzigen_via_planner:'Je hebt al een inschrijving. Wijzig het tijdslot via de planner.',betaaldienst_onbereikbaar:'De betaaldienst is tijdelijk niet bereikbaar. Je reservering blijft staan. Controleer de status voordat je opnieuw probeert.',betaalaccount_opnieuw_koppelen:'De vereniging moet haar Mollie-account opnieuw koppelen.'}[e.message]||plannerError(e));
const paymentNavigate=url=>{
  const target=new URL(url);
  if(target.protocol!=='https:'||!['www.mollie.com','mollie.com','my.mollie.com','checkout.mollie.com'].includes(target.hostname)||target.username||target.password)throw Error('ongeldige_betaallink');
  location.assign(target.href);
};

const PaymentReview=({order,matchId,onSaved})=>{
  const [providerId,setProviderId]=React.useState(order.providerId||''),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState('');
  return h('div',{style:{display:'grid',gap:8,marginTop:8}},
    h('label',null,'Mollie-betalingsnummer',h('input',{className:'txt-in',value:providerId,placeholder:'tr_...',disabled:busy,onChange:e=>setProviderId(e.target.value)})),
    h('button',{className:'btn btn-ghost',disabled:busy||!/^tr_[A-Za-z0-9]+$/.test(providerId),onClick:async()=>{if(busy)return;setBusy(true);setStatus('');try{const r=await eppCall('epp-payments',{clubId:CLUB_ID,matchId,action:'retry_review',orderId:order.id,providerId});await onSaved();setStatus(r.order.status==='paid'?'Betaling gecontroleerd en inschrijving bevestigd.':'De betaling vraagt nog controle.');}catch(e){setStatus(paymentError(e));}finally{setBusy(false);}}},'Betaling verifiëren en opnieuw verwerken'),
    status&&h('p',{className:'hint',role:'status'},status));
};

const PaymentSettings=({view,onSaved})=>{
  const [settings,setSettings]=React.useState(null),[profiles,setProfiles]=React.useState([]),[selected,setSelected]=React.useState(''),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState('');
  const request=extra=>eppCall('epp-payments',{clubId:CLUB_ID,matchId:view.match.id,...extra});
  const load=async()=>{try{const r=await request({action:'settings'});setSettings(r);setSelected(r.account?.profile_id||'');}catch(e){setStatus(paymentError(e));}};
  React.useEffect(()=>{load();},[view.match.id]);
  const action=async work=>{if(busy)return;setBusy(true);setStatus('');try{await work();}catch(e){setStatus(paymentError(e));}finally{setBusy(false);}};
  return h('details',{className:'card',style:{padding:14}},
    h('summary',{style:{fontWeight:700}},'Inschrijfgeld en eigen betaalaccount'),
    h('p',null,'Standaard: €12 · Optics: €12 · Beide: €24.'),
    h('p',{className:'hint'},'Iedere schutter kiest zelf een tijdslot per discipline. De betaling gaat naar het eigen Mollie-account van de organiserende vereniging.'),
    settings&&h(React.Fragment,null,
      settings.testMode&&h('p',{className:'hint',role:'status'},'Testmodus: er worden geen echte betalingen geïnd.'),
      !settings.configured&&h('p',{className:'hint',role:'status'},'Voorbereid: Mollie Connect is nog niet aangesloten. Online betalen is uitgeschakeld; bestaande inschrijvingen blijven werken.'),
      settings.configured&&!settings.enabled&&h('p',{className:'hint'},'De centrale betaalfunctie is nog niet geactiveerd. Je kunt het verenigingsaccount alvast koppelen.'),
      h('p',{className:'hint'},settings.account?'Gekoppeld: '+settings.account.organization_name+(settings.account.can_receive?' · Kan betalingen ontvangen':' · Rond de verificatie bij Mollie af'):'Nog geen eigen betaalaccount gekoppeld.'),
      h('button',{className:'btn btn-ghost',disabled:busy||!settings.configured,onClick:()=>action(async()=>{const r=await request({action:'connect'});paymentNavigate(r.url);})},settings.account?'Mollie opnieuw koppelen':'Eigen Mollie-account koppelen'),
      settings.account&&h('div',{style:{display:'grid',gap:10,marginTop:12}},
        h('button',{className:'btn btn-ghost',disabled:busy,onClick:()=>action(async()=>{const r=await request({action:'profiles'});setProfiles(r.profiles);})},'Betaalprofielen ophalen'),
        profiles.length>0&&h(React.Fragment,null,h('label',null,'Betaalprofiel',h('select',{'aria-label':'Betaalprofiel',className:'txt-in',value:selected,onChange:e=>setSelected(e.target.value)},h('option',{value:''},'Kies een profiel'),profiles.map(p=>h('option',{key:p.id,value:p.id},p.name+' · '+p.website)))),h('button',{className:'btn btn-ghost',disabled:busy||!selected,onClick:()=>action(async()=>{await request({action:'select_profile',profileId:selected});await load();setStatus('Betaalprofiel opgeslagen.');})},'Betaalprofiel opslaan'))),
      h('p',{className:'hint'},settings.required?'Betaling is verplicht voor deze wedstrijd.':'Online betaling is niet verplicht voor deze wedstrijd.'),
      h('button',{className:'btn btn-gold',disabled:busy||!settings.enabled||!settings.account?.can_receive||!settings.account?.profile_id,onClick:()=>action(async()=>{await request({action:'configure',required:!settings.required});await load();await onSaved();setStatus('Betaalinstelling opgeslagen.');})},settings.required?'Verplichte betaling uitschakelen':'Betaling verplicht maken')),
    (view.paymentOrders||[]).length>0&&h('section',{style:{display:'grid',gap:8,marginTop:16}},h('h3',null,'Betalingen bij deze wedstrijd'),
      view.paymentOrders.map(order=>h('div',{key:order.id,style:{borderTop:'1px solid '+C.border,padding:'10px 0'}},h('strong',null,order.name),h('div',null,paymentMoney(order.amountCents)+' · '+(order.registrationCanceled?'Inschrijving afgemeld — betaald':paymentLabel(order.status))),order.refundedCents>0&&h('div',null,'Terugbetaald: '+paymentMoney(order.refundedCents)),order.status==='review'&&h(PaymentReview,{order,matchId:view.match.id,onSaved}))),
      h('p',{className:'hint'},'Annuleren geeft niet automatisch geld terug. Beoordeel terugbetalingen volgens de voorwaarden van je vereniging en voer ze uit in het eigen Mollie-account.'),h('a',{className:'btn btn-ghost',href:'https://my.mollie.com/dashboard',target:'_blank',rel:'noopener noreferrer'},'Eigen Mollie-dashboard openen')),
    status&&h('p',{className:'hint',role:'status'},status));
};

const PaymentStatus=({order,matchId,onUpdated})=>{
  const [busy,setBusy]=React.useState(false),[status,setStatus]=React.useState('');
  const refresh=async()=>{if(busy)return;setBusy(true);setStatus('');try{await eppCall('epp-payments',{clubId:CLUB_ID,matchId,action:'status',orderId:order.id});await onUpdated();}catch(e){setStatus(paymentError(e));}finally{setBusy(false);}};
  return h('section',{style:{display:'grid',gap:10},'aria-label':'Betaalstatus'},
    order.testMode&&h('p',{className:'hint',role:'status'},'Testbetaling — geen echt geld'),
    h('strong',{role:'status'},(order.registrationCanceled?'Inschrijving afgemeld — betaald':paymentLabel(order.status))+' · '+paymentMoney(order.amountCents)),
    ['creating','open','pending','review'].includes(order.status)&&h('p',{className:'hint'},'Je gekozen tijdsloten worden vastgehouden. Je inschrijving is pas definitief na bevestiging van de betaling.'),
    order.status==='paid'&&!order.registrationCanceled&&h('p',{className:'hint'},'Je betaling is ontvangen en je tijdsloten zijn bevestigd.'),
    order.refundedCents>0&&h('p',{className:'hint'},'Terugbetaald: '+paymentMoney(order.refundedCents)),
    order.status==='open'&&order.checkoutUrl&&h('button',{className:'btn btn-gold',onClick:()=>paymentNavigate(order.checkoutUrl)},'Verder met betalen'),
    order.status==='creating'&&h('button',{className:'btn btn-gold',disabled:busy,onClick:async()=>{if(busy)return;setBusy(true);setStatus('');try{const r=await eppCall('epp-payments',{clubId:CLUB_ID,action:'checkout',matchId,choices:order.choices,expectedRevision:order.expectedRevision});if(r.order?.checkoutUrl&&r.order.status==='open')paymentNavigate(r.order.checkoutUrl);else await onUpdated();}catch(e){setStatus(paymentError(e));}finally{setBusy(false);}}},'Betaling opnieuw openen'),
    !['expired','failed','canceled'].includes(order.status)&&h('button',{className:'btn btn-ghost',disabled:busy,onClick:refresh},busy?'Controleren...':'Betaalstatus controleren'),
    status&&h('p',{className:'hint',role:'status'},status));
};

const PaymentReturn=()=>{
  const params=new URLSearchParams(location.search),orderId=params.get('payment'),matchId=params.get('match');
  const valid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value||'');
  const [order,setOrder]=React.useState(null),[status,setStatus]=React.useState(''),[closed,setClosed]=React.useState(false),[showPlanner,setShowPlanner]=React.useState(false);
  const load=async()=>{try{const r=await eppCall('epp-payments',{clubId:CLUB_ID,action:'status',matchId,orderId});setOrder(r.order);setStatus('');}catch(e){setStatus(paymentError(e));}};
  React.useEffect(()=>{if(!valid(orderId)||!valid(matchId)||order&&['paid','review','failed','expired','canceled'].includes(order.status))return;load();const timer=setInterval(load,10000);return()=>clearInterval(timer);},[orderId,matchId,order?.status]);
  if(closed||!valid(orderId)||!valid(matchId))return null;
  return h('section',{className:'card',style:{padding:16,marginBottom:16}},h('h2',null,'Je wedstrijdinschrijving'),order?h(PaymentStatus,{order,matchId,onUpdated:load}):h('p',{role:'status'},status||'Betaalstatus controleren...'),h('button',{className:'btn btn-ghost',onClick:()=>setShowPlanner(v=>!v)},showPlanner?'Inschrijving inklappen':'Gekozen tijdsloten bekijken'),showPlanner&&h(MatchPlanner,{matchId}),h('button',{className:'btn btn-ghost',onClick:()=>{setClosed(true);const url=new URL(location.href);url.searchParams.delete('payment');url.searchParams.delete('match');history.replaceState(null,'',url.href);}},'Melding sluiten'));
};
