(function(){
  'use strict';
  const modes=['standalone','fullscreen','minimal-ui'].map(mode=>window.matchMedia('(display-mode: '+mode+')'));
  const installed=()=>navigator.standalone===true||modes.some(mode=>mode.matches);
  let dismissed=false;
  try{dismissed=localStorage.getItem('epp-install-help-dismissed')==='1'||sessionStorage.getItem('epp-install-help-dismissed')==='1';}catch{}
  const panel=document.createElement('aside');
  panel.className='epp-install-help';panel.setAttribute('aria-label','EPP op je beginscherm');
  panel.innerHTML='<button type="button" class="epp-install-close" aria-label="Installatie-uitleg sluiten">×</button><strong>Zet EPP op je beginscherm</strong><details><summary>EPP op je beginscherm</summary><div class="epp-install-steps"><p><strong>iPhone / iPad</strong><br>Open deze website in Safari. Tik op Delen (het vierkant met de pijl omhoog), kies ‘Zet op beginscherm’ en tik op ‘Voeg toe’. Zet ‘Open als webapp’ aan als die keuze verschijnt.</p><p><strong>Android</strong><br>Open deze website in Chrome. Tik op het menu ⋮, kies ‘Installeren en snelkoppeling maken’ → ‘Installeren’ en bevestig. Afhankelijk van je Chrome-versie heet dit ‘Toevoegen aan startscherm’ of ‘App installeren’.</p><p>Open EPP daarna via de tegel op je beginscherm. Deze uitleg verschijnt dan niet meer.</p></div></details>';
  const update=()=>{panel.hidden=dismissed||installed()||!!document.getElementById('loginGate')?.hidden;};
  panel.querySelector('button').addEventListener('click',()=>{dismissed=true;try{sessionStorage.setItem('epp-install-help-dismissed','1');localStorage.setItem('epp-install-help-dismissed','1');}catch{}update();});
  for(const mode of modes)mode.addEventListener?.('change',update);
  window.addEventListener('pageshow',update);
  window.addEventListener('appinstalled',()=>{dismissed=true;update();});
  const mount=()=>{
    const gate=document.getElementById('loginGate'),form=document.getElementById('loginForm');
    if(gate&&!gate.hidden&&form){if(panel.parentNode!==form)form.append(panel);}
    else if(panel.parentNode!==document.body)document.body.insertBefore(panel,document.getElementById('root'));
    update();
  };
  const gate=document.getElementById('loginGate');
  if(gate)new MutationObserver(mount).observe(gate,{attributes:true,attributeFilter:['hidden']});
  mount();
})();
