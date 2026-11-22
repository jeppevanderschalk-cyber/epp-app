import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=(await readFile(new URL('../functions/epp-teams/index.ts',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
async function request(body,error=null){
  let handler;const calls=[];const actor={id:'verified-member',role:'schutter',is_admin:false};
  const db={rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true},error};}};
  vm.runInNewContext(stripTypeScriptTypes(source),{Deno:{serve(fn){handler=fn;}},requireAccount:async()=>actor,serviceClient:()=>db,json:(body,status=200)=>({body,status})});
  return {response:await handler({method:'POST',json:async()=>body}),calls};
}
test('a team member uses the verified actor and revision to save four selected shooters',async()=>{
  const {response,calls}=await request({action:'save_group_lineup',actorId:'forged',groupId:'group',matchId:'match',discipline:'optiek',members:['a','b','c','d'],expectedRevision:3});
  assert.equal(response.status,200);assert.equal(calls.length,1);assert.equal(calls[0].name,'epp_team_group_lineup_save');
  assert.equal(calls[0].args.p_actor,'verified-member');assert.equal(calls[0].args.p_group,'group');assert.deepEqual(calls[0].args.p_members,['a','b','c','d']);assert.equal(calls[0].args.p_expected,3);assert.equal(calls[0].args.p_delete,false);
});
test('deleting a group lineup uses the same database authorization',async()=>{
  const {response,calls}=await request({action:'delete_group_lineup',groupId:'group',matchId:'match',expectedRevision:2},new Error('geen_beheerrechten'));assert.equal(response.status,401);assert.equal(calls[0].args.p_delete,true);assert.equal(response.body.error,'geen_beheerrechten');
});
test('only the database may grant permission to link a pending profile',async()=>{
  const {response,calls}=await request({action:'link_group_member',groupId:'group',memberId:'pending',shooterId:'shooter',expectedRevision:1},new Error('geen_beheerrechten'));assert.equal(response.status,401);assert.equal(calls[0].name,'epp_team_group_link');assert.equal(calls[0].args.p_actor,'verified-member');
});
for(const message of ['team_conflict','team_vast_na_score','vier_unieke_schutters_verplicht','schutter_al_in_team'])test('database failure is preserved: '+message,async()=>{
 const {response}=await request({action:'save_group_lineup',groupId:'group',matchId:'match'},new Error(message));assert.equal(response.status,400);assert.equal(response.body.error,message);
});
