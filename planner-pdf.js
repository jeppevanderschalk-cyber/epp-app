(function(root){
  'use strict';
  const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  const day=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam'}).format(new Date(value));
  const clock=value=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
  const label=value=>({pistool:'Standaard',optiek:'Optics',pcc:'PCC'}[value]||clean(value));
  const collator=new Intl.Collator('nl',{sensitivity:'base',numeric:true});
  function schedule(view){
    if(view?.managing!==true)throw Error('Alleen de organiserende vereniging kan de volledige planning downloaden.');
    if(!view.match||!Array.isArray(view.slots)||!Array.isArray(view.roster))throw Error('De volledige planning is niet beschikbaar. Laad de planner opnieuw.');
    const seen=new Set(),unassigned=[],identities=new Set();let starts=0;
    const slots=view.slots.map(slot=>{
      if(!Number.isFinite(Date.parse(slot.starts_at))||!Number.isFinite(Date.parse(slot.ends_at)))throw Error('De planning bevat een ongeldig tijdblok.');
      return {...slot,day:day(slot.starts_at),time:clock(slot.starts_at)+' - '+clock(slot.ends_at),entries:[]};
    }).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at)||String(a.id).localeCompare(String(b.id)));
    const byId=new Map(slots.map(s=>[s.id,s]));
    view.roster.forEach((person,index)=>{
      const identity=person.shooterId||person.publicId||'row:'+index;
      for(const choice of person.choices||[]){
        const key=JSON.stringify([identity,choice.discipline,choice.slotId||'']);if(seen.has(key))continue;seen.add(key);
        const entry={identity,name:clean(person.name)||'Naam ontbreekt',club:(person.clubs||[]).map(clean).filter(Boolean).join(', '),publicId:clean(person.publicId),discipline:label(choice.discipline),status:'Ingeschreven'};
        const slot=byId.get(choice.slotId);
        if(slot){slot.entries.push(entry);identities.add(identity);starts++;}
        else{const preference=(person.preferences||[]).find(p=>p.discipline===choice.discipline);unassigned.push({...entry,status:choice.slotId?'Tijdslot niet beschikbaar':'Nog in te plannen',preference:clean(preference?.specific_time||preference?.time_block)});}
      }
    });
    let pendingCount=0;
    for(const order of view.paymentOrders||[]){
      if(order.registrationCanceled||!['creating','open','pending','review'].includes(order.status))continue;
      for(const choice of order.choices||[]){
        const slot=byId.get(choice.slotId);if(!slot)continue;
        const identity=order.shooterId||order.name||order.id,key=JSON.stringify([identity,choice.discipline,choice.slotId]);if(seen.has(key))continue;seen.add(key);
        slot.entries.push({identity,name:clean(order.name)||'Naam ontbreekt',club:'',publicId:'',discipline:label(choice.discipline),status:'Betaling loopt'});pendingCount++;
      }
    }
    for(const slot of slots)slot.entries.sort((a,b)=>Number(a.status!=='Ingeschreven')-Number(b.status!=='Ingeschreven')||collator.compare(a.name,b.name)||collator.compare(a.discipline,b.discipline));
    unassigned.sort((a,b)=>collator.compare(a.name,b.name)||collator.compare(a.discipline,b.discipline));
    const dates=[...new Set([...(view.match.match_dates||[view.match.match_date]).filter(Boolean),...slots.map(s=>s.day)])].sort();
    return {match:view.match,days:dates.map(date=>({date,slots:slots.filter(s=>s.day===date)})),unassigned,starts,shooters:identities.size,pendingCount,slotCount:slots.length};
  }
  let libraries,fonts;
  function script(src,global){
    if(root[global])return Promise.resolve(root[global]);
    return new Promise((resolve,reject)=>{
      const node=document.createElement('script');node.src=src;
      const timeout=setTimeout(()=>{node.remove();reject(Error('PDF-bibliotheek laden duurt te lang. Probeer opnieuw.'));},30000);
      node.onload=()=>{clearTimeout(timeout);root[global]?resolve(root[global]):reject(Error('PDF-bibliotheek niet beschikbaar.'));};
      node.onerror=()=>{clearTimeout(timeout);node.remove();reject(Error('PDF-bibliotheek laden mislukt. Controleer je verbinding.'));};
      document.head.append(node);
    });
  }
  async function dependencies(){
    if(!libraries)libraries=Promise.all([script('vendor/pdf/pdf-lib-1.17.1.min.js','PDFLib'),script('vendor/pdf/fontkit-1.1.1.min.js','fontkit')]).catch(error=>{libraries=null;throw error;});
    if(!fonts)fonts=Promise.all(['Regular','Bold'].map(async weight=>{const response=await fetch('vendor/pdf/NotoSans-'+weight+'.ttf');if(!response.ok)throw Error('PDF-lettertype laden mislukt.');return new Uint8Array(await response.arrayBuffer());})).catch(error=>{fonts=null;throw error;});
    const [[pdf,fontkit],fontBytes]=await Promise.all([libraries,fonts]);return {pdf,fontkit,fontBytes};
  }
  async function create(view,{now=new Date(),resources}={}){
    const model=schedule(view); // Check authorization before loading libraries or creating a document.
    const {pdf,fontkit,fontBytes}=resources||await dependencies();
    const doc=await pdf.PDFDocument.create();doc.registerFontkit(fontkit);
    const [regular,bold]=await Promise.all(fontBytes.map(bytes=>doc.embedFont(bytes,{subset:true})));
    doc.setTitle('Wedstrijdplanning - '+clean(model.match.organizer));doc.setAuthor('EPP');doc.setCreator('EPP Trainingsmonitor');doc.setCreationDate(now);doc.setModificationDate(now);
    const ink=pdf.rgb(.07,.11,.19),muted=pdf.rgb(.32,.36,.42),line=pdf.rgb(.79,.81,.84),light=pdf.rgb(.94,.95,.96),gold=pdf.rgb(.67,.48,.08);
    const W=595.28,H=841.89,M=36,content=W-M*2,bottom=48,columns=[195,83,151,94.28];let page,y,tableTop,dateLabel='';
    const stamp=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
    const wrap=(value,width,font=regular,size=9)=>{
      const text=clean(value);if(!text)return [''];
      const result=[];let current='';
      for(const word of text.split(' ')){
        const candidate=current?current+' '+word:word;
        if(font.widthOfTextAtSize(candidate,size)<=width){current=candidate;continue;}
        if(current){result.push(current);current='';}
        let part='';for(const char of word){if(part&&font.widthOfTextAtSize(part+char,size)>width){result.push(part);part='';}part+=char;}current=part;
      }
      if(current)result.push(current);return result;
    };
    const text=(value,x,top,{font=regular,size=9,color=ink}={})=>page.drawText(String(value),{x,y:top-size,font,size,color});
    const lines=(value,x,width,size=9,font=regular,color=ink)=>{const items=wrap(value,width,font,size);for(const item of items){text(item,x,y,{size,font,color});y-=size*1.4;}return items.length;};
    function header(){
      page=doc.addPage([W,H]);y=H-M;
      text('EPP  /  WEDSTRIJDPLANNING',M,y,{font:bold,size:10,color:gold});y-=23;
      lines(model.match.organizer||'Wedstrijd',M,content,17,bold);y-=3;
      if(model.match.location){lines(model.match.location,M,content,9,regular,muted);y-=3;}
      lines(dateLabel,M,content,11,bold);y-=5;
      lines('Totaal wedstrijd: '+model.slotCount+' tijdblokken | '+model.starts+' bevestigde starts | '+model.shooters+' schutters'+(model.pendingCount?' | '+model.pendingCount+(model.pendingCount===1?' betaling loopt':' betalingen lopen'):''),M,content,8,regular,muted);y-=10;
      page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:1,color:line});y-=7;
      let x=M;for(const [i,label] of ['Schutter','Discipline','Vereniging','ID / status'].entries()){text(label,x+5,y,{font:bold,size:8,color:muted});x+=columns[i];}y-=18;tableTop=y;
    }
    function ensure(height){if(y-height<bottom)header();}
    function slotBar(slot,continuation=false){
      page.drawRectangle({x:M,y:y-23,width:content,height:23,color:light});
      const count=slot.entries.filter(p=>p.status==='Ingeschreven').length;
      text(slot.time+(continuation?' (vervolg)':''),M+6,y-5,{font:bold,size:10});
      const detail=(slot.blocked?'GEBLOKKEERD | ':'')+count+' ingeschreven / '+slot.capacity+(Number(slot.capacity)===1?' plaats':' plaatsen');
      text(detail,W-M-regular.widthOfTextAtSize(detail,8)-6,y-7,{size:8,color:slot.blocked?gold:muted});y-=29;
    }
    const cells=entry=>[entry.name,entry.discipline,entry.club||'-',[entry.publicId,entry.status==='Ingeschreven'?'':entry.status,entry.preference].filter(Boolean).join(' / ')||'-'];
    function rowHeight(entry){return Math.max(21,...cells(entry).map((value,i)=>wrap(value,columns[i]-10,i===0?bold:regular).length*12+9));}
    function row(entry,slot){
      const values=cells(entry),wrapped=values.map((value,i)=>wrap(value,columns[i]-10,i===0?bold:regular));
      const total=Math.max(...wrapped.map(items=>items.length)),height=total*12+9;
      const nextPage=()=>{header();if(slot)slotBar(slot,true);};
      if(height<=tableTop-bottom-(slot?29:0)&&y-height<bottom)nextPage();
      let offset=0;
      while(offset<total){
        if(y-bottom<21)nextPage();
        const count=Math.min(total-offset,Math.max(1,Math.floor((y-bottom-9)/12)));let x=M;
        for(let i=0;i<wrapped.length;i++){
          wrapped[i].slice(offset,offset+count).forEach((value,j)=>text(value,x+5,y-3-j*12,{font:i===0?bold:regular,size:9,color:i===3?muted:ink}));x+=columns[i];
        }
        y-=count*12+9;page.drawLine({start:{x:M,y:y+3},end:{x:W-M,y:y+3},thickness:.4,color:line});
        offset+=count;if(offset<total)nextPage();
      }
    }
    for(const group of model.days){
      dateLabel=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(group.date+'T12:00:00Z'));header();
      if(!group.slots.length){text('Nog geen tijdblokken ingepland.',M,y,{color:muted});y-=24;}
      for(const slot of group.slots){
        const blockHeight=29+(slot.entries.length?slot.entries.reduce((sum,entry)=>sum+rowHeight(entry),0):23)+8;
        ensure(blockHeight<=tableTop-bottom?blockHeight:29+(slot.entries.length?Math.min(rowHeight(slot.entries[0]),240):21));slotBar(slot);
        if(!slot.entries.length){text('Geen inschrijvingen',M+5,y-3,{color:muted});y-=23;}
        for(const entry of slot.entries)row(entry,slot);y-=8;
      }
    }
    if(model.unassigned.length){dateLabel='Deelnemers zonder beschikbaar tijdslot';header();for(const entry of model.unassigned)row(entry);}
    if(!doc.getPageCount()){dateLabel='Planning';header();text('Nog geen tijdblokken ingepland.',M,y,{color:muted});}
    const pages=doc.getPages();for(const [i,p] of pages.entries()){
      p.drawLine({start:{x:M,y:34},end:{x:W-M,y:34},thickness:.5,color:line});
      p.drawText('EPP - gegenereerd '+stamp+' | Actuele momentopname',{x:M,y:20,size:7,font:regular,color:muted});
      const number='Pagina '+(i+1)+' / '+pages.length;p.drawText(number,{x:W-M-regular.widthOfTextAtSize(number,7),y:20,size:7,font:regular,color:muted});
    }
    const slug=clean(model.match.organizer).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'wedstrijd';
    return {bytes:await doc.save(),filename:'EPP-planning-'+slug+'-'+(model.days[0]?.date||day(now))+'.pdf',slotCount:model.slotCount};
  }
  root.EppPlannerPdf={schedule,create,dependencies};
})(globalThis);
