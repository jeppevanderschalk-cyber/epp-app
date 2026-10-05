import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const key=html.match(/var key='([^']+)'/)[1];
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const sql=query=>JSON.parse(execFileSync('supabase',['db','query','--linked',query,'--output-format','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).rows;
const token=randomBytes(32).toString('hex'),tokenHash=createHash('sha256').update(token).digest('hex');
const first='Registratiecontrole',last=randomBytes(6).toString('hex'),password=randomBytes(20).toString('hex');
let accountId,shooterId;const tokens=[token];
async function call(fn,body,sessionToken=token,status=200){
  const response=await fetch('https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/'+fn,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({...body,clubId:'svbb',sessionToken}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();assert.equal(response.status,status,result.error);return result;
}
try{
  sql("insert into app_sessions(token_hash,account_id,expires_at) select "+quote(tokenHash)+",id,now()+interval '1 hour' from app_accounts where club_code='svbb' and username='kijker' and active");
  const created=await call('epp-auth',{action:'register_member',firstName:first,lastName:last,newPassword:password,role:'trainer',isAdmin:true});
  accountId=created.account.id;tokens.push(created.sessionToken);
  assert.equal(created.account.role,'schutter');assert.equal(created.account.isAdmin,false);
  const directory=await call('epp-signup',{action:'list_shooters'},created.sessionToken);
  assert.equal(directory.shooters.length,1);shooterId=directory.shooters[0].id;
  assert.equal(directory.shooters[0].naam,first+' '+last);
  await call('epp-auth',{action:'register_member',firstName:first,lastName:last,newPassword:password},token,400);
  const logged=await call('epp-auth',{action:'login',firstName:first.toLowerCase(),lastName:last,password});tokens.push(logged.sessionToken);
  assert.equal(logged.account.id,accountId);
  await call('epp-training',{action:'save',ops:[]},logged.sessionToken,401);
  await call('epp-signup',{action:'my_signups',shooterId:'00000000-0000-4000-8000-000000000001'},logged.sessionToken,401);
  const calendar=await call('epp-signup',{action:'list_matches'},logged.sessionToken);
  const match=calendar.matches.find(m=>m.deadline>=new Date().toISOString().slice(0,10)&&m.offered_disciplines.length);
  assert(match,'No open match for registration verification');
  await call('epp-signup',{action:'save_signup',shooterId,matchId:match.id,disciplines:[{discipline:match.offered_disciplines[0],time_block:'geen_voorkeur',specific_time:null}]},logged.sessionToken);
  const mine=await call('epp-signup',{action:'my_signups',shooterId},logged.sessionToken);assert.equal(mine.signups.length,1);
  console.log('PASS real registration: name-based login, personal shooter link, own match signup, duplicate protection and no trainer access');
}finally{
  for(const t of tokens)await call('epp-auth',{action:'logout'},t).catch(()=>{});
  // Only the explicitly generated test identity is cleaned up.
  if(accountId){
    sql("begin; delete from epp_signups where shooter_id in(select id from shooters where linked_user_id="+quote(accountId)+"); delete from training_audit where actor_id="+quote(accountId)+"; delete from training_entities where club_code='svbb' and updated_by="+quote(accountId)+"; delete from memberships where shooter_id in(select id from shooters where linked_user_id="+quote(accountId)+"); delete from shooters where linked_user_id="+quote(accountId)+"; delete from app_sessions where account_id="+quote(accountId)+"; delete from app_accounts where id="+quote(accountId)+"; delete from platform_users where id="+quote(accountId)+"; commit;");
  }
  sql("delete from app_sessions where token_hash="+quote(tokenHash));
}
