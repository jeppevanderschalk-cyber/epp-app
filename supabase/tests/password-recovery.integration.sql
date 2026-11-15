-- Run together with the migration (without its COMMIT). Everything rolls back.
do $$
declare aid uuid; admin_id uuid; outsider uuid; target uuid; n integer; denied boolean;
begin
  insert into app_accounts(club_code,username,display_name,role,email,password_salt,password_hash,active,membership_approved)
  values('svbb','reset.integration.member','Reset test','schutter','reset.integration@example.invalid',repeat('b',48),repeat('c',64),true,true) returning id into aid;
  insert into app_accounts(club_code,username,display_name,role,is_admin,password_salt,password_hash)
  values('svbb','reset.integration.admin','Reset beheer','trainer',true,repeat('b',48),repeat('c',64)) returning id into admin_id;
  insert into app_accounts(club_code,username,display_name,role,is_admin,password_salt,password_hash)
  values('mercurius75','reset.integration.outside','Reset ander','trainer',true,repeat('b',48),repeat('c',64)) returning id into outsider;
  select count(*) into n from epp_request_password_reset('reset.integration@example.invalid','svbb',repeat('a',64),'integration-ip');
  if n<>1 then raise exception 'request_missing';end if;
  select count(*) into n from epp_request_password_reset('reset.integration@example.invalid','svbb',repeat('d',64),'integration-ip');
  if n<>0 then raise exception 'cooldown_missing';end if;
  insert into app_sessions(token_hash,account_id,expires_at) values(repeat('e',64),aid,now()+interval '1 hour');
  perform epp_complete_password_reset(repeat('a',64),repeat('f',48),repeat('1',64));
  if exists(select 1 from app_sessions where account_id=aid) then raise exception 'old_session_survives';end if;
  if not exists(select 1 from app_accounts where id=aid and password_hash=repeat('1',64) and not must_change_password) then raise exception 'password_not_changed';end if;
  denied:=false;begin perform epp_complete_password_reset(repeat('a',64),repeat('f',48),repeat('2',64));exception when others then if sqlerrm='resetlink_ongeldig' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'replay_allowed';end if;
  perform epp_request_password_reset('reset.integration@example.invalid','svbb',repeat('3',64),'integration-ip');
  update epp_password_resets set expires_at=now()-interval '1 second' where token_hash=repeat('3',64);
  denied:=false;begin perform epp_complete_password_reset(repeat('3',64),repeat('f',48),repeat('2',64));exception when others then if sqlerrm='resetlink_ongeldig' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'expired_allowed';end if;
  delete from epp_password_resets where account_id=aid;
  perform epp_request_password_reset('reset.integration@example.invalid','svbb',repeat('4',64),'integration-ip');
  update app_accounts set password_hash=repeat('5',64) where id=aid;
  denied:=false;begin perform epp_complete_password_reset(repeat('4',64),repeat('f',48),repeat('2',64));exception when others then if sqlerrm='resetlink_ongeldig' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'changed_password_link_allowed';end if;
  denied:=false;begin perform epp_admin_reset_password(outsider,aid,repeat('f',48),repeat('6',64));exception when others then if sqlerrm='geen_beheerrechten' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'cross_club_reset_allowed';end if;
  denied:=false;begin perform epp_admin_reset_password(aid,admin_id,repeat('f',48),repeat('6',64));exception when others then if sqlerrm='geen_beheerrechten' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'member_can_reset';end if;
  perform epp_admin_reset_password(admin_id,aid,repeat('f',48),repeat('6',64));
  if not exists(select 1 from app_accounts where id=aid and password_hash=repeat('6',64) and must_change_password) then raise exception 'temporary_password_not_forced';end if;
  if exists(select 1 from epp_password_resets where account_id=aid) then raise exception 'admin_reset_link_survives';end if;
  if not exists(select 1 from epp_access_audit where actor_id=admin_id and target_id=aid and after_data->>'password_reset'='true') then raise exception 'audit_missing';end if;
  perform epp_request_password_reset('reset.integration@example.invalid','svbb',repeat('7',64),'integration-ip');
  delete from epp_password_resets where account_id=aid;
  select count(*) into n from epp_request_password_reset('reset.integration@example.invalid','svbb',repeat('8',64),'integration-ip');
  if n<>0 then raise exception 'email_rate_limit_missing';end if;
  if has_table_privilege('anon','epp_password_resets','SELECT') or has_function_privilege('authenticated','epp_complete_password_reset(text,text,text)','EXECUTE') then raise exception 'recovery_public';end if;
end $$;
select 'PASS reset issuance, cooldown, redemption, expiry, password changes, sessions, permissions, forced change, audit and rate limits' as result;
rollback;
