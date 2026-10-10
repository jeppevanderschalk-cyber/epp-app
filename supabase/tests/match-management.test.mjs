import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {resolve} from 'node:path';
const root=process.env.EPP_TEST_ROOT||resolve(import.meta.dirname,'../..');
for(const platform of [false,true])for(const action of ['list_matches','list_archived_matches','group_list','update_match'])test(`${action}: ${platform?'head can manage other clubs':'club admin stays scoped'}`,async()=>{
 const filters=[];let handler;
 const query={select(){return this;},eq(key,value){filters.push([key,value]);return this;},is(){return this;},not(){return this;},order(){return this;},in(){return this;},update(){return this;},single(){return Promise.resolve({data:{id:'match'},error:null});},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};
 const context={Deno:{serve(fn){handler=fn;}},Response,requireAccount:async()=>({is_admin:true,is_platform_admin:platform}),serviceClient:()=>({from:()=>query}),json:(body,status=200)=>({body,status}),isKnownClub:()=>true,matchDates:dates=>dates,DISCIPLINES:['pistool'],corsHeaders:{}};
 const source=(await readFile(root+'/supabase/functions/epp-admin/index.ts','utf8')).replace(/^import .*;$/gm,'');
 vm.runInNewContext(stripTypeScriptTypes(source),context);
 const result=await handler({method:'POST',json:async()=>({clubId:'eppnationaal',action,id:'match',matchId:'match',match:{organizer:'Changed'}})});
 assert.equal(result.status,200);assert.equal(result.body.ok,true);
 assert.equal(filters.some(([key])=>key==='club_id'),!platform);
 if(!platform)assert.ok(filters.some(([key,value])=>key==='club_id'&&value==='eppnationaal'));
});

for(const action of ['list_matches','list_archived_matches'])for(const platform of [true,false])test(`${action}: per-club legacy copies stay separate from shared planner events (${platform?'head':'club'})`,async()=>{
 const actor={is_admin:true,is_platform_admin:platform,club_code:platform?'eppnationaal':'svbb'};
 const matches=['eppnationaal','svbb','gast','mercurius75'].flatMap(club_id=>['Amsterdam','Druten'].map(organizer=>({id:club_id+'-'+organizer,club_id,organizer})));
 matches.push({id:'shared-svbb',club_id:'svbb',organizer:'SV Beemte Broekland'});
 let handler;
 const db={from(table){const filters=[];return {select(){return this;},eq(key,value){filters.push([key,value]);return this;},is(){return this;},not(){return this;},order(){return this;},in(){return this;},then(resolve){const data=table==='epp_matches'?matches.filter(m=>filters.every(([key,value])=>m[key]===value)):table==='epp_match_planners'?[{match_id:'shared-svbb'}]:[];return Promise.resolve({data,error:null}).then(resolve);}};}};
 const context={Deno:{serve(fn){handler=fn;}},Response,requireAccount:async()=>actor,serviceClient:()=>db,json:(body,status=200)=>({body,status}),isKnownClub:()=>true,matchDates:dates=>dates,DISCIPLINES:['pistool'],corsHeaders:{}};
 const source=(await readFile(root+'/supabase/functions/epp-admin/index.ts','utf8')).replace(/^import .*;$/gm,'');
 vm.runInNewContext(stripTypeScriptTypes(source),context);
 const result=await handler({method:'POST',json:async()=>({clubId:actor.club_code,action})});
 assert.equal(result.status,200);assert.equal(result.body.ok,true);
 assert.deepEqual(Array.from(result.body.matches,m=>m.id),[actor.club_code+'-Amsterdam',actor.club_code+'-Druten','shared-svbb']);
 assert.equal(result.body.matches.filter(m=>m.organizer==='Amsterdam').length,1);
 assert.equal(result.body.matches.filter(m=>m.organizer==='Druten').length,1);
});
