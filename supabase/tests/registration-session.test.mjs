import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

let account={id:'shared',club_code:'svbb',username:'kijker',role:'schutter',active:true};
globalThis.registrationSessionDB={from(table){
  const query={select(){return this;},eq(){return this;},async maybeSingle(){
    return {data:table==='app_sessions'?{account_id:account.id,expires_at:'2099-01-01'}:account};
  }};
  return query;
}};
const source=(await readFile(new URL('../functions/_shared/session.ts',import.meta.url),'utf8'))
  .replace(/^import .*;\n/,'const serviceClient=()=>globalThis.registrationSessionDB; const sha256Hex=async x=>x;\n')
  .replaceAll(': any','');
const {requireAccount}=await import('data:text/javascript,'+encodeURIComponent(source));
const body={clubId:'svbb',sessionToken:'a'.repeat(64)};
for(const action of ['load','save','context','list_shooters','list_matches','catalog','view','session','register_member','logout']){
  await assert.rejects(requireAccount({...body,action}),/persoonlijk_account_verplicht/);
}
for(const action of ['session','register_member','logout']){
  assert.equal((await requireAccount({...body,action},false,true)).id,'shared');
}
for(const action of ['load','list_accounts','change_password','context']){
  await assert.rejects(requireAccount({...body,action},false,true),/persoonlijk_account_verplicht/);
}
account={...account,username:'lid.personal',club_code:'apgs'};
await assert.rejects(requireAccount({...body,action:'load'}),/geen_toegang/);
assert.equal((await requireAccount({...body,clubId:'apgs',action:'load'})).id,'shared');
await assert.rejects(requireAccount({...body,clubId:'apgs',action:'save'},true),/geen_schrijfrechten/);
delete globalThis.registrationSessionDB;
console.log('PASS shared registration sessions cannot read data; explicit onboarding only; personal club and write guards preserved');
