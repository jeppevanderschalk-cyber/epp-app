import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=(await readFile(new URL('../functions/epp-auth/index.ts',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const member={id:'member',club_code:'apgs',username:'lid.email',login_username:'anne',active:true,legacy:false,deleted_at:null,password_salt:'salt',password_hash:'correct',membership_approved:true,role:'schutter'};
async function login(body,accounts=[member]){
 let handler;const failures=[],sessions=[];
 const db={from(){let rows=accounts.slice();const q={select(){return q;},eq(k,v){rows=rows.filter(r=>r[k]===v);return q;},is(k,v){rows=rows.filter(r=>r[k]===v);return q;},limit(n){rows=rows.slice(0,n);return q;},update(){return q;},maybeSingle:async()=>({data:rows[0],error:null}),then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve);}};return q;},rpc:async(name,args)=>{failures.push(args.p_id);return {error:null};}};
 vm.runInNewContext(stripTypeScriptTypes(source),{Deno:{serve(fn){handler=fn;}},Response,Date,corsHeaders:{},serviceClient:()=>db,isKnownClub:c=>['svbb','apgs','eppnationaal'].includes(c),emailUsername:async()=> 'lid.email',passwordHash:async p=>p,randomSalt:()=>'',checkPassword:async()=>false,createSession:async(db,a)=>{sessions.push(a.id);return {account:{clubId:a.club_code,id:a.id}};},json:(body,status=200)=>({body,status})});
 return {response:await handler({method:'POST',json:async()=>({action:'login',username:'anne',password:'correct',autoClub:true,...body})}),failures,sessions};
}
test('personal login discovers actual club despite stale or missing browser club',async()=>{for(const clubId of [undefined,'svbb']){const r=await login({clubId});assert.equal(r.response.status,200);assert.equal(r.response.body.account.clubId,'apgs');}});
test('email login discovers club',async()=>assert.equal((await login({email:'anne@example.nl',username:undefined})).response.status,200));
test('duplicate username requires explicit club; scoped retry selects that club',async()=>{const accounts=[member,{...member,id:'other',club_code:'svbb'}];assert.equal((await login({},accounts)).response.body.error,'vereniging_kiezen_nodig');const r=await login({autoClub:false,clubId:'svbb'},accounts);assert.equal(r.response.body.account.id,'other');});
test('wrong password, locked, pending, inactive and deleted accounts remain protected',async()=>{
 const wrong=await login({password:'wrong'});assert.equal(wrong.response.status,401);assert.deepEqual(wrong.failures,['member']);assert.deepEqual(wrong.sessions,[]);
 for(const change of [{locked_until:'2099-01-01'},{active:false},{deleted_at:'2026-01-01'}])assert.equal((await login({},[{...member,...change}])).response.status,401);
 assert.equal((await login({},[{...member,membership_approved:false}])).response.status,403);
});
test('automatic lookup never accepts shared or head account identifiers',async()=>{for(const username of ['beheer','kijker','hoofdbeheer','trainer','lid.fake','removed.fake'])assert.equal((await login({username})).response.status,401);});
test('explicit head login retains role and platform restrictions',async()=>{const head={...member,id:'head',club_code:'eppnationaal',username:'hoofdbeheer',role:'trainer',is_admin:true,is_platform_admin:true};assert.equal((await login({autoClub:false,clubId:'eppnationaal',username:'hoofdbeheer'},[head])).response.status,200);assert.equal((await login({autoClub:false,clubId:'eppnationaal',username:'hoofdbeheer'},[{...head,is_platform_admin:false}])).response.status,401);});
