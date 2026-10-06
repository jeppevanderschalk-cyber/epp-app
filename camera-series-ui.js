(function(root){
  'use strict';
  root.createEppSeriesCamera=function({React,h,STAGES,StageCarousel,scoreAtTargetPoint,newId}){
    return function SeriesCamera({shooters,cameraShots,setCameraShots,maxOf,flash,addRound,trainingId}){
      const [sid,setSid]=React.useState(shooters[0]?.id||''),[stage,setStage]=React.useState('s1');
      const [before,setBefore]=React.useState(null),[after,setAfter]=React.useState(null);
      const [result,setResult]=React.useState(null),[shots,setShots]=React.useState([]);
      const [busy,setBusy]=React.useState(false),[status,setStatus]=React.useState(''),[saved,setSaved]=React.useState(false);
      const [expected,setExpected]=React.useState(5),[selected,setSelected]=React.useState(null);
      const [showBefore,setShowBefore]=React.useState(false);
      const locked=React.useRef(false),mounted=React.useRef(true);
      React.useEffect(()=>()=>{mounted.current=false;},[]);
      React.useEffect(()=>{if(!sid&&shooters[0])setSid(shooters[0].id);},[shooters,sid]);
      const active=cameraShots.filter(s=>s.sid===sid&&s.stage===stage&&s.trainingId===trainingId);
      const limit=Math.round(maxOf(stage)/5),remaining=Math.max(0,limit-active.length);
      React.useEffect(()=>{if(remaining>0)setExpected(n=>Math.min(n,remaining));},[remaining]);
      const pending=shots.reduce((n,s)=>n+s.score,0);
      const reset=()=>{setBefore(null);setAfter(null);setResult(null);setShots([]);setSaved(false);setStatus('');setSelected(null);};
      const change=(fn,value)=>{
        if(busy)return;
        if((before||after||shots.length)&&!saved&&!confirm('De nog niet opgeslagen serie verwijderen?'))return;
        reset();setExpected(5);fn(value);
      };
      async function choose(which,file){
        if(!file||locked.current)return;
        if(result&&!saved&&!confirm('De beoordeling van deze serie vervangen?'))return;
        locked.current=true;setBusy(true);setStatus('Foto openen...');
        try{
          const photo=await root.EppCameraSeries.readPhoto(file);
          if(!mounted.current)return;
          (which==='before'?setBefore:setAfter)(photo);
          setResult(null);setShots([]);setSaved(false);setStatus('');setSelected(null);
        }catch(e){if(mounted.current)setStatus(e.message);}
        finally{locked.current=false;if(mounted.current)setBusy(false);}
      }
      function corner(which,event){
        if(busy||saved||result)return;
        const box=event.currentTarget.getBoundingClientRect(),p={x:(event.clientX-box.left)/box.width,y:(event.clientY-box.top)/box.height};
        (which==='before'?setBefore:setAfter)(old=>old&&old.corners.length<4?{...old,corners:[...old.corners,p]}:old);
      }
      async function analyze(){
        if(locked.current)return;locked.current=true;setBusy(true);setStatus('Kaartfoto\'s vergelijken...');
        try{
          const next=await root.EppCameraSeries.compare(before,after);
          if(!mounted.current)return;
          setResult(next);setShowBefore(false);setShots(next.candidates.map(p=>({...p,id:newId(),score:scoreAtTargetPoint(p),reviewed:false,source:'serie'})));
          setStatus(next.candidates.length+' mogelijke inslagen.');setSaved(false);
        }catch(e){if(mounted.current)setStatus(e.message);}
        finally{locked.current=false;if(mounted.current)setBusy(false);}
      }
      function addPoint(event){
        if(busy||saved||showBefore||shots.length>=Number(expected))return;
        const box=event.currentTarget.getBoundingClientRect(),p={x:(event.clientX-box.left)/box.width,y:(event.clientY-box.top)/box.height};
        const shot={...p,id:newId(),score:scoreAtTargetPoint(p),reviewed:false,source:'correctie'};
        setShots(old=>[...old,shot]);setSelected(shot.id);
      }
      const patch=(id,data)=>setShots(old=>old.map(s=>s.id===id?{...s,...data}:s));
      function save(){
        if(locked.current||saved||!result||shots.length!==Number(expected)||shots.some(s=>!s.reviewed)||Number(expected)>remaining)return;
        locked.current=true;
        const nextShots=shots.map(s=>({id:s.id,sid,stage,trainingId,score:s.score,source:s.source,tx:s.x,ty:s.y,x:s.x,y:s.y,ts:Date.now(),seriesId:shots[0].id}));
        setCameraShots(prev=>[...prev,...nextShots]);
        addRound({sid,type:'stage',stage,score:[...active,...nextShots].reduce((n,s)=>n+s.score,0),source:'camera',replaceKey:`camera-${trainingId}-${sid}-${stage}`});
        setSaved(true);setStatus('Serie toegevoegd. De online opslagstatus staat bovenaan.');flash('Serie toegevoegd');locked.current=false;
      }
      function nextSeries(){
        setBefore(after);setAfter(null);setResult(null);setShots([]);setSaved(false);setSelected(null);setStatus('');setExpected(Math.min(5,remaining));
      }
      const cornerNames=['Linksboven','Rechtsboven','Rechtsonder','Linksonder'];
      function photoPanel(which,photo){
        const title=which==='before'?'Voor de serie':'Na de serie';
        return h('section',{className:'series-photo-section',key:which},
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
      if(!shooters.length)return h('p',{className:'hint'},'Voeg eerst een schutter toe via Parcours of Stages.');
      return h('div',{className:'page-fade series-camera'},
        h('section',null,
          h('h2',null,'Camera per serie ',h('span',{className:'series-beta'},'Beta')),
          h('select',{className:'cam-select',value:sid,disabled:busy,'aria-label':'Schutter',onChange:e=>change(setSid,e.target.value)},shooters.map(s=>h('option',{key:s.id,value:s.id},s.naam))),
          h(StageCarousel,{stageKey:stage,onSelect:s=>change(setStage,s)}),
          h('div',{className:'series-count'},
            h('label',null,'Schoten in deze serie',h('select',{className:'sel-in',value:expected,disabled:busy||saved||!remaining,onChange:e=>setExpected(Number(e.target.value))},Array.from({length:remaining},(_,i)=>h('option',{key:i+1,value:i+1},i+1)))),
            h('strong',null,active.reduce((n,s)=>n+s.score,0)+' / '+maxOf(stage)+' punten'),
            h('span',null,active.length+' / '+limit+' schoten opgeslagen')
          )
        ),
        !remaining&&!saved&&h('p',{className:'hint'},'Deze stage is volledig geregistreerd. Kies een andere stage of start een nieuwe training.'),
        h('div',{className:'series-photos'},photoPanel('before',before),photoPanel('after',after)),
        !result&&h('button',{className:'btn btn-gold btn-full',disabled:busy||saved||!remaining||!before||!after||!root.EppCameraSeries.validCorners(before.corners)||!root.EppCameraSeries.validCorners(after.corners),onClick:analyze},busy?'Vergelijken...':'Vergelijk serie'),
        status&&h('p',{role:'status',className:'hint'},status),
        result&&h('section',{className:'series-review'},
          h('h3',null,'Serie controleren'),
          h('div',{className:'series-toggle'},
            h('button',{className:'btn '+(!showBefore?'btn-gold':'btn-ghost'),onClick:()=>setShowBefore(false),'aria-pressed':!showBefore},'Na'),
            h('button',{className:'btn '+(showBefore?'btn-gold':'btn-ghost'),onClick:()=>setShowBefore(true),'aria-pressed':showBefore},'Voor')
          ),
          h('div',{className:'series-photo series-result',onClick:addPoint},
            h('img',{src:showBefore?result.beforeUrl:result.url,alt:showBefore?'Kaart voor de serie':'Kaart na de serie',draggable:false}),
            !showBefore&&shots.filter(s=>Number.isFinite(s.x)).map((s,i)=>h('button',{key:s.id,type:'button',className:'series-marker'+(s.reviewed?' reviewed':''),style:{left:s.x*100+'%',top:s.y*100+'%'},'aria-label':'Inslag '+(i+1),onClick:e=>{e.stopPropagation();setSelected(s.id);}},i+1))
          ),
          h('div',{className:'series-review-total'},h('strong',null,pending+' punten'),h('span',null,shots.length+' / '+expected+' geregistreerd')),
          h('div',{className:'series-shot-list'},shots.map((s,i)=>h('div',{key:s.id,className:'series-shot-row'+(selected===s.id?' selected':'')},
            h('span',null,'Schot '+(i+1)),
            h('select',{className:'sel-in','aria-label':'Score schot '+(i+1),value:s.score,disabled:saved,onChange:e=>patch(s.id,{score:Number(e.target.value),reviewed:false})},[0,2,3,4,5].map(v=>h('option',{key:v,value:v},v+' punten'))),
            h('label',null,h('input',{type:'checkbox',checked:s.reviewed,disabled:saved,onChange:e=>patch(s.id,{reviewed:e.target.checked})}),' Gecontroleerd'),
            h('button',{type:'button',className:'btn btn-ghost','aria-label':'Verwijder schot '+(i+1),disabled:saved,onClick:()=>setShots(old=>old.filter(x=>x.id!==s.id))},'×')
          ))),
          !saved&&h('button',{className:'btn btn-ghost btn-full',disabled:shots.length>=Number(expected),onClick:()=>setShots(old=>[...old,{id:newId(),score:0,reviewed:true,source:'misser'}])},'Misser toevoegen (0)'),
          !saved&&h('button',{className:'btn btn-gold btn-full',disabled:busy||!shots.length||shots.length!==Number(expected)||shots.some(s=>!s.reviewed)||Number(expected)>remaining,onClick:save},'Serie opslaan'),
          saved&&remaining>0&&h('button',{className:'btn btn-gold btn-full',onClick:nextSeries},'Volgende serie'),
          h('button',{className:'btn btn-ghost btn-full',disabled:busy,onClick:()=>{if(saved||confirm('De nog niet opgeslagen serie verwijderen?'))reset();}},'Nieuwe fotometing')
        )
      );
    };
  };
})(globalThis);
