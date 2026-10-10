import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const access=(await readFile(new URL('../functions/epp-head-view/access.ts',import.meta.url),'utf8')).replace(': any','').replace(': string','');
const {requireHeadViewer}=await import('data:text/javascript,'+encodeURIComponent(access));
const head={id:'head',club_code:'eppnationaal',active:true,role:'trainer',is_admin:true,is_platform_admin:true,must_change_password:false};
const calls=[];
globalThis.__headViewRuntime={
  corsHeaders:{},requireHeadViewer,
  json:(body,status=200)=>new Response(JSON.stringify(body),{status}),
  requireAccount:async body=>{if(body.clubId!=='eppnationaal')throw Error('geen_toegang');return body.sessionToken==='head'?head:{...head,is_platform_admin:false};},
  serviceClient:()=>({from:table=>{
    const filters={},query={
      select:columns=>{calls.push({table,columns,filters});return query;},
      eq:(key,value)=>{filters[key]=value;return query;},
      lte:()=>query,order:()=>query,
      maybeSingle:async()=>({data:filters.code==='dekorrel'?{id:'club-id',code:'dekorrel',naam:'De Korrel'}:null}),
      range:async(offset,end)=>{
        if(table==='clubs')return {data:[{code:'dekorrel',naam:'De Korrel'}]};
        if(table==='training_entities'){assert.equal(filters.club_code,'dekorrel');return {data:Array.from({length:offset===0?1000:1},(_,i)=>({kind:'round',entity_id:String(i+offset),data:{score:100}}))};}
        if(table==='shooter_qualifications'){assert.equal(filters['shooter.memberships.club_id'],'club-id');return {data:[]};}
        throw Error('Unexpected table '+table);
      }
    };
    for(const operation of ['insert','update','delete','upsert','rpc'])query[operation]=()=>{throw Error('Mutation attempted');};
    return query;
  }}),
  Deno:{serve:handler=>globalThis.headViewHandler=handler}
};
const code=(await readFile(new URL('../functions/epp-head-view/index.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('query: () => any','query').replace('rows:any[]','rows');
await import('data:text/javascript,'+encodeURIComponent('const {corsHeaders,json,serviceClient,requireAccount,requireHeadViewer,Deno}=globalThis.__headViewRuntime;\n'+code));
async function request(body){const response=await headViewHandler(new Request('https://test',{method:'POST',body:JSON.stringify({clubId:'eppnationaal',sessionToken:'head',...body})}));return {status:response.status,data:await response.json()};}
const view=await request({action:'view',targetClubId:'dekorrel'});
assert.equal(view.status,200);assert.equal(view.data.readOnly,true);assert.equal(view.data.club.code,'dekorrel');assert.equal(view.data.entities.length,1001);
assert.equal((await request({action:'catalog'})).status,200);
assert.equal((await request({action:'save',targetClubId:'dekorrel'})).status,403);
assert.equal((await request({action:'view',targetClubId:'dekorrel',sessionToken:'ordinary'})).status,403);
assert.equal((await request({action:'view',targetClubId:'dekorrel',clubId:'dekorrel'})).status,403);
assert.equal((await request({action:'view',targetClubId:'missing'})).status,400);
assert.ok(calls.every(c=>!c.columns.includes('password')));
console.log('PASS head view handler: selected-club queries, >1000 records, authorization failures, unknown club, no write path');
