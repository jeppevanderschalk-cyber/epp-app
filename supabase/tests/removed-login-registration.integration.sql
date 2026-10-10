begin;
do $$
declare head uuid:=gen_random_uuid();shared uuid;old_account uuid;new_account uuid;old_shooter uuid;login_name text:='lid.'||repeat('e',40);denied boolean;
begin
  insert into app_accounts(id,club_code,username,display_name,role,is_admin,is_platform_admin)
  values(head,'eppnationaal','test.recreate.head','Recreate Test Head','trainer',true,true);
  select id into strict shared from app_accounts where club_code='svbb' and username='kijker';
  old_account:=epp_register_member_at_club(shared,'apgs',login_name,'Recreation','Transactionaltest',repeat('b',48),repeat('c',64));
  select id into strict old_shooter from shooters where linked_user_id=old_account;
  perform epp_delete_account(head,old_account);
  if not exists(select 1 from app_accounts where id=old_account and username='removed.'||replace(old_account::text,'-','') and deleted_at is not null and not active and password_hash is null)then raise exception 'deleted_login_reserved';end if;
  new_account:=epp_register_member_at_club(shared,'apgs',login_name,'Recreation','Transactionaltest',repeat('d',48),repeat('e',64));
  if new_account=old_account then raise exception 'deleted_identity_reactivated';end if;
  if not exists(select 1 from app_accounts where id=new_account and active and role='schutter' and not is_admin and not is_platform_admin and deleted_at is null)then raise exception 'new_account_invalid';end if;
  if not exists(select 1 from shooters where linked_user_id=new_account and id<>old_shooter)then raise exception 'old_profile_claimed';end if;
  if not exists(select 1 from shooters where id=old_shooter and linked_user_id=old_account)then raise exception 'history_changed';end if;
  denied:=false;
  begin perform epp_register_member_at_club(shared,'apgs',login_name,'Recreation','Transactionaltest',repeat('d',48),repeat('e',64));exception when others then if sqlerrm='naam_al_geregistreerd' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'active_duplicate_allowed';end if;
  update app_accounts set active=false where id=new_account;
  denied:=false;
  begin perform epp_register_member_at_club(shared,'apgs',login_name,'Recreation','Transactionaltest',repeat('d',48),repeat('e',64));exception when others then if sqlerrm='naam_al_geregistreerd' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'block_bypassed';end if;
end $$;
rollback;
