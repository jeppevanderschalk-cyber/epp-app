import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {configured,publicOrder} from '../functions/epp-payments/provider.ts';
const source=(await readFile(new URL('../functions/epp-payments/index.ts',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const mid='22222222-2222-4222-8222-222222222222',oid='33333333-3333-4333-8333-333333333333';
const admin={id:'admin',role:'trainer',is_admin:true,club_code:'apgs'};
async function run(actor,body={},options={}){
  let handler;const calls=[];
  const rows={epp_matches:{id:mid,club_id:'apgs',organizer:'APGS',payment_required:true},epp_match_planners:{owner_club:'apgs'},epp_payment_accounts:{organization_id:'org_apgs',organization_name:'APGS',profile_id:'pfl_apgs',can_receive:true,credentials:'NEVER_RETURN'},epp_payment_runtime:{enabled:false},shooters:{id:'own-shooter'}};
  const db={from(table){let fields='*';return {select(value){fields=value;return this;},eq(){return this;},maybeSingle(){const row=rows[table];return Promise.resolve({data:row&&fields!=='*'?Object.fromEntries(fields.split(',').map(key=>[key,row[key]])):row,error:null});},single(){return this.maybeSingle();}};}};
  const service={rpc:async(name,args)=>{calls.push({name,args});throw Error('No mutations expected');},orderById:async()=>({id:oid,match_id:mid,shooter_id:'someone-else',status:'open',provider_id:'tr_verified'}),sync:async(...args)=>{calls.push({sync:args});if(options.badPayment)throw Error('betaling_verificatie_mislukt');return {status:'paid'};}};
  const env=options.ready?{MOLLIE_CLIENT_ID:'app_fixture',MOLLIE_CLIENT_SECRET:'fixture',EPP_PAYMENT_ENCRYPTION_KEY:'a'.repeat(64)}:{};
  vm.runInNewContext(stripTypeScriptTypes(source),{Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn;}},configured,publicOrder,serviceClient:()=>db,paymentService:()=>service,requireAccount:async()=>actor,json:(data,status=200)=>Response.json(data,{status}),corsHeaders:{},URL,URLSearchParams,Response,crypto,sha256Hex:async value=>value});
  const request=new Request('https://example.supabase.co/functions/v1/epp-payments'+(options.query||''),{method:'POST',body:options.raw||JSON.stringify({clubId:actor.club_code,matchId:mid,...body})});
  const response=await handler(request);return {status:response.status,data:await response.json(),calls};
}
test('club admin sees safe own-account setup and the unconfigured gate',async()=>{
  const r=await run(admin,{action:'settings'});assert.equal(r.status,200);assert.equal(r.data.configured,false);assert.equal(r.data.enabled,false);assert.equal(r.data.account.organization_id,'org_apgs');assert.equal(r.data.account.credentials,undefined);assert.ok(!JSON.stringify(r.data).includes('NEVER_RETURN'));
});
test('head admin can inspect a different organizing club',async()=>{
  const r=await run({...admin,club_code:'eppnationaal',is_platform_admin:true},{action:'settings'});assert.equal(r.status,200);assert.equal(r.data.ownerClub,'apgs');
});
for(const action of ['settings','connect','configure','profiles','select_profile','retry_review'])test('other club cannot '+action,async()=>{
  const r=await run({...admin,club_code:'svbb'},{action},{ready:true});assert.equal(r.status,401);assert.equal(r.calls.length,0);
});
test('no checkout or activation is possible before central configuration',async()=>{
  for(const action of ['checkout','configure']){const r=await run(admin,{action,required:true});assert.equal(r.status,400);assert.equal(r.calls.length,0);}
});
test('a shooter cannot query someone else’s payment',async()=>{
  const r=await run({id:'member',club_code:'svbb',role:'schutter',is_admin:false},{action:'status',orderId:oid},{ready:true});assert.equal(r.status,401);assert.equal(r.calls.length,0);
});
test('forged webhook paid flag is ignored; verification failure remains retryable',async()=>{
  const r=await run(admin,{}, {ready:true,query:'?route=webhook&order='+oid,raw:'id=tr_untrusted&status=paid',badPayment:true});assert.equal(r.status,503);assert.equal(r.calls.length,1);assert.equal(r.calls[0].sync[1],'tr_untrusted');
});
test('reconciliation requires its own server credential',async()=>{
  const r=await run(admin,{}, {ready:true,query:'?route=reconcile'});assert.equal(r.status,401);assert.equal(r.calls.length,0);
});
