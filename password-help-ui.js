const usePasswordHelpRequests=()=>{
  const [requests,setRequests]=React.useState([]),[loading,setLoading]=React.useState(true),[error,setError]=React.useState('');
  const revision=React.useRef(0);
  const load=async()=>{
    const account=eppSession()?.account;if(!account?.isAdmin){setLoading(false);return;}
    const version=++revision.current;setError('');
    try{const r=await eppCall('epp-auth',{clubId:account.clubId,action:'list_password_help'});if(version===revision.current)setRequests(r.requests||[]);}
    catch{if(version===revision.current)setError('Herstelverzoeken laden is niet gelukt. Probeer opnieuw.');}
    finally{if(version===revision.current)setLoading(false);}
  };
  React.useEffect(()=>{
    if(!eppSession()?.account?.isAdmin)return;
    load();const timer=eppPoll(load,30000);
    window.addEventListener('focus',load);window.addEventListener('epp-password-help-handled',load);
    return()=>{revision.current++;clearInterval(timer);window.removeEventListener('focus',load);window.removeEventListener('epp-password-help-handled',load);};
  },[]);
  return {requests,loading,error,load};
};
const PasswordHelpNotice=({onReview})=>{
  const {requests,error}=usePasswordHelpRequests();
  if(!requests.length||error)return null;
  return h('section',{role:'status','aria-label':'Wachtwoordherstel gevraagd',style:{borderLeft:'4px solid '+C.gold,padding:'12px 16px',marginBottom:16}},
    h('strong',null,requests.length===1?'Een gebruiker vraagt om een nieuw wachtwoord.':requests.length+' gebruikers vragen om een nieuw wachtwoord.'),
    h('button',{className:'btn btn-gold',style:{display:'block',marginTop:12},onClick:onReview},'Wachtwoordverzoeken bekijken'));
};
const temporaryAccountPassword=()=>{
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>alphabet[b&63]).join('');
};
const PasswordHelpRequests=()=>{
  const {requests,loading,error,load}=usePasswordHelpRequests();
  const [selected,setSelected]=React.useState(null),[password,setPassword]=React.useState(''),[busy,setBusy]=React.useState(false),[status,setStatus]=React.useState(''),[delivery,setDelivery]=React.useState(null);
  const submit=async event=>{
    event.preventDefault();if(busy||!selected)return;setBusy(true);setStatus('');
    try{
      await eppCall('epp-auth',{clubId:eppSession().account.clubId,action:'resolve_password_help',requestId:selected.id,newPassword:password});
      setDelivery({name:selected.display_name,password});setSelected(null);setPassword('');
      window.dispatchEvent(new Event('epp-password-help-handled'));await load();
    }catch(e){
      setStatus(e.message==='herstelverzoek_afgehandeld'?'Dit verzoek is al afgehandeld. Ververs de lijst.':e.message==='nieuw_wachtwoord_ongeldig'?'Gebruik minimaal 10 tekens.':'Het tijdelijke wachtwoord is niet ingesteld. Controleer je verbinding en rechten en probeer opnieuw.');
    }finally{setBusy(false);}
  };
  const choose=request=>{setSelected(request);setPassword(temporaryAccountPassword());setDelivery(null);setStatus('');};
  return h('section',{'aria-label':'Wachtwoordherstelverzoeken',style:{display:'grid',gap:12}},
    h('p',{className:'hint'},eppSession()?.account?.isPlatformAdmin?'Herstelverzoeken van alle verenigingen, inclusief verenigingsbeheerders.':'Herstelverzoeken van de leden van je vereniging. Controleer wie je helpt en geef het tijdelijke wachtwoord persoonlijk door.'),
    h('button',{className:'btn btn-ghost',disabled:loading||busy,onClick:load},'Herstelverzoeken verversen'),
    loading&&h('p',{role:'status'},'Herstelverzoeken laden...'),
    error&&h('p',{role:'alert'},error),status&&h('p',{role:'alert'},status),
    delivery&&h('div',{role:'group','aria-label':'Tijdelijk wachtwoord doorgeven',style:{display:'grid',gap:10,border:'1px solid '+C.gold,borderRadius:12,padding:12}},
      h('strong',null,'Tijdelijk wachtwoord ingesteld voor '+delivery.name),
      h('p',{className:'hint'},'Geef dit wachtwoord persoonlijk door. Bij de volgende login moet de gebruiker een eigen wachtwoord kiezen. Het herstelverzoek is afgehandeld.'),
      h('label',null,'Ingesteld tijdelijk wachtwoord',h('input',{className:'txt-in',type:'text',readOnly:true,value:delivery.password,onFocus:e=>e.target.select(),autoComplete:'off',spellCheck:false})),
      h('button',{className:'btn btn-ghost',onClick:()=>setDelivery(null)},'Gereed')),
    !loading&&!error&&!requests.length&&h('p',{role:'status'},'Er zijn geen openstaande wachtwoordverzoeken.'),
    !error&&requests.map(r=>h('div',{key:r.id,role:'group','aria-label':'Wachtwoordverzoek '+r.display_name,style:{borderBottom:'1px solid '+C.border,padding:'10px 0',overflowWrap:'anywhere'}},
      h('strong',null,r.display_name),
      h('p',{className:'hint'},r.club_name||r.club_code,' · ',r.login_username||r.email||'Persoonlijk account'),
      h('p',{className:'hint'},'Aangevraagd op '+new Date(r.requested_at).toLocaleString('nl-NL')),
      selected?.id===r.id?h('form',{onSubmit:submit,style:{display:'grid',gap:10}},
        h('p',{className:'hint'},'Controleer eerst wie je helpt. Het voorgestelde wachtwoord kun je direct gebruiken of aanpassen.'),
        h('label',null,'Tijdelijk wachtwoord',h('input',{className:'txt-in',type:'text',autoComplete:'off',spellCheck:false,required:true,minLength:10,maxLength:256,value:password,disabled:busy,onChange:e=>setPassword(e.target.value)})),
        h('button',{className:'btn btn-ghost',type:'button',disabled:busy,onClick:()=>setPassword(temporaryAccountPassword())},'Ander wachtwoord voorstellen'),
        h('button',{className:'btn btn-gold',type:'submit',disabled:busy},busy?'Instellen...':'Tijdelijk wachtwoord instellen'),
        h('button',{className:'btn btn-ghost',type:'button',disabled:busy,onClick:()=>{setSelected(null);setPassword('');}},'Annuleren'))
      :h('button',{className:'btn btn-gold',disabled:busy,onClick:()=>choose(r)},'Tijdelijk wachtwoord geven'))));
};
