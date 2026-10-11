import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=(await readFile(new URL('../functions/epp-training/index.ts',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
for(const role of ['schutter','trainer'])for(const action of ['load','save'])test(`${role} ${action}: training scope is selected by authenticated account`,async()=>{
 let handler;const filters=[],calls=[];
 const query={select(){return this;},eq(k,v){filters.push([k,v]);return this;},order(){return this;},single:async()=>({data:{id:'own-shooter',display_name:'Full Name'},error:null}),range:async()=>({data:[],error:null})};
 const db={from(table){calls.push(table);return query;},rpc:async(name,args)=>{calls.push(name);assert.equal(args.p_actor,'verified-account');return {data:{ok:true,entities:[]},error:null};}};
 const context={Deno:{serve(fn){handler=fn;}},Response,corsHeaders:{},requireAccount:async()=>({id:'verified-account',club_code:'svbb',role}),serviceClient:()=>db,json:(body,status=200)=>({body,status})};
 vm.runInNewContext(stripTypeScriptTypes(source),context);
 const r=await handler({method:'POST',json:async()=>({clubId:'svbb',action,accountId:'foreign-account',ops:[]})});
 assert.equal(r.status,200);
 if(role==='schutter'){
  assert.ok(filters.some(([k,v])=>k==='linked_user_id'&&v==='verified-account'));
  assert.equal(r.body.entities[0].data.naam,'Full Name');
  assert.ok(action==='save'?calls.includes('epp_personal_training_apply'):filters.some(([k,v])=>k==='account_id'&&v==='verified-account'));
  assert.ok(!calls.includes('training_entities'));
 }else assert.ok(action==='save'?calls.includes('epp_training_apply'):calls.includes('training_entities'));
});
