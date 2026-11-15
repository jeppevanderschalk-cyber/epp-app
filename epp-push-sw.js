'use strict';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// This worker deliberately has no fetch handler: application pages stay online.
self.addEventListener('push',event=>{
 let message={};try{message=event.data?.json()||{};}catch{}
 event.waitUntil(self.registration.showNotification(message.title||'EPP',{
  body:message.body||'Er is een nieuwe melding in EPP.',
  icon:'/app-icon-192.png',badge:'/app-icon-192.png',tag:message.tag||'epp-notification',
  data:{url:'/?melding=wachtwoordherstel'}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=new URL('/?melding=wachtwoordherstel',self.location.origin).href;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
  for(const client of windows){
   if(new URL(client.url).origin!==self.location.origin)continue;
   client.postMessage({type:'epp-open-password-help'});await client.focus();return;
  }
  return self.clients.openWindow(target);
 }));
});
