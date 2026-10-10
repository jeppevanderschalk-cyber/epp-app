import { serviceClient, sha256Hex } from './epp.ts';

export async function requireAccount(body: any, trainer = false, registration = false) {
  if (typeof body?.sessionToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.sessionToken)) throw new Error('sessie_verlopen');
  const db = serviceClient();
  const { data: session, error } = await db.from('app_sessions').select('account_id,expires_at').eq('token_hash',await sha256Hex(body.sessionToken)).maybeSingle();
  if (error) throw error;
  if (!session || Date.parse(session.expires_at)<=Date.now()) throw new Error('sessie_verlopen');
  const { data: account, error: accountError } = await db.from('app_accounts').select('id,club_code,username,display_name,role,is_admin,is_platform_admin,must_change_password,active,membership_approved').eq('id',session.account_id).maybeSingle();
  if (accountError) throw accountError;
  if (!account?.active || account.club_code!==body.clubId) throw new Error('geen_toegang');
  if(account.membership_approved===false)throw new Error('vereniging_goedkeuring_nodig');
  if (account.username==='kijker' && !(registration && account.role==='schutter' && ['session','register_member','logout'].includes(body.action))) throw new Error('persoonlijk_account_verplicht');
  if(account.must_change_password&&!['session','change_password','logout'].includes(body.action))throw new Error('wachtwoord_wijzigen_verplicht');
  if (trainer && account.role!=='trainer') throw new Error('geen_schrijfrechten');
  return account;
}

export async function createSession(db: any, account: any) {
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const expiresAt=new Date(Date.now()+8*60*60*1000).toISOString();
  const { error }=await db.from('app_sessions').insert({token_hash:await sha256Hex(token),account_id:account.id,expires_at:expiresAt});
  if(error)throw error;
  return {sessionToken:token,expiresAt,account:{id:account.id,username:account.username,displayName:account.display_name,role:account.role,clubId:account.club_code,isAdmin:account.is_admin,isPlatformAdmin:account.is_platform_admin===true,mustChangePassword:account.must_change_password===true}};
}
