import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notificationMessage,deliverNotification,processNotifications} from '../functions/epp-notifications/delivery.ts';
const job={id:'job-id',recipient:'admin@example.nl',lease_token:'lease',kind:'account',payload:{name:'Anne de Vries',club:'SVBB'}};
const config={apiKey:'test-secret',from:'EPP <meldingen@example.nl>'};
test('notifications use full names, readable text and a login link',()=>{
 const message=notificationMessage(job);assert.match(message.text,/Anne de Vries/);assert.match(message.text,/https:\/\/epp-app.nl\//);
 const signup=notificationMessage({...job,kind:'signup',payload:{...job.payload,match:'EPP wedstrijd',date:'2030-12-01',choices:[{discipline:'pistool',day:'2030-12-01',time:'10:30'}]}});
 assert.match(signup.subject,/wedstrijdinschrijving/);assert.match(signup.text,/pistool: 2030-12-01 10:30/);
});
test('mail request freezes recipient and uses a stable idempotency key',async()=>{
 let request;
 const result=await deliverNotification(job,config,async(url,options)=>{request={url,...options};return Response.json({id:'provider-id'});});
 assert.equal(result.sent,true);assert.equal(result.providerId,'provider-id');assert.equal(request.url,'https://api.resend.com/emails');
 assert.equal(request.headers['Idempotency-Key'],'epp-notification/job-id');assert.deepEqual(JSON.parse(request.body).to,['admin@example.nl']);
 assert.match(JSON.parse(request.body).text,/Anne de Vries/);assert.ok(!request.body.includes(config.apiKey));
});
test('temporary provider failures retry; invalid sender or recipient fails visibly',async()=>{
 for(const status of [429,500,503])assert.deepEqual(await deliverNotification(job,config,async()=>new Response('',{status})),{sent:false,retry:true,error:'maildienst_http_'+status});
 assert.deepEqual(await deliverNotification(job,config,async()=>new Response('',{status:403})),{sent:false,retry:false,error:'maildienst_http_403'});
 assert.equal((await deliverNotification(job,config,async()=>Response.json({}))).sent,false);
});
test('unconfigured email never claims or loses queued messages',async()=>{
 const db={rpc:()=>{throw Error('must not claim');}};assert.deepEqual(await processNotifications(db,{}),{configured:false,sent:0,failed:0});
});
test('only provider success is marked sent; errors do not include credentials',async()=>{
 const calls=[];
 const db={rpc:async(name,args)=>{calls.push({name,args});return name==='epp_claim_notifications'?{data:[job]}:{error:null};}};
 assert.deepEqual(await processNotifications(db,config,async()=>Response.json({id:'message-id'})),{configured:true,sent:1,failed:0});
 assert.equal(calls[1].args.p_sent,true);assert.equal(calls[1].args.p_token,'lease');
 calls.length=0;
 await processNotifications(db,config,async()=>{throw Error('provider leaked secret '+config.apiKey);});
 assert.equal(calls[1].args.p_sent,false);assert.equal(calls[1].args.p_retry,true);assert.equal(calls[1].args.p_error,'maildienst_onbereikbaar');
});
