import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=(await readFile(new URL('../functions/epp-planner/index.ts',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
async function request(actor,overrides={},rpcError=null){
  let handler;const calls=[];
  const db={from(table){return {select(){return this;},eq(){return this;},single:async()=>({data:{id:'match',club_id:'svbb'},error:null}),maybeSingle:async()=>({data:{match_id:'match',owner_club:'svbb'},error:null})};},rpc:async(name,args)=>{calls.push({name,args});return {data:{id:'slot',blocked:args.p_blocked},error:rpcError};}};
  vm.runInNewContext(stripTypeScriptTypes(source),{Deno:{serve(fn){handler=fn;}},requireAccount:async()=>actor,serviceClient:()=>db,json:(body,status=200)=>({body,status})});
  const response=await handler({method:'POST',json:async()=>({action:'set_slot_block',matchId:'match',slotId:'slot',blocked:true,expectedRevision:0,...overrides})});
  return {response,calls};
}
const admin={id:'admin',role:'trainer',is_admin:true,club_code:'svbb'};
for(const [name,actor] of [['own club',admin],['head admin',{...admin,club_code:'eppnationaal',is_platform_admin:true}]])test(name+' can block and unblock',async()=>{
  for(const blocked of [true,false]){
    const {response,calls}=await request(actor,{blocked});assert.equal(response.status,200);
    assert.equal(calls.length,1);assert.equal(calls[0].name,'epp_planner_set_slot_block');
    assert.equal(calls[0].args.p_actor,actor.id);assert.equal(calls[0].args.p_blocked,blocked);assert.equal(calls[0].args.p_slot,'slot');assert.equal(calls[0].args.p_expected,0);
  }
});
for(const [name,actor] of [['other club',{...admin,club_code:'gast'}],['member',{...admin,role:'schutter',is_admin:false}],['trainer without admin',{...admin,is_admin:false}]])test(name+' cannot change blocks',async()=>{
  const {response,calls}=await request(actor);assert.equal(response.status,401);assert.equal(response.body.error,'geen_beheerrechten');assert.equal(calls.length,0);
});
for(const overrides of [{blocked:'true'},{blocked:null},{expectedRevision:-1},{expectedRevision:0.5},{expectedRevision:'0'}])test('invalid input '+JSON.stringify(overrides),async()=>{
  const {response,calls}=await request(admin,overrides);assert.equal(response.status,400);assert.equal(calls.length,0);
});
test('database conflict reaches the UI',async()=>{
  const {response}=await request(admin,{},new Error('tijdslot_conflict'));assert.equal(response.status,400);assert.equal(response.body.error,'tijdslot_conflict');
});
