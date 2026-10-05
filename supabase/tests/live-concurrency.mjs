import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,randomUUID,pbkdf2Sync} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const config=JSON.parse(await readFile('/private/tmp/epp-target-public.json','utf8'));
const id=randomUUID(),sid=randomUUID(),roundA=randomUUID(),roundB=randomUUID();
const accounts=[];
const tokens=[];
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const sql=query=>JSON.parse(execFileSync('supabase',['db','query','--linked',query,'--output-format','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).rows;
async function call(fn,body,token='',status=200){
  const response=await fetch(config.url+'/functions/v1/'+fn,{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({...body,clubId:'gast',sessionToken:token}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();
  assert.equal(response.status,status,JSON.stringify({error:result.error,status:response.status}));
  return result;
}
const base={trainingId:id,sid,type:'parcours',score:210,ts:1};
try{
  for(const role of ['trainer','trainer','schutter']){
    const username='livecheck-'+randomBytes(6).toString('hex'),password=randomBytes(20).toString('hex'),salt=randomBytes(24).toString('hex');
    const hash=pbkdf2Sync(password,Buffer.from(salt,'hex'),600000,32,'sha256').toString('hex');
    // Test identities are confined to Gast; no existing account is changed.
    const a=sql("insert into app_accounts(club_code,username,display_name,role,password_salt,password_hash) values('gast',"+quote(username)+",'Tijdelijke opslagcontrole',"+quote(role)+","+quote(salt)+","+quote(hash)+") returning id")[0].id;
    accounts.push(a);
    sql("insert into platform_users(id,auth_provider_id) values("+quote(a)+","+quote('livecheck:'+a)+")");
    const login=await call('epp-auth',{action:'login',username,password});
    tokens.push(login.sessionToken);
  }
  await call('epp-platform',{action:'register_shooter',shooterId:sid,shooterName:'Tijdelijke opslagcontrole'},tokens[0]);
  const dataA={...base,id:roundA},dataB={...base,id:roundB,score:220};
  await Promise.all([
    call('epp-training',{action:'save',ops:[{kind:'round',id:roundA,expected:null,value:dataA}]},tokens[0]),
    call('epp-training',{action:'save',ops:[{kind:'round',id:roundB,expected:null,value:dataB}]},tokens[1])
  ]);
  const loaded=await call('epp-training',{action:'load'},tokens[2]);
  assert(loaded.entities.some(e=>e.id===roundA&&e.data.score===210));
  assert(loaded.entities.some(e=>e.id===roundB&&e.data.score===220));
  await call('epp-training',{action:'save',ops:[]},tokens[2],401);
  const correction=async(token,score)=>{
    const response=await fetch(config.url+'/functions/v1/epp-training',{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+config.anonKey,'Content-Type':'application/json'},body:JSON.stringify({clubId:'gast',sessionToken:token,action:'save',ops:[{kind:'round',id:roundA,expected:dataA,value:{...dataA,score}}]})});
    return response.status;
  };
  assert.deepEqual((await Promise.all([correction(tokens[0],230),correction(tokens[1],240)])).sort(),[200,409]);
  console.log('PASS real concurrent trainers: both rounds retained, viewer read-only, conflicting correction rejected');
}finally{
  for(const token of tokens)await call('epp-auth',{action:'logout'},token).catch(()=>{});
  if(accounts.length){
    const ids=accounts.map(quote).join(',');
    sql("begin; delete from training_audit where actor_id in ("+ids+"); delete from training_entities where club_code='gast' and entity_id in ("+[sid,roundA,roundB].map(quote).join(',')+"); delete from memberships where shooter_id="+quote(sid)+"; delete from shooters where id="+quote(sid)+"; delete from app_sessions where account_id in ("+ids+"); delete from app_accounts where id in ("+ids+"); delete from platform_users where id in ("+ids+"); commit;");
  }
}
