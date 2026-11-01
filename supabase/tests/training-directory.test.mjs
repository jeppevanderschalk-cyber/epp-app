import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=(await readFile(new URL('../functions/epp-training/index.ts',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const accounts=[
 {id:'own',club_code:'svbb',active:true,membership_approved:true,deleted_at:null,username:'lid.own'},
 {id:'foreign',club_code:'apgs',active:true,membership_approved:true,deleted_at:null,username:'lid.foreign'},
 {id:'pending',club_code:'svbb',active:true,membership_approved:false,deleted_at:null,username:'lid.pending'},
 {id:'inactive',club_code:'svbb',active:false,membership_approved:true,deleted_at:null,username:'lid.inactive'},
 {id:'viewer',club_code:'svbb',active:true,membership_approved:true,deleted_at:null,username:'kijker'},
 {id:'deleted',club_code:'svbb',active:true,membership_approved:true,deleted_at:'2026-01-01',username:'lid.deleted'}
];
async function run(actor,body){
 let handler;const writes=[];
 const tables={app_accounts:accounts,shooters:accounts.map(a=>({id:'shooter-'+a.id,linked_user_id:a.id,display_name:a.id}))};
 const db={from(table){let data=tables[table]||[];const q={select(){return q;},eq(k,v){data=data.filter(r=>r[k]===v);return q;},neq(k,v){data=data.filter(r=>r[k]!==v);return q;},is(k,v){data=data.filter(r=>r[k]===v);return q;},in(k,values){data=data.filter(r=>values.includes(r[k]));return q;},order(){return q;},then(resolve){return Promise.resolve({data,error:null}).then(resolve);},range:async(a,b)=>({data:data.slice(a,b+1),error:null}),single:async()=>({data:data[0],error:null})};return q;},rpc:async(...args)=>{writes.push(args);return {data:{ok:true,entities:[]},error:null};}};
 vm.runInNewContext(stripTypeScriptTypes(source),{Deno:{serve(fn){handler=fn;}},Response,corsHeaders:{},requireAccount:async()=>actor,serviceClient:()=>db,json:(body,status=200)=>({body,status})});
 const response=await handler({method:'POST',json:async()=>body});return {...response,writes};
}
const actor={id:'own',role:'trainer',club_code:'svbb',is_admin:true,is_platform_admin:false};
test('club administrator sees all approved own-club profiles; body cannot expand scope',async()=>{
 const r=await run(actor,{action:'list_registered_shooters',clubId:'svbb',targetClubId:'apgs'});
 assert.equal(r.status,200);assert.deepEqual(Array.from(r.body.shooters,s=>s.id),['shooter-own']);
});
test('head administrator sees approved profiles across clubs',async()=>{
 const r=await run({...actor,is_platform_admin:true},{action:'list_registered_shooters'});
 assert.equal(r.status,200);assert.deepEqual(Array.from(r.body.shooters,s=>s.id).sort(),['shooter-foreign','shooter-own']);
});
test('personal shooter cannot request the club directory',async()=>{
 const r=await run({...actor,role:'schutter',is_admin:false},{action:'list_registered_shooters'});
 assert.equal(r.status,401);assert.equal(r.body.error,'geen_schrijfrechten');
});
test('foreign profile cannot be added to the club training by forging a selection',async()=>{
 const r=await run(actor,{action:'save',ops:[{kind:'shooter',id:'shooter-foreign',value:{id:'shooter-foreign',naam:'foreign'}}]});
 assert.equal(r.status,400);assert.equal(r.body.error,'persoonlijk_account_verplicht');assert.equal(r.writes.length,0);
});
