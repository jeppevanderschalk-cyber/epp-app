(function(){
  'use strict';
  var prefix='#wachtwoord-herstellen=',token=null;
  if(location.hash.indexOf(prefix)===0){
    token=location.hash.slice(prefix.length);
    history.replaceState(null,'',location.pathname+location.search);
  }
  function mount(){
    var dialog=document.createElement('dialog');
    dialog.id='passwordRecoveryDialog';dialog.setAttribute('aria-labelledby','passwordRecoveryTitle');
    dialog.style.cssText='border:0;padding:0;background:transparent;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);color:#f9efd6';
    dialog.innerHTML='<form class="login-card" id="passwordRecoveryForm" style="margin:0;text-align:left;width:min(420px,calc(100vw - 24px))">'+
      '<h3 id="passwordRecoveryTitle" style="font-size:24px">Wachtwoord vergeten</h3>'+
      '<p id="passwordRecoveryIntro">Kies je vereniging en vul het e-mailadres van je account in. Je ontvangt een eenmalige resetlink die 30 minuten geldig is.</p>'+
      '<label id="recoveryClubLabel"><span>Vereniging</span><select id="recoveryClub" required></select></label>'+
      '<label id="recoveryEmailLabel"><span>E-mailadres van je account</span><input id="recoveryEmail" type="email" autocomplete="email" maxlength="254" required></label>'+
      '<label id="recoveryPasswordLabel" hidden><span>Nieuw wachtwoord (minimaal 10 tekens)</span><input id="recoveryPassword" type="password" autocomplete="new-password" minlength="10" maxlength="256"></label>'+
      '<label id="recoveryRepeatLabel" hidden><span>Herhaal nieuw wachtwoord</span><input id="recoveryRepeat" type="password" autocomplete="new-password" minlength="10" maxlength="256"></label>'+
      '<p id="recoveryStatus" role="status" aria-live="polite"></p>'+
      '<button class="login-submit" id="recoverySubmit" type="submit">Resetlink aanvragen</button>'+
      '<button class="login-personal-toggle" id="recoveryClose" type="button">Terug naar inloggen</button>'+
      '<p id="recoveryHelp">Geen toegang tot je e-mail of geen e-mailadres bij je account? Vraag je verenigingsbeheerder om een tijdelijk wachtwoord.</p></form>';
    var $=function(id){return dialog.querySelector('#'+id)||document.getElementById(id);},busy=false,completed=false;
    var clubs=$('recoveryClub');
    Array.from($('loginClub').options).filter(function(o){return !['gast','eppnationaal'].includes(o.value);}).forEach(function(o){clubs.add(o.cloneNode(true));});
    dialog.addEventListener('close',function(){if(!dialog.open)dialog.remove();});
    function open(resetToken){
      if(!dialog.isConnected)document.body.appendChild(dialog);
      token=resetToken||null;completed=false;$('passwordRecoveryForm').reset();$('recoveryStatus').textContent='';
      $('passwordRecoveryTitle').textContent=token?'Nieuw wachtwoord instellen':'Wachtwoord vergeten';
      $('passwordRecoveryIntro').textContent=token?'Kies een nieuw wachtwoord van minimaal 10 tekens.':'Kies je vereniging en vul het e-mailadres van je account in. Je ontvangt een eenmalige resetlink die 30 minuten geldig is.';
      ['Club','Email','Password','Repeat'].forEach(function(part){var active=token?['Password','Repeat'].includes(part):['Club','Email'].includes(part);$('recovery'+part+'Label').hidden=!active;$('recovery'+part).disabled=!active;$('recovery'+part).required=active;});
      $('recoverySubmit').hidden=false;$('recoverySubmit').textContent=token?'Nieuw wachtwoord opslaan':'Resetlink aanvragen';
      $('recoveryHelp').hidden=!!token;
      var current=$('loginClub').value;if(Array.from(clubs.options).some(function(o){return o.value===current;}))clubs.value=current;
      if(!token&&$('loginEmail').value.includes('@'))$('recoveryEmail').value=$('loginEmail').value;
      if(!dialog.open)dialog.showModal();
      (token?$('recoveryPassword'):$('recoveryEmail')).focus();
    }
    window.eppOpenPasswordRecovery=function(){open(null);};
    $('recoveryClose').onclick=function(){if(!busy){token=null;dialog.close();$('passwordRecoveryForm').reset();}};
    dialog.addEventListener('cancel',function(event){if(busy)event.preventDefault();else token=null;});
    $('passwordRecoveryForm').addEventListener('submit',async function(event){
      event.preventDefault();if(busy||completed)return;
      var status=$('recoveryStatus');status.textContent='';
      if(token&&$('recoveryPassword').value!==$('recoveryRepeat').value){status.textContent='De wachtwoorden zijn niet gelijk.';return;}
      busy=true;$('recoverySubmit').disabled=true;$('recoveryClose').disabled=true;
      try{
        await eppRawCall('epp-auth',token?{action:'complete_password_reset',token:token,newPassword:$('recoveryPassword').value}:{action:'request_password_reset',email:$('recoveryEmail').value,clubId:clubs.value});
        if(token){
          sessionStorage.removeItem(EPP_SESSION_KEY);localStorage.removeItem(EPP_SESSION_KEY);token=null;
          status.textContent='Je wachtwoord is gewijzigd. Log opnieuw in met je nieuwe wachtwoord.';
          $('recoveryClose').onclick=function(){location.reload();};
        }else status.textContent='Als dit e-mailadres bij een account van deze vereniging hoort, ontvang je een resetlink. Controleer ook je spammap. Geen mail ontvangen? Wacht twee minuten en probeer opnieuw of vraag je beheerder om hulp.';
        completed=true;$('recoveryPassword').value='';$('recoveryRepeat').value='';$('recoverySubmit').hidden=true;
      }catch(error){
        status.textContent=error.message==='maildienst_niet_ingesteld'?'Resetmails zijn nog niet beschikbaar. Je verenigingsbeheerder kan een tijdelijk wachtwoord instellen.':error.message==='resetlink_ongeldig'?'Deze resetlink is verlopen of al gebruikt. Vraag via ‘Wachtwoord vergeten?’ een nieuwe link aan.':error.message==='nieuw_wachtwoord_ongeldig'?'Gebruik een wachtwoord van 10 tot 256 tekens.':'Het is niet gelukt. Probeer het later opnieuw of vraag je verenigingsbeheerder om hulp.';
      }finally{busy=false;$('recoverySubmit').disabled=false;$('recoveryClose').disabled=false;}
    });
    window.addEventListener('hashchange',function(){
      if(location.hash.indexOf(prefix)===0){var next=location.hash.slice(prefix.length);history.replaceState(null,'',location.pathname+location.search);open(next);}
    });
    if(token)open(token);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
