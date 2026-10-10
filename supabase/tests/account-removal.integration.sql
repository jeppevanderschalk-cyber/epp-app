begin;
do $$
declare head uuid:=gen_random_uuid();ordinary uuid:=gen_random_uuid();pending uuid:=gen_random_uuid();target uuid;blocked uuid:=gen_random_uuid();shared uuid;counts jsonb;rejected boolean;candidate uuid;
begin
  insert into app_accounts(id,club_code,username,display_name,role,is_admin,is_platform_admin,must_change_password)
  values(head,'eppnationaal','test.delete.head','Delete Test Head','trainer',true,true,false),
    (ordinary,'svbb','test.delete.admin','Delete Test Admin','trainer',true,false,false),
    (pending,'eppnationaal','test.delete.pending','Delete Test Pending','trainer',true,true,true);
  insert into app_accounts(id,club_code,username,display_name,role,active) values(blocked,'svbb','test.delete.blocked','Delete Test Blocked','schutter',false);
  select id into strict shared from app_accounts where club_code='svbb' and username='kijker';
  target:=epp_register_member_at_club(shared,'apgs','lid.'||repeat('d',40),'Removal','Transactionaltest',repeat('b',48),repeat('c',64));
  insert into app_sessions(token_hash,account_id,expires_at) values(repeat('d',64),target,now()+interval '1 hour');
  insert into training_entities(club_code,kind,entity_id,data,updated_by) values('apgs','meta','delete-test',jsonb_build_object('score',200),target);
  select jsonb_build_array((select count(*) from shooters),(select count(*) from memberships),(select count(*) from results),(select count(*) from epp_signups),(select count(*) from training_entities)) into counts;
  foreach candidate in array array[ordinary,pending] loop
    rejected:=false;
    begin perform epp_delete_account(candidate,target);exception when others then if sqlerrm='geen_hoofdbeheerrechten' then rejected:=true;else raise;end if;end;
    if not rejected then raise exception 'unauthorized_delete_allowed';end if;
  end loop;
  foreach candidate in array array[head,pending,shared] loop
    rejected:=false;
    begin perform epp_delete_account(head,candidate);exception when others then if sqlerrm in ('eigen_account_niet_verwijderen','hoofdbeheer_beschermd','registratieaccount_beschermd') then rejected:=true;else raise;end if;end;
    if not rejected then raise exception 'protected_delete_allowed';end if;
  end loop;
  perform epp_delete_account(head,target);
  if not exists(select 1 from app_accounts where id=target and deleted_at is not null and not active and password_hash is null and password_salt is null and not legacy) then raise exception 'account_not_removed';end if;
  if exists(select 1 from app_sessions where account_id=target)then raise exception 'session_retained';end if;
  if not exists(select 1 from shooters where linked_user_id=target)then raise exception 'shooter_history_lost';end if;
  if counts<>jsonb_build_array((select count(*) from shooters),(select count(*) from memberships),(select count(*) from results),(select count(*) from epp_signups),(select count(*) from training_entities))then raise exception 'history_changed';end if;
  if not exists(select 1 from epp_access_audit where actor_id=head and target_id=target and after_data->>'action'='delete_account')then raise exception 'audit_missing';end if;
  perform epp_delete_account(head,target);
  if (select count(*) from epp_access_audit where actor_id=head and target_id=target)<>1 then raise exception 'duplicate_audit';end if;
  perform epp_delete_account(head,blocked);
  if not exists(select 1 from app_accounts where id=blocked and deleted_at is not null)then raise exception 'blocked_not_removed';end if;
  rejected:=false;
  begin update app_accounts set active=true where id=target;exception when check_violation then rejected:=true;end;
  if not rejected then raise exception 'removed_account_reactivated';end if;
  if has_function_privilege('anon','public.epp_delete_account(uuid,uuid)','execute') or has_function_privilege('authenticated','public.epp_delete_account(uuid,uuid)','execute') then raise exception 'public_execution_allowed';end if;
end $$;
rollback;
