const EppPhonePush=(()=>{
 let config=null;
 const supported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 const needsInstall=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
 const standalone=()=>navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches;
 const settings=async()=>{if(!config)config=await eppCall('epp-push',{clubId:eppSession().account.clubId,action:'settings'});return config;};
 const existing=async()=>{if(!supported())return null;const registration=await navigator.serviceWorker.getRegistration('/');return registration?registration.pushManager.getSubscription():null;};
 const save=subscription=>eppCall('epp-push',{clubId:eppSession().account.clubId,action:'subscribe',subscription:subscription.toJSON()});
 const enable=async()=>{
  if(!supported())throw Error('push_niet_ondersteund');
  if(needsInstall()&&!standalone())throw Error('zet_op_beginscherm');
  // Call directly from the user's tap, before awaiting any network operation (iOS).
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('push_geweigerd');
  const info=await settings();if(!info.ready)throw Error('push_niet_ingesteld');
  await navigator.serviceWorker.register('/epp-push-sw.js',{scope:'/',updateViaCache:'none'});
  const registration=await navigator.serviceWorker.ready;
  const raw=info.publicKey.replace(/-/g,'+').replace(/_/g,'/');
  const publicKey=Uint8Array.from(atob(raw+'='.repeat((4-raw.length%4)%4)),c=>c.charCodeAt(0));
  const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey});
  try{await save(subscription);}catch(e){await subscription.unsubscribe();throw e;}
  return subscription;
 };
 const disable=async()=>{
  const subscription=await existing();if(!subscription)return;
  try{await eppCall('epp-push',{clubId:eppSession().account.clubId,action:'unsubscribe',endpoint:subscription.endpoint});}
  finally{await subscription.unsubscribe();}
 };
 const sync=async()=>{
  const subscription=await existing();if(!subscription)return;
  const account=eppSession()?.account;
  if(!account?.isAdmin){await disable();return;}
  await save(subscription);
 };
 return {supported,needsInstall,standalone,settings,existing,enable,disable,sync};
})();
const phonePushError=code=>({
 zet_op_beginscherm:'Open EPP via het beginscherm van je iPhone of iPad. Voeg EPP eerst toe via Safari → Delen → Zet op beginscherm.',
 push_geweigerd:'Meldingen zijn niet toegestaan. Geef EPP toestemming bij de meldingsinstellingen van je telefoon en probeer opnieuw.',
 push_niet_ondersteund:'Deze browser ondersteunt geen telefoonmeldingen. Gebruik een actuele browser. Op iPhone: open EPP vanaf je beginscherm (iOS 16.4 of nieuwer).',
 push_niet_ingesteld:'Telefoonmeldingen zijn nog niet geactiveerd. Probeer het later opnieuw.',
 wacht_even_met_testen:'Wacht een minuut voordat je opnieuw een testmelding stuurt.',
 te_veel_pushapparaten:'Er zijn al tien apparaten gekoppeld aan dit account. Vraag technisch beheer om oude apparaten te verwijderen.'
}[code]||'Het is niet gelukt. Controleer je verbinding en probeer opnieuw.');
const PhonePushSettings=()=>{
 const [enabled,setEnabled]=React.useState(false),[loading,setLoading]=React.useState(true),[ready,setReady]=React.useState(false),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState('');
 const supported=EppPhonePush.supported(),install=EppPhonePush.needsInstall()&&!EppPhonePush.standalone();
 React.useEffect(()=>{let active=true;(async()=>{
  if(!supported){setLoading(false);return;}
  try{const info=await EppPhonePush.settings(),subscription=await EppPhonePush.existing();if(active){setReady(info.ready);setEnabled(!!subscription);}}
  catch{if(active)setStatus('Instellingen laden is niet gelukt. Heropen dit scherm om opnieuw te proberen.');}
  finally{if(active)setLoading(false);}
 })();return()=>{active=false;};},[]);
 const toggle=async()=>{
  if(busy)return;setBusy(true);setStatus('');
  try{if(enabled){await EppPhonePush.disable();setEnabled(false);setStatus('Telefoonmeldingen op dit apparaat zijn uitgezet.');}else{await EppPhonePush.enable();setEnabled(true);setStatus('Telefoonmeldingen staan aan op dit apparaat. Je kunt nu een testmelding sturen.');}}
  catch(e){setStatus(phonePushError(e.message));}
  finally{setBusy(false);}
 };
 const test=async()=>{
  if(busy)return;setBusy(true);setStatus('');
  try{const subscription=await EppPhonePush.existing();if(!subscription)throw Error('push_geweigerd');await eppCall('epp-push',{clubId:eppSession().account.clubId,action:'test',endpoint:subscription.endpoint});setStatus('Testmelding verstuurd. Controleer je telefoon. Ook Focus of Niet storen kan meldingen tegenhouden.');}
  catch(e){setStatus(phonePushError(e.message));}finally{setBusy(false);}
 };
 return h('section',{'aria-label':'Telefoonmeldingen',style:{display:'grid',gap:12}},
  h('p',{className:'hint'},'Ontvang op deze telefoon een melding als iemand wachtwoordherstel aanvraagt. Tik op de melding om het verzoek in EPP te bekijken.'),
  !supported&&h('p',{role:'status',className:'hint'},phonePushError('push_niet_ondersteund')),
  install&&h('p',{className:'hint'},phonePushError('zet_op_beginscherm')),
  loading&&h('p',{role:'status'},'Meldingsinstellingen laden...'),
  !loading&&supported&&!ready&&h('p',{className:'hint'},'Telefoonmeldingen zijn nog niet beschikbaar. De meldingen in de app blijven werken.'),
  h('button',{className:'btn btn-gold',disabled:busy||loading||!supported||(!ready&&!enabled)||install,onClick:toggle},enabled?'Telefoonmeldingen uitzetten':'Telefoonmeldingen aanzetten'),
  enabled&&h('button',{className:'btn btn-ghost',disabled:busy,onClick:test},'Testmelding sturen'),
  enabled&&h('p',{className:'hint'},'Meldingen staan aan op dit apparaat. Het tijdelijke wachtwoord wordt nooit in een telefoonmelding getoond.'),
  status&&h('p',{role:'status'},status));
};
const PhonePushBinding=({onReview})=>{
 React.useEffect(()=>{
  EppPhonePush.sync().catch(()=>{});
  const open=()=>onReview();
  const message=event=>{if(event.data?.type==='epp-open-password-help')open();};
  navigator.serviceWorker?.addEventListener('message',message);
  const url=new URL(location.href);
  if(url.searchParams.get('melding')==='wachtwoordherstel'){
   url.searchParams.delete('melding');history.replaceState(null,'',url.pathname+url.search+url.hash);open();
  }
  return()=>navigator.serviceWorker?.removeEventListener('message',message);
 },[]);
 return null;
};
