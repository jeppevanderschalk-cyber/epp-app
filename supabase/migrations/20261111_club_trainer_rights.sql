begin;
create or replace function public.epp_set_club_trainer(p_actor uuid,p_target uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
declare actor app_accounts; old app_accounts; updated app_accounts;
begin
  select * into actor from app_accounts where id=p_actor and active and deleted_at is null and membership_approved and is_admin and role='trainer' and not must_change_password for update;
  if actor.id is null then raise exception 'geen_beheerrechten';end if;
  select * into old from app_accounts where id=p_target for update;
  if old.id is null or not old.active or old.deleted_at is not null or not old.membership_approved or old.is_admin or old.is_platform_admin or old.username in ('kijker','beheer','hoofdbeheer') or old.id=actor.id then raise exception 'ongeldig_traineraccount';end if;
  if old.club_code<>actor.club_code and not actor.is_platform_admin then raise exception 'geen_beheerrechten';end if;
  if p_enabled is null then raise exception 'ongeldige_bewerking';end if;
  update app_accounts set role=case when p_enabled then 'trainer' else 'schutter' end where id=p_target returning * into updated;
  delete from app_sessions where account_id=p_target;
  insert into epp_access_audit(actor_id,target_id,before_data,after_data) values(p_actor,p_target,jsonb_build_object('club',old.club_code,'role',old.role,'is_admin',old.is_admin),jsonb_build_object('club',updated.club_code,'role',updated.role,'is_admin',updated.is_admin));
end $$;
revoke all on function public.epp_set_club_trainer(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.epp_set_club_trainer(uuid,uuid,boolean) to service_role;
create or replace function public.epp_create_account(p_actor uuid,p_username text,p_name text,p_role text,p_admin boolean,p_salt text,p_hash text,p_shooter uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
begin
  if p_admin and not exists(select 1 from app_accounts where id=p_actor and active and is_platform_admin and deleted_at is null and not must_change_password) then raise exception 'alleen_hoofdbeheer_deelt_rechten_uit';end if;
  return epp_create_account_legacy(p_actor,p_username,p_name,p_role,p_admin,p_salt,p_hash,p_shooter);
end $$;
commit;
