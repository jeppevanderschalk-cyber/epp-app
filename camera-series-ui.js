(function(root){
  'use strict';
  root.createEppSeriesCamera=function({React,h,STAGES,StageCarousel,scoreAtTargetPoint,newId}){
    return function SeriesCamera({shooters,registeredShooters=[],shooterDirectoryStatus="",addShooter,cameraShots,setCameraShots,maxOf,flash,addRound,trainingId}){
      const [sid,setSid]=React.useState(shooters[0]?.id||''),[stage,setStage]=React.useState('s1');
      const [before,setBefore]=React.useState(null),[after,setAfter]=React.useState(null);
      const [result,setResult]=React.useState(null),[shots,setShots]=React.useState([]);
      const [busy,setBusy]=React.useState(false),[status,setStatus]=React.useState(''),[saved,setSaved]=React.useState(false);
      const [expected,setExpected]=React.useState(5),[selected,setSelected]=React.useState(null);
      const [showBefore,setShowBefore]=React.useState(false);
      const [photoView,setPhotoView]=React.useState(null);
      const startReady=!!before&&root.EppCameraSeries.validCorners(before.corners);
      const cameraStep=photoView||(result?'review':startReady?'after':'before');
      const native=root.EppCameraNative,nativeAvailable=!!native?.available();
      const [autoSave,setAutoSave]=React.useState(false);
      const nativeContext=React.useMemo(()=>newId(),[sid,stage,trainingId]);
      const contextRef=React.useRef(nativeContext);contextRef.current=nativeContext;
      const receiveNative=React.useRef(null);
      React.useEffect(()=>nativeAvailable?native.attach(nativeContext,(file,photo)=>receiveNative.current(file,photo)):undefined,[nativeContext,nativeAvailable]);

      const [caliber,setCaliber]=React.useState(''),[cardWidth,setCardWidth]=React.useState(''),[cardHeight,setCardHeight]=React.useState('');
      const confidenceLabel={high:'Zeker',medium:'Twijfel',low:'Onzeker'};
      const priority={low:0,medium:1,high:2};
      const orderedShots=shots.map((s,i)=>({...s,number:i+1})).sort((a,b)=>(priority[a.confidence]??0)-(priority[b.confidence]??0)||a.number-b.number);
      const uncertain=orderedShots.filter(s=>!s.reviewed&&s.confidence!=='high');
      function reviewNext(){const next=uncertain[(uncertain.findIndex(s=>s.id===selected)+1)%uncertain.length];if(next){setSelected(next.id);setShowBefore(false);requestAnimationFrame(()=>document.getElementById('series-shot-'+next.id)?.scrollIntoView({block:'center',behavior:'smooth'}));}}

      const locked=React.useRef(false),mounted=React.useRef(true);
      React.useEffect(()=>()=>{mounted.current=false;},[]);
      React.useEffect(()=>{if(!sid&&shooters[0])setSid(shooters[0].id);},[shooters,sid]);
      const active=cameraShots.filter(s=>s.sid===sid&&s.stage===stage&&s.trainingId===trainingId);
      const limit=Math.round(maxOf(stage)/5),remaining=Math.max(0,limit-active.length);
      React.useEffect(()=>{if(remaining>0)setExpected(n=>Math.min(n,remaining));},[remaining]);
      const pending=shots.reduce((n,s)=>n+s.score,0),activeScore=active.reduce((n,s)=>n+s.score,0);
      const captureAllowed=!!sid&&shooters.some(s=>s.id===sid)&&!busy&&remaining>0&&(!result||saved)&&(!after||saved)&&(!before||root.EppCameraSeries.validCorners(before.corners));
      const nativeMessage=!sid?'Kies een schutter.':busy?'Foto verwerken…':!remaining?'Stage volledig. Kies een andere stage.':result&&!saved?'Controleer de serie op de iPhone.':before&&!root.EppCameraSeries.validCorners(before.corners)?'Markeer de vier hoeken op de iPhone.':after&&!saved?'Vergelijk of corrigeer de foto’s op de iPhone.':!before?'Maak de startfoto.':'Klaar voor een seriefoto.';
      React.useEffect(()=>{
        if(nativeAvailable)native.state({contextId:nativeContext,captureAllowed,message:nativeMessage,stage,score:activeScore,pendingScore:result&&!saved?pending:0,uncertain:uncertain.length});
      },[nativeContext,nativeAvailable,captureAllowed,nativeMessage,stage,activeScore,pending,saved,uncertain.length]);

      const reset=()=>{setBefore(null);setAfter(null);setResult(null);setShots([]);setSaved(false);setPhotoView(null);setStatus('');setSelected(null);};
      const change=(fn,value)=>{
        if(busy)return;
        if((before||after||shots.length)&&!saved&&!confirm('De nog niet opgeslagen serie verwijderen?'))return;
        reset();setExpected(5);fn(value);
      };
      async function choose(which,file){
        if(!file||locked.current)return;
        if(result&&!saved&&!confirm('De beoordeling van deze serie vervangen?'))return;
        locked.current=true;setBusy(true);setStatus('Foto openen...');setPhotoView(null);
        try{
          const photo=await root.EppCameraSeries.readPhoto(file);
          if(!mounted.current)return;
          (which==='before'?setBefore:setAfter)(photo);
          setResult(null);setShots([]);setSaved(false);setPhotoView(null);setStatus('');setSelected(null);
        }catch(e){if(mounted.current)setStatus(e.message);}
        finally{locked.current=false;if(mounted.current)setBusy(false);}
      }
      function corner(which,event){
        setPhotoView(null);
        if(busy||saved||result)return;
        const box=event.currentTarget.getBoundingClientRect(),p={x:Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)),y:Math.max(0,Math.min(1,(event.clientY-box.top)/box.height))};
        (which==='before'?setBefore:setAfter)(old=>old&&old.corners.length<4?{...old,corners:[...old.corners,p]}:old);
      }
      async function comparePhotos(first,last,fromNative=false){
        const context=nativeContext;
        const next=await root.EppCameraSeries.compare(first,last,{caliber,cardWidth,cardHeight});
        if(!mounted.current||contextRef.current!==context||root.document?.getElementById('root')?.hidden)return {ok:false,message:'De serie is gewijzigd. Foto niet overgenomen.'};
        const evaluated=next.candidates.map(p=>{
          const score=scoreAtTargetPoint(p),reasons=[...p.reasons];
          const radiusX=Number(caliber)/(2*Number(cardWidth)),radiusY=Number(caliber)/(2*Number(cardHeight));
          const border=Number.isFinite(radiusX)&&Number.isFinite(radiusY)&&[[-1,0],[1,0],[0,-1],[0,1],[-.7,-.7],[.7,-.7],[-.7,.7],[.7,.7]].some(([dx,dy])=>scoreAtTargetPoint({x:p.x+dx*radiusX,y:p.y+dy*radiusY})!==score);
          if(border)reasons.push('Inslag bij een scoringsrand: controleer de score.');
          return {...p,id:newId(),score,confidence:border&&p.confidence==='high'?'medium':p.confidence,reasons,reviewed:false,source:'serie'};
        });
        setPhotoView(null);setResult(next);setShowBefore(false);setShots(evaluated);setSaved(false);setSelected(null);
        if(fromNative&&autoSave&&evaluated.length===Number(expected)&&evaluated.length>0&&evaluated.length<=remaining&&evaluated.every(s=>s.confidence==='high')){
          commitShots(evaluated,'recognition');
          return {ok:true,phase:'saved',message:'Zekere serie toegevoegd.',score:[...active,...evaluated].reduce((n,s)=>n+s.score,0)};
        }
        setStatus(evaluated.length+' mogelijke inslagen. Controleer vooral de onzekere schoten.');
        return {ok:true,phase:'review',message:'Serie berekend. Controleer op de iPhone.',pendingScore:evaluated.reduce((n,s)=>n+s.score,0)};
      }
      async function analyze(){
        if(locked.current)return;locked.current=true;setBusy(true);setStatus('Kaartfoto\'s vergelijken...');
        try{await comparePhotos(before,after);}
        catch(e){if(mounted.current)setStatus(e.message);}
        finally{locked.current=false;if(mounted.current)setBusy(false);}
      }
      receiveNative.current=async(file,photo)=>{
        if(locked.current||!captureAllowed||photo.contextId!==nativeContext)throw new Error(nativeMessage);
        locked.current=true;setBusy(true);setStatus('Watch-foto ontvangen…');
        let imported=false;
        try{
          const image=await root.EppCameraSeries.readPhoto(file,{maxDimension:3000});
          if(!mounted.current||contextRef.current!==photo.contextId)throw new Error('De serie is gewijzigd. Maak een nieuwe foto.');
          const first=saved?after:before;
          if(!first){
            setBefore(image);setAfter(null);setResult(null);setShots([]);setSaved(false);setPhotoView(null);imported=true;
            setStatus('Startfoto ontvangen. Markeer de vier kaarthoeken en vul kaliber en kaartmaten in.');
            return {ok:true,phase:'baseline',message:'Markeer de vier kaarthoeken op de iPhone.'};
          }
          if(!root.EppCameraSeries.validCorners(first.corners))throw new Error('Markeer eerst de vier hoeken van de startfoto.');
          const sameShape=Math.abs(image.canvas.width/image.canvas.height-first.canvas.width/first.canvas.height)<.02;
          const last={...image,corners:sameShape?first.corners.map(p=>({...p})):[]};
          setBefore(first);setAfter(last);setResult(null);setShots([]);setSaved(false);setPhotoView(null);imported=true;
          if(!sameShape)throw new Error('De fotoverhouding is veranderd. Markeer de hoeken op de nieuwe foto.');
          return await comparePhotos(first,last,true);
        }catch(e){
          if(mounted.current)setStatus(e.message);
          // Once imported, keep the photo for manual corner correction/retry.
          if(imported)return {ok:true,phase:'alignment',message:'Foto ontvangen. Controleer de uitlijning op de iPhone.'};
          throw e;
        }finally{locked.current=false;if(mounted.current)setBusy(false);}
      };
      function addPoint(event){
        if(busy||saved||showBefore||shots.length>=Number(expected))return;
        const box=event.currentTarget.getBoundingClientRect(),p={x:(event.clientX-box.left)/box.width,y:(event.clientY-box.top)/box.height};
        const shot={...p,id:newId(),score:scoreAtTargetPoint(p),reviewed:false,source:'correctie',confidence:'low',reasons:['Handmatig toegevoegd; controleer positie en score.']};
        setShots(old=>[...old,shot]);setSelected(shot.id);
      }
      function duplicate(shot){
        if(saved||busy||shots.length>=Number(expected))return;
        const id=newId();setShots(old=>[...old,{...shot,id,reviewed:false,confidence:'low',source:'correctie',reasons:['Extra schot in hetzelfde gat: aantal en score handmatig controleren.']}]);setSelected(id);
      }
      const patch=(id,data)=>setShots(old=>old.map(s=>s.id===id?{...s,...data}:s));
      function commitShots(items,reviewMethod){
        const nextShots=items.map(s=>({id:s.id,sid,stage,trainingId,score:s.score,source:s.source,reviewed:true,reviewMethod,confidence:s.confidence,reasons:s.reasons,groupId:s.groupId,estimatedCount:s.estimatedCount,arcCount:s.arcCount,arcSupport:s.arcSupport,areaEquivalent:s.areaEquivalent,areaMm2:s.areaMm2,caliber:Number(caliber)||null,cardWidth:Number(cardWidth)||null,cardHeight:Number(cardHeight)||null,tx:s.x,ty:s.y,x:s.x,y:s.y,ts:Date.now(),seriesId:items[0].id}));
        setCameraShots(prev=>[...prev,...nextShots]);
        addRound({sid,type:'stage',stage,score:[...active,...nextShots].reduce((n,s)=>n+s.score,0),source:'camera',replaceKey:`camera-${trainingId}-${sid}-${stage}`});
        setSaved(true);setStatus(reviewMethod==='recognition'?'Zekere serie automatisch toegevoegd. De online opslagstatus staat bovenaan.':'Serie toegevoegd. De online opslagstatus staat bovenaan.');flash('Serie toegevoegd');
      }
      function save(){
        if(locked.current||saved||!result||shots.length!==Number(expected)||shots.some(s=>!s.reviewed)||Number(expected)>remaining)return;
        locked.current=true;try{commitShots(shots,'manual');}finally{locked.current=false;}
      }
      function nextSeries(){
        setBefore(after);setAfter(null);setResult(null);setShots([]);setSaved(false);setPhotoView(null);setSelected(null);setStatus('');setExpected(Math.min(5,remaining));
      }
      const cornerNames=['Linksboven','Rechtsboven','Rechtsonder','Linksonder'];
      function photoPanel(which,photo){
        const title=which==='before'?'Voor de serie':'Na de serie';
        return h('section',{className:'series-photo-section',key:which,hidden:cameraStep!==which},
          h('h3',null,title),
          h('div',{className:'series-file-row'},
            h('label',{className:'btn btn-ghost'},'Foto maken',h('input',{type:'file',accept:'image/*',capture:'environment',disabled:busy||saved,onChange:e=>{choose(which,e.target.files[0]);e.target.value='';},'aria-label':'Foto maken '+title.toLowerCase()})),
            h('label',{className:'btn btn-ghost'},'Foto kiezen',h('input',{type:'file',accept:'image/*',disabled:busy||saved,onChange:e=>{choose(which,e.target.files[0]);e.target.value='';},'aria-label':'Foto kiezen '+title.toLowerCase()}))
          ),
          photo&&h(React.Fragment,null,
            h('div',{className:'series-photo',onClick:e=>corner(which,e)},
              h('img',{src:photo.url,alt:title,draggable:false}),
              photo.corners.map((p,i)=>h('span',{className:'series-corner',key:i,style:{left:p.x*100+'%',top:p.y*100+'%'}},i+1))
            ),
            h('div',{className:'series-corner-row'},
              h('span',null,photo.corners.length<4?'Hoek '+(photo.corners.length+1)+': '+cornerNames[photo.corners.length]:'Vier hoeken gemarkeerd'),
              h('button',{type:'button',className:'btn btn-ghost',disabled:busy||saved,onClick:()=>{(which==='before'?setBefore:setAfter)(p=>({...p,corners:[]}));setResult(null);setShots([]);}},'Hoeken opnieuw')
            )
          )
        );
      }
      const available=[...shooters,...registeredShooters.filter(s=>!shooters.some(existing=>existing.id===s.id)).map(s=>({id:s.id,naam:s.display_name}))];
      const selectShooter=value=>{
        change(id=>{if(id&&!shooters.some(s=>s.id===id))addShooter(id);setSid(id);},value);
      };
      const shooterPicker=h('select',{className:'cam-select',value:sid,disabled:busy||!!shooterDirectoryStatus,'aria-label':'Schutter',onChange:e=>selectShooter(e.target.value)},h('option',{value:''},'Kies een schutter'),available.map(s=>h('option',{key:s.id,value:s.id},s.naam)));
      if(!sid||!shooters.some(s=>s.id===sid))return h('div',{className:'page-fade series-camera'},h('h2',null,'Camera per serie ',h('span',{className:'series-beta'},'Beta')),h('p',{className:'hint'},'Selecteer een schutter om de camerafunctie te starten.'),shooterPicker,h('p',{className:'hint',role:'status'},shooterDirectoryStatus||(!available.length?'Er zijn nog geen schutters met een goedgekeurd account beschikbaar.':'')));

      return h('div',{className:'page-fade series-camera'},
        h('section',null,
          h('h2',null,'Camera per serie ',h('span',{className:'series-beta'},'Beta')),
          shooterPicker,
          nativeAvailable&&h('section',{className:'series-native'},
            h('strong',null,'Apple Watch gekoppeld via de hulpapp'),
            h('p',{className:'hint'},'Houd deze hulpapp open en laat de iPhone op hetzelfde statief staan. De eerste foto is de startfoto; volgende foto’s worden automatisch vergeleken.'),
            h('button',{type:'button',className:'btn btn-gold',disabled:!captureAllowed,onClick:()=>native.capture()},before?'Maak seriefoto':'Maak startfoto'),
            h('label',null,h('input',{type:'checkbox',checked:autoSave,disabled:busy||!!result&&!saved,onChange:e=>setAutoSave(e.target.checked)}),' Alleen volledig zekere series automatisch toevoegen'),
            h('p',{className:'hint'},'Automatisch toevoegen gebruikt de herkenningsindicatie, geen menselijke controle. Bij twijfel of een afwijkend aantal blijft de serie ter beoordeling staan.')
          ),
          h(StageCarousel,{stageKey:stage,onSelect:s=>change(setStage,s)}),
          h('details',{className:'series-calibration-tools',key:result?'review':'capture',open:!result},h('summary',null,'Kaliber en kaartmaten'),h('div',{className:'series-calibration'},
            h('label',null,'Kaliber (mm)',h('input',{className:'sel-in',type:'number',min:2,max:20,step:.01,placeholder:'Bijv. 9',value:caliber,disabled:busy||saved||!!result,onChange:e=>setCaliber(e.target.value)})),
            h('label',null,'Kaartbreedte (mm)',h('input',{className:'sel-in',type:'number',min:50,max:2000,step:1,value:cardWidth,placeholder:'Bijv. 450',disabled:busy||saved||!!result,onChange:e=>setCardWidth(e.target.value)})),
            h('label',null,'Kaarthoogte (mm)',h('input',{className:'sel-in',type:'number',min:50,max:2000,step:1,value:cardHeight,placeholder:'Bijv. 650',disabled:busy||saved||!!result,onChange:e=>setCardHeight(e.target.value)}))
          )),
          h('p',{className:'hint camera-calibration-note'},'Vul de werkelijke afmetingen tussen de vier gemarkeerde hoeken in. Zonder deze maten blijven detecties onzeker. Gatoppervlakte en randbogen geven een schatting; volledig overlappende schoten zijn niet uit een foto te tellen.'),
          h('div',{className:'series-count'},
            h('label',null,'Schoten in deze serie',h('select',{className:'sel-in',value:expected,disabled:busy||saved||!remaining,onChange:e=>setExpected(Number(e.target.value))},Array.from({length:remaining},(_,i)=>h('option',{key:i+1,value:i+1},i+1)))),
            h('strong',null,active.reduce((n,s)=>n+s.score,0)+' / '+maxOf(stage)+' punten'),
            h('span',null,active.length+' / '+limit+' schoten opgeslagen')
          )
        ),
        !remaining&&!saved&&h('p',{className:'hint'},'Deze stage is volledig geregistreerd. Kies een andere stage of start een nieuwe training.'),
        h('nav',{className:'camera-steps','aria-label':'Stappen fotometing'},[['before','1 · Startfoto'],['after','2 · Seriefoto'],['review','3 · Controle']].map(([key,label])=>h('button',{key,type:'button','aria-current':cameraStep===key?'step':undefined,disabled:busy||(key==='after'&&!startReady)||(key==='review'&&!result),onClick:()=>setPhotoView(key)},label))),
        h('div',{className:'series-photos'},photoPanel('before',before),photoPanel('after',after)),
        !result&&h('button',{className:'btn btn-gold btn-full',disabled:busy||saved||!remaining||!before||!after||!root.EppCameraSeries.validCorners(before.corners)||!root.EppCameraSeries.validCorners(after.corners),onClick:analyze},busy?'Vergelijken...':'Vergelijk serie'),
        status&&h('p',{role:'status',className:'hint'},status),
        result&&h('section',{className:'series-review',hidden:cameraStep!=='review'},
          h('h3',null,'Serie controleren'),
          h('p',{className:'series-confidence-legend'},h('span',{className:'confidence-high'},'Groen: zeker'),h('span',{className:'confidence-medium'},'Oranje: twijfel'),h('span',{className:'confidence-low'},'Rood: onzeker')),
          h('p',{className:'hint'},'Kleur geeft een herkenningsindicatie, geen gemeten kans. Controleer ook de score bij een zonerand. Onzekere schoten staan bovenaan.'),
          !saved&&h('button',{className:'btn btn-ghost',disabled:!uncertain.length,onClick:reviewNext},'Loop onzekere schoten na ('+uncertain.length+')'),
          shots.length!==Number(expected)&&h('p',{className:'hint',role:'status'},'Er zijn '+shots.length+' van '+expected+' schoten herkend. Controleer op overlap, ontbrekende inslagen of een misser.'),
          h('div',{className:'series-toggle'},
            h('button',{className:'btn '+(!showBefore?'btn-gold':'btn-ghost'),onClick:()=>setShowBefore(false),'aria-pressed':!showBefore},'Na'),
            h('button',{className:'btn '+(showBefore?'btn-gold':'btn-ghost'),onClick:()=>setShowBefore(true),'aria-pressed':showBefore},'Voor')
          ),
          h('div',{className:'series-photo series-result',onClick:addPoint},
            h('img',{src:showBefore?result.beforeUrl:result.url,alt:showBefore?'Kaart voor de serie':'Kaart na de serie',draggable:false}),
            !showBefore&&shots.map((s,i)=>Number.isFinite(s.x)?h('button',{key:s.id,type:'button',className:'series-marker confidence-'+(s.confidence||'low')+(s.reviewed?' reviewed':'')+(selected===s.id?' selected':''),style:{left:s.x*100+'%',top:s.y*100+'%'},'aria-label':'Inslag '+(i+1)+': '+(confidenceLabel[s.confidence]||'Onzeker'),onClick:e=>{e.stopPropagation();setSelected(s.id);}},i+1):null)
          ),
          h('div',{className:'series-review-total'},h('strong',null,pending+' punten'),h('span',null,shots.length+' / '+expected+' geregistreerd')),
          h('div',{className:'series-shot-list'},orderedShots.map(s=>h('div',{key:s.id,id:'series-shot-'+s.id,className:'series-shot-row'+(selected===s.id?' selected':'')},
            h('div',{className:'series-shot-heading'},h('button',{type:'button',className:'series-shot-focus',onClick:()=>{setSelected(s.id);setShowBefore(false);}},'Schot '+s.number),h('span',{className:'confidence-'+(s.confidence||'low')},confidenceLabel[s.confidence]||'Onzeker')),
            h('select',{className:'sel-in','aria-label':'Score schot '+s.number,value:s.score,disabled:saved,onChange:e=>patch(s.id,{score:Number(e.target.value),reviewed:false})},[0,2,3,4,5].map(v=>h('option',{key:v,value:v},v+' punten'))),
            h('label',null,h('input',{type:'checkbox',checked:s.reviewed,disabled:saved,onChange:e=>patch(s.id,{reviewed:e.target.checked})}),' Gecontroleerd'),
            h('button',{type:'button',className:'btn btn-ghost','aria-label':'Verwijder schot '+s.number,disabled:saved,onClick:()=>setShots(old=>old.filter(x=>x.id!==s.id))},'×'),
            h('div',{className:'series-shot-evidence'},
              h('span',null,(s.reasons||[]).join(' ')),
              s.areaMm2!=null&&h('span',null,'Nieuw gatoppervlak: '+s.areaMm2.toFixed(1)+' mm² · '+s.areaEquivalent.toFixed(1)+'× één kalibergat · '+s.arcCount+' schotvorm'+(s.arcCount===1?'':'en')+' uit randbogen.'),
              !saved&&Number.isFinite(s.x)&&h('button',{type:'button',className:'btn btn-ghost',disabled:busy||shots.length>=Number(expected),onClick:()=>duplicate(s)},'+ Schot in dit gat')
            )
          ))),
          !saved&&h('button',{className:'btn btn-ghost btn-full',disabled:shots.length>=Number(expected),onClick:()=>setShots(old=>[...old,{id:newId(),score:0,reviewed:true,source:'misser',confidence:'low',reasons:['Misser handmatig bevestigd.']}])},'Misser toevoegen (0)'),
          !saved&&h('button',{className:'btn btn-gold btn-full',disabled:busy||!shots.length||shots.length!==Number(expected)||shots.some(s=>!s.reviewed)||Number(expected)>remaining,onClick:save},'Serie opslaan'),
          saved&&remaining>0&&h('button',{className:'btn btn-gold btn-full',onClick:nextSeries},'Volgende serie'),
          h('button',{className:'btn btn-ghost btn-full',disabled:busy,onClick:()=>{if(saved||confirm('De nog niet opgeslagen serie verwijderen?'))reset();}},'Nieuwe fotometing')
        )
      );
    };
  };
})(globalThis);
