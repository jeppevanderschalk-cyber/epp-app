-- Append to the migration without COMMIT. This test ends with ROLLBACK.
do $$
declare member_id uuid; manager_id uuid; other_id uuid; head_id uuid; other_member uuid; req uuid; n integer; denied boolean;
begin
  insert into app_accounts(club_code,username,login_username,display_name,role,email,password_salt,password_hash,membership_approved)
  values('svbb','help.integration.member','help.test.member','Help Lid','schutter','help.integration@example.invalid',repeat('b',48),repeat('c',64),true) returning id into member_id;
  insert into app_accounts(club_code,username,display_name,role,is_admin,password_salt,password_hash,membership_approved)
  values('svbb','help.integration.admin','Help Beheer','trainer',true,repeat('b',48),repeat('c',64),true) returning id into manager_id;
  insert into app_accounts(club_code,username,display_name,role,is_admin,password_salt,password_hash,membership_approved)
  values('mercurius75','help.integration.outside','Help Ander','trainer',true,repeat('b',48),repeat('c',64),true) returning id into other_id;
  insert into app_accounts(club_code,username,display_name,role,is_admin,is_platform_admin,password_salt,password_hash,membership_approved)
  values('eppnationaal','help.integration.head','Help Hoofd','trainer',true,true,repeat('b',48),repeat('c',64),true) returning id into head_id;
  insert into app_accounts(club_code,username,display_name,role,password_salt,password_hash,membership_approved)
  values('mercurius75','help.integration.othermember','Help Ander Lid','schutter',repeat('b',48),repeat('c',64),true) returning id into other_member;
  perform epp_request_password_help(' HELP.TEST.MEMBER ','svbb','help-integration-ip');
  perform epp_request_password_help('help.integration@example.invalid','svbb','help-integration-ip');
  if (select count(*) from epp_password_help_requests where account_id=member_id and handled_at is null)<>1 then raise exception 'request_not_deduplicated';end if;
  if not exists(select 1 from app_accounts where id=member_id and password_hash=repeat('c',64) and not must_change_password) then raise exception 'request_changes_password';end if;
  perform epp_request_password_help('help.integration.admin','svbb','help-integration-ip');
  perform epp_request_password_help('help.integration.othermember','mercurius75','help-integration-ip');
  perform epp_request_password_help('unknown.help.integration','svbb','help-integration-ip');
  perform epp_request_password_help('help.test.member','mercurius75','help-integration-ip');
  perform epp_request_password_help('help.integration.head','eppnationaal','help-integration-ip');
  if (select count(*) from epp_password_help_requests where account_id in(member_id,manager_id,other_member,head_id))<>3 then raise exception 'unknown_or_protected_request_created';end if;
  select count(*) into n from epp_list_password_help(manager_id) where account_id in(member_id,manager_id,other_member);
  if n<>1 then raise exception 'club_scope_failed';end if;
  select count(*) into n from epp_list_password_help(head_id) where account_id in(member_id,manager_id,other_member);
  if n<>3 then raise exception 'head_scope_failed';end if;
  denied:=false;begin perform epp_list_password_help(member_id);exception when others then if sqlerrm='geen_beheerrechten' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'member_reads_help';end if;
  select id into req from epp_password_help_requests where account_id=member_id and handled_at is null;
  denied:=false;begin perform epp_resolve_password_help(other_id,req,repeat('e',48),repeat('f',64));exception when others then if sqlerrm='geen_beheerrechten' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'other_club_resolves';end if;
  insert into app_sessions(token_hash,account_id,expires_at) values(repeat('9',64),member_id,now()+interval '1 hour');
  perform epp_resolve_password_help(manager_id,req,repeat('e',48),repeat('f',64));
  if not exists(select 1 from app_accounts where id=member_id and must_change_password and password_hash=repeat('f',64)) then raise exception 'temporary_password_not_forced';end if;
  if exists(select 1 from app_sessions where account_id=member_id) then raise exception 'sessions_not_revoked';end if;
  if not exists(select 1 from epp_password_help_requests where id=req and handled_at is not null and handled_by=manager_id) then raise exception 'request_not_closed';end if;
  if exists(select 1 from epp_list_password_help(manager_id) where id=req) then raise exception 'closed_request_listed';end if;
  denied:=false;begin perform epp_resolve_password_help(manager_id,req,repeat('e',48),repeat('1',64));exception when others then if sqlerrm='herstelverzoek_afgehandeld' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'resolved_twice';end if;
  perform epp_request_password_help('help.test.member','svbb','help-integration-ip');
  if (select count(*) from epp_password_help_requests where account_id=member_id and handled_at is null)<>1 then raise exception 'new_request_missing';end if;
  perform epp_admin_reset_password(manager_id,member_id,repeat('e',48),repeat('2',64));
  if exists(select 1 from epp_password_help_requests where account_id=member_id and handled_at is null) then raise exception 'manual_reset_does_not_close';end if;
  select id into req from epp_password_help_requests where account_id=manager_id and handled_at is null;
  denied:=false;begin perform epp_resolve_password_help(other_id,req,repeat('e',48),repeat('3',64));exception when others then if sqlerrm='geen_beheerrechten' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'club_resets_admin';end if;
  perform epp_resolve_password_help(head_id,req,repeat('e',48),repeat('3',64));
  if not exists(select 1 from app_accounts where id=manager_id and must_change_password) then raise exception 'head_reset_admin_failed';end if;
  -- Repeated public requests are rate limited even when an address is unknown.
  for n in 1..6 loop perform epp_request_password_help('help.integration.othermember','mercurius75','help-integration-ip');end loop;
  delete from epp_password_help_requests where account_id=other_member;
  perform epp_request_password_help('help.integration.othermember','mercurius75','help-integration-ip');
  if exists(select 1 from epp_password_help_requests where account_id=other_member) then raise exception 'rate_limit_missing';end if;
  if has_table_privilege('anon','epp_password_help_requests','SELECT') or has_function_privilege('authenticated','epp_list_password_help(uuid)','EXECUTE') then raise exception 'help_requests_public';end if;
end $$;
select 'PASS help requests, username/email, deduplication, scoping, admin escalation, temporary password, session revocation, replay protection, manual resolution and rate limiting' as result;
rollback;
