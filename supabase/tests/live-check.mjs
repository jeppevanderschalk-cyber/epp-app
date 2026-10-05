import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('/private/tmp/epp-target-public.json','utf8'));
let token='';
async function call(fn,body,expectedStatus=200){
  const response=await fetch(config.url+'/functions/v1/'+fn,{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({...body,sessionToken:token}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();
  assert.equal(response.status,expectedStatus,JSON.stringify({error:result.error,status:response.status}));
  return result;
}
const login=await call('epp-auth',{action:'login',clubId:'mercurius75',username:'beheer',password:process.env.EPP_TEST_PASSWORD});
assert.equal(login.account.role,'trainer');
token=login.sessionToken;
try{
  const session=await call('epp-auth',{action:'session',clubId:'mercurius75'});
  assert.equal(session.account.clubId,'mercurius75');
  await call('epp-training',{action:'load',clubId:'mercurius75'});
  await call('epp-training',{action:'save',clubId:'mercurius75',ops:[]});
  const matches=await call('epp-admin',{action:'list_matches',clubId:'mercurius75'});
  assert.equal(matches.matches.length,2);
  await call('epp-platform',{action:'context',clubId:'mercurius75'});
  await call('epp-training',{action:'load',clubId:'svbb'},401);
  const validToken=token;token='';
  await call('epp-training',{action:'save',clubId:'mercurius75',ops:[]},401);
  token=validToken;
  await call('epp-auth',{action:'logout',clubId:'mercurius75'});
  await call('epp-training',{action:'load',clubId:'mercurius75'},401);
  console.log('PASS real login, session, own-club load, empty save, calendar, ranking context, club isolation, anonymous denial and logout');
}finally{
  if(token)await call('epp-auth',{action:'logout',clubId:'mercurius75'},200).catch(()=>{});
}
