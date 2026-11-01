(function(root){
  'use strict';
  let receiver=null,contextId=null,lastState=null;
  const completed=new Map(),inFlight=new Map();
  const available=()=>!!root.webkit?.messageHandlers?.eppCamera;
  const visible=()=>!root.document?.getElementById('root')?.hidden;
  function post(message){if(available())root.webkit.messageHandlers.eppCamera.postMessage(message);}
  function attach(context,handler){
    contextId=context;receiver=handler;
    return ()=>{if(contextId===context){contextId=null;receiver=null;lastState=null;post({type:'state',contextId:context,captureAllowed:false,message:'Open Camera per serie op de iPhone.'});}};
  }
  async function receivePhoto(photo){
    if(!visible())throw new Error('Log eerst in bij EPP.');
    if(!receiver||photo?.contextId!==contextId)throw new Error('De schutter of serie is gewijzigd. Maak een nieuwe foto.');
    if(typeof photo.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(photo.id)||photo.mime!=='image/jpeg'||typeof photo.base64!=='string'||!photo.base64.length||photo.base64.length>40000000)throw new Error('Ongeldige camerafoto.');
    if(completed.has(photo.id))return completed.get(photo.id);
    if(inFlight.has(photo.id))return inFlight.get(photo.id);
    const handler=receiver;
    const task=Promise.resolve().then(async()=>{
      const bytes=Uint8Array.from(atob(photo.base64),c=>c.charCodeAt(0));
      if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw new Error('De foto is geen JPEG.');
      if(!visible())throw new Error('Log eerst in bij EPP.');
      const result=await handler(new File([bytes],'serie-'+photo.id+'.jpg',{type:photo.mime}),photo);
      completed.set(photo.id,result);
      if(completed.size>50)completed.delete(completed.keys().next().value);
      return result;
    }).finally(()=>inFlight.delete(photo.id));
    inFlight.set(photo.id,task);return task;
  }
  function state(value){if(contextId&&value.contextId===contextId){lastState=value;post({type:'state',...value,captureAllowed:value.captureAllowed&&visible(),message:visible()?value.message:'Log eerst in bij EPP.'});}}
  function capture(){if(contextId&&visible())post({type:'capture',contextId});}
  const workspace=root.document?.getElementById('root');
  if(workspace&&root.MutationObserver)new root.MutationObserver(()=>{if(lastState)state(lastState);}).observe(workspace,{attributes:true,attributeFilter:['hidden']});
  root.EppCameraNative={available,attach,receivePhoto,state,capture};
})(globalThis);
