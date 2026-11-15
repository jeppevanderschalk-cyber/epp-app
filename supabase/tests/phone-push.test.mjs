import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pushEndpoint,pushSubscription,pushMessage,deliverPush,processPush} from '../functions/epp-push/service.ts';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
const subscription={endpoint:'https://web.push.apple.com/test',p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64)]).toString('base64url'),auth:Buffer.alloc(16).toString('base64url')};
test('push endpoints are restricted to browser services; local hosts and redirects are excluded',()=>{
 for(const endpoint of ['https://fcm.googleapis.com/fcm/send/test','https://web.push.apple.com/test','https://updates.push.services.mozilla.com/wpush/v2/test','https://wns2-db5p.notify.windows.com/w/?token=test'])assert.equal(pushEndpoint(endpoint),endpoint);
 for(const endpoint of ['http://web.push.apple.com/test','https://127.0.0.1/x','https://web.push.apple.com.evil.test/x','https://user:pass@web.push.apple.com/x','https://web.push.apple.com:444/x','https://web.push.apple.com/x#x','https://evil.test/'])assert.throws(()=>pushEndpoint(endpoint),/ongeldig_pushapparaat/);
 assert.deepEqual(pushSubscription({endpoint:subscription.endpoint,keys:subscription}),subscription);
 assert.throws(()=>pushSubscription({endpoint:subscription.endpoint,keys:{auth:'x',p256dh:'x'}}),/ongeldig_pushapparaat/);
});
test('lockscreen payloads contain no account names, passwords or reset tokens',()=>{
 const message=pushMessage('request-id');assert.match(message.body,/wachtwoordreset/);assert.equal(message.url,'/?melding=wachtwoordherstel');assert.equal(message.tag,'epp-password-help-request-id');
});
test('delivery uses encrypted generated data, forbids redirect following and handles expiry/retry',async()=>{
 let generated,request;
 const generate=(sub,payload,options)=>{generated={sub,payload,options};return {headers:{Authorization:'vapid-signature'},body:'encrypted'};};
 const config={publicKey:'public',privateKey:'private'};
 const result=await deliverPush(subscription,pushMessage('request'),config,generate,async(url,options)=>{request={url,options};return new Response('',{status:201});});
 assert.equal(result.sent,true);assert.equal(request.options.body,'encrypted');assert.equal(request.options.redirect,'manual');assert.equal(generated.options.contentEncoding,'aes128gcm');assert.equal(generated.options.vapidDetails.subject,'https://epp-app.nl');
 for(const status of [404,410])assert.equal((await deliverPush(subscription,{},config,generate,async()=>new Response('',{status}))).expired,true);
 for(const status of [429,503])assert.equal((await deliverPush(subscription,{},config,generate,async()=>new Response('',{status}))).retry,true);
 assert.equal((await deliverPush(subscription,{},config,generate,async()=>new Response('',{status:302}))).sent,false);
});
test('unconfigured workers do not claim; transient failures are recorded without secrets',async()=>{
 assert.equal((await processPush({rpc:()=>{throw Error('do not claim');}},{},()=>{})).configured,false);
 const calls=[];const db={rpc:async(name,body)=>{calls.push({name,body});return name==='epp_claim_push_jobs'?{data:[{...subscription,id:'job',request_id:'request',lease_token:'lease'}]}:{error:null};}};
 await processPush(db,{publicKey:'public',privateKey:'secret'},()=>{throw Error('secret');});
 assert.equal(calls[1].body.p_error,'push_onbereikbaar');assert.equal(calls[1].body.p_retry,true);assert.equal(calls[1].body.p_lease,'lease');
});
test('service worker always displays notifications and opens only the trusted app route',async()=>{
 const handlers={},shown=[],opened=[],posted=[];
 const context={URL,self:{location:{origin:'https://epp-app.nl'},addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(...args)=>shown.push(args)},clients:{claim:async()=>{},matchAll:async()=>[{url:'https://evil.test/',focus:()=>{throw Error('external focus');}},{url:'https://epp-app.nl/',postMessage:m=>posted.push(m),focus:async()=>{}}],openWindow:async url=>opened.push(url)},skipWaiting:()=>{}}};
 runInNewContext(readFileSync(new URL('../../epp-push-sw.js',import.meta.url),'utf8'),context);
 let work;handlers.push({data:{json:()=>({...pushMessage('id'),url:'https://evil.test/'})},waitUntil:p=>work=p});await work;
 assert.equal(shown[0][0],'Wachtwoordherstel gevraagd');assert.equal(shown[0][1].data.url,'/?melding=wachtwoordherstel');
 handlers.notificationclick({notification:{close:()=>{}},waitUntil:p=>work=p});await work;assert.equal(posted[0].type,'epp-open-password-help');assert.equal(opened.length,0);
 context.self.clients.matchAll=async()=>[];handlers.notificationclick({notification:{close:()=>{}},waitUntil:p=>work=p});await work;assert.equal(opened[0],'https://epp-app.nl/?melding=wachtwoordherstel');
 assert.equal(handlers.fetch,undefined,'Service worker must not cache app pages or credentials');
});
