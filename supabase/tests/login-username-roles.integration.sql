begin;
do $$
declare actor_id uuid; target_id uuid; original app_accounts; rejected boolean; count_tested integer:=0;
begin
 select id into strict actor_id from app_accounts where is_platform_admin and active and deleted_at is null and not must_change_password limit 1;
 for target_id in select id from app_accounts where deleted_at is null and display_name in ('Jeppie DSR','Jeppe van der Schalk') and not is_platform_admin loop
  select * into original from app_accounts where id=target_id;
  perform epp_set_club_admin(actor_id,target_id,true);
  if not exists(select 1 from app_accounts where id=target_id and role='trainer' and is_admin and login_username=original.login_username and password_hash is not distinct from original.password_hash) then raise exception 'admin_grant_or_identity_failed';end if;
  perform epp_set_club_admin(actor_id,target_id,false);
  if not exists(select 1 from app_accounts where id=target_id and role='schutter' and not is_admin and login_username=original.login_username) then raise exception 'admin_revoke_failed';end if;
  update app_accounts set role='trainer' where id=target_id;
  if not exists(select 1 from app_accounts where id=target_id and role='trainer' and not is_admin and login_username=original.login_username) then raise exception 'trainer_grant_failed';end if;
  rejected:=false;
  begin update app_accounts set login_username='beheer' where id=target_id;exception when check_violation then rejected:=true;end;
  if not rejected then raise exception 'reserved_name_allowed';end if;
  rejected:=false;
  begin update app_accounts set login_username='Invalid Name!' where id=target_id;exception when check_violation then rejected:=true;end;
  if not rejected then raise exception 'invalid_format_allowed';end if;
  update app_accounts set role='schutter' where id=target_id;
  if not exists(select 1 from app_accounts where id=target_id and role='schutter' and not is_admin and login_username=original.login_username) then raise exception 'trainer_revoke_failed';end if;
  count_tested:=count_tested+1;
 end loop;
 if count_tested<>2 then raise exception 'expected_two_accounts';end if;
end $$;
select 'PASS both accounts: grant/revoke admin and trainer; username/password preserved; reserved and invalid names rejected; all test changes rolled back' as result;
rollback;
