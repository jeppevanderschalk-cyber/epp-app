begin;
alter table public.app_accounts add column deleted_at timestamptz;
alter table public.app_accounts add constraint epp_removed_account_no_access check (
  deleted_at is null or (not active and not legacy and not is_admin and not is_platform_admin and password_hash is null and password_salt is null)
);
-- Retain account IDs referenced by historical scores and audit records.
create function public.epp_delete_account(p_actor uuid,p_target uuid)
returns void language plpgsql security definer set search_path=public as $$
declare actor app_accounts;target app_accounts;
begin
  select * into actor from app_accounts where id=p_actor for update;
  if actor.id is null or not actor.active or actor.deleted_at is not null or actor.role<>'trainer' or not actor.is_admin or not actor.is_platform_admin or actor.must_change_password then raise exception 'geen_hoofdbeheerrechten';end if;
  if p_actor=p_target then raise exception 'eigen_account_niet_verwijderen';end if;
  select * into target from app_accounts where id=p_target for update;
  if target.id is null then raise exception 'account_niet_gevonden';end if;
  if target.is_platform_admin or target.username='hoofdbeheer' then raise exception 'hoofdbeheer_beschermd';end if;
  if target.username='kijker' then raise exception 'registratieaccount_beschermd';end if;
  if target.deleted_at is not null then return;end if;
  update app_accounts set active=false,legacy=false,is_admin=false,is_platform_admin=false,password_hash=null,password_salt=null,deleted_at=now() where id=p_target;
  delete from app_sessions where account_id=p_target;
  insert into epp_access_audit(actor_id,target_id,before_data,after_data)
  values(p_actor,p_target,jsonb_build_object('club',target.club_code,'role',target.role,'active',target.active,'is_admin',target.is_admin),jsonb_build_object('action','delete_account','active',false,'deleted_at',now()));
end $$;
revoke all on function public.epp_delete_account(uuid,uuid) from public,anon,authenticated;
grant execute on function public.epp_delete_account(uuid,uuid) to service_role;
commit;
