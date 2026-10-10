import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
// Explicit smoke test before the owner's complete account reset; do not run in CI.
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const key=html.match(/var key='([^']+)'/)[1];
const email='reset-smoke-'+randomUUID()+'@example.invalid',password=randomUUID()+randomUUID();
const call=async body=>{
  const response=await fetch('https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/epp-auth',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({clubId:'svbb',...body})});
  return response.json();
};
const created=await call({action:'register_member',registrationClubId:'svbb',firstName:'Reset',lastName:'Verificatietest',email,newPassword:password});
assert.equal(created.ok,true);assert.equal(created.pendingApproval,true);
const pending=await call({action:'login',email,password});
assert.equal(pending.error,'vereniging_goedkeuring_nodig');
execFileSync('supabase',['db','query','--linked',`select epp_approve_member((select id from app_accounts where username='hoofdbeheer' and is_platform_admin),(select id from app_accounts where email='${email}'));`],{stdio:'pipe'});
for(const identity of [{email},{firstName:'Reset',lastName:'Verificatietest'}]){
  const result=await call({action:'login',...identity,password});
  assert.equal(result.ok,true);assert.equal(result.account.clubId,'svbb');assert.equal(result.account.isAdmin,false);
  assert.equal((await call({action:'logout',sessionToken:result.sessionToken})).ok,true);
}
console.log('PASS live: public registration, pending denial, head approval, email login and name login. Test account will be removed by the requested reset.');
