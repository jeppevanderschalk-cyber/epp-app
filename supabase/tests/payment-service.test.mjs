import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal} from '../functions/epp-payments/provider.ts';
import {paymentService} from '../functions/epp-payments/service.ts';
const config={encryptionKey:'c'.repeat(64),publicUrl:'https://epp-app.nl/',functionUrl:'https://example.supabase.co/functions/v1/epp-payments'};
async function fixture(fetcher){
  const order={id:'fixture-order',match_id:'fixture-match',actor_id:'actor',shooter_id:'shooter',club_code:'apgs',organization_id:'org_apgs',profile_id:'pfl_apgs',choices:[{discipline:'pistool',slotId:'fixture-slot'}],amount_cents:1200,currency:'EUR',status:'creating',created_at:new Date().toISOString(),expected_revision:0,provider_id:null,create_token:null};
  const account={club_code:'apgs',organization_id:'org_apgs',credentials:await seal({accessToken:'frozen-access',refreshToken:'refresh-fixture',expiresAt:Date.now()+3600000},config.encryptionKey,'club:apgs')};
  const calls=[];
  const db={from(table){const filters=[];let values=null;
    const matches=row=>filters.every(([key,value])=>row[key]===value);
    const run=()=>{let row=table==='epp_payment_orders'?order:account;if(!matches(row))return {data:null,error:null};if(values)Object.assign(row,values);return {data:{...row},error:null};};
    const query={select(){return this;},eq(key,value){filters.push([key,value]);return this;},is(key,value){filters.push([key,value]);return this;},update(value){values=value;return this;},single:async()=>run(),then(resolve,reject){return Promise.resolve(run()).then(resolve,reject);}};return query;
  },rpc:async(name,args)=>{calls.push({name,args});if(name==='epp_payment_apply'){order.status=args.p_status;order.refunded_cents=args.p_refunded;if(order.status==='paid')order.confirmed_at=new Date().toISOString();}return {data:{status:order.status},error:null};}};
  return {order,account,calls,service:paymentService(db,config,fetcher)};
}
function response(status='open'){return {id:'tr_fixture',profileId:'pfl_apgs',mode:'live',metadata:{eppOrderId:'fixture-order',club:'apgs'},amount:{currency:'EUR',value:'12.00'},status,_links:{checkout:{href:'https://www.mollie.com/checkout/fixture'}}};}
test('retry after a lost response reuses frozen token, body and idempotency key',async()=>{
  const requests=[];let first=true;
  const f=await fixture(async(url,options)=>{requests.push({url,...options});if(first){first=false;throw Error('network dropped after possible charge');}return Response.json(response());});
  await assert.rejects(f.service.create({...f.order}));assert.equal(f.order.status,'creating');assert.equal(f.order.provider_id,null);
  f.account.credentials=await seal({accessToken:'newer-access',expiresAt:Date.now()+3600000},config.encryptionKey,'club:apgs');
  const order=await f.service.create({...f.order});assert.equal(order.status,'open');assert.equal(f.order.provider_id,'tr_fixture');
  assert.equal(requests.length,2);assert.equal(requests[0].headers.Authorization,requests[1].headers.Authorization);assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);assert.equal(requests[0].body,requests[1].body);
  assert.equal((await unseal(f.order.create_token,config.encryptionKey,'order:fixture-order')).accessToken,'frozen-access');
});
test('webhook queries recipient account and rejects forged amount before database mutation',async()=>{
  const f=await fixture(async()=>Response.json({...response('paid'),amount:{currency:'EUR',value:'0.01'}}));f.order.provider_id='tr_fixture';
  await assert.rejects(f.service.sync({...f.order}),{message:'betaling_verificatie_mislukt'});assert.equal(f.calls.length,0);assert.equal(f.order.status,'creating');
});
test('settlement, not the return URL, triggers confirmation',async()=>{
  let remote='pending';const f=await fixture(async()=>Response.json(response(remote)));f.order.provider_id='tr_fixture';
  assert.equal((await f.service.sync({...f.order})).status,'pending');assert.equal(f.order.confirmed_at,undefined);
  remote='paid';assert.equal((await f.service.sync({...f.order})).status,'paid');assert.ok(f.order.confirmed_at);
});
test('changed recipient is rejected before any request',async()=>{
  let fetched=false;const f=await fixture(async()=>{fetched=true;return Response.json(response());});f.account.organization_id='org_other';f.order.provider_id='tr_fixture';
  await assert.rejects(f.service.sync({...f.order}),{message:'betaalaccount_gewijzigd'});assert.equal(fetched,false);
});
test('old ambiguous creation never creates another payment or releases the hold',async()=>{
  let fetched=false;const f=await fixture(async()=>{fetched=true;return Response.json(response());});f.order.created_at=new Date(Date.now()-3600000).toISOString();
  await assert.rejects(f.service.create({...f.order}),{message:'betaling_controle_nodig'});assert.equal(fetched,false);assert.equal(f.order.status,'review');
});
