begin;
alter table public.app_accounts add column is_platform_admin boolean not null default false;
alter table public.app_accounts add column must_change_password boolean not null default false;
create table public.epp_access_audit (
  id uuid primary key default gen_random_uuid(),actor_id uuid not null references app_accounts(id),target_id uuid not null references app_accounts(id),
  before_data jsonb not null,after_data jsonb not null,created_at timestamptz not null default now()
);
alter table public.epp_access_audit enable row level security;
revoke all on public.epp_access_audit from anon,authenticated;
grant all on public.epp_access_audit to service_role;
create function public.epp_set_club_admin(p_actor uuid,p_target uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
declare old app_accounts;updated app_accounts;
begin
  if not exists(select 1 from app_accounts where id=p_actor and active and is_platform_admin and not must_change_password) then raise exception 'geen_hoofdbeheerrechten';end if;
  select * into old from app_accounts where id=p_target and active for update;
  if old.id is null or old.is_platform_admin or old.username='kijker' then raise exception 'ongeldig_beheeraccount';end if;
  update app_accounts set role=case when p_enabled then 'trainer' else 'schutter' end,is_admin=p_enabled where id=p_target returning * into updated;
  delete from app_sessions where account_id=p_target;
  insert into epp_access_audit(actor_id,target_id,before_data,after_data) values(p_actor,p_target,jsonb_build_object('club',old.club_code,'role',old.role,'is_admin',old.is_admin),jsonb_build_object('club',updated.club_code,'role',updated.role,'is_admin',updated.is_admin));
end $$;
revoke all on function public.epp_set_club_admin(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.epp_set_club_admin(uuid,uuid,boolean) to service_role;
-- Existing association administrators may not create additional privileged accounts.
alter function public.epp_create_account(uuid,text,text,text,boolean,text,text,uuid) rename to epp_create_account_legacy;
create function public.epp_create_account(p_actor uuid,p_username text,p_name text,p_role text,p_admin boolean,p_salt text,p_hash text,p_shooter uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
begin
  if (p_admin or p_role='trainer') and not exists(select 1 from app_accounts where id=p_actor and active and is_platform_admin and not must_change_password) then raise exception 'alleen_hoofdbeheer_deelt_rechten_uit';end if;
  return epp_create_account_legacy(p_actor,p_username,p_name,p_role,p_admin,p_salt,p_hash,p_shooter);
end $$;
revoke all on function public.epp_create_account_legacy(uuid,text,text,text,boolean,text,text,uuid) from service_role;
revoke all on function public.epp_create_account(uuid,text,text,text,boolean,text,text,uuid) from public,anon,authenticated;
grant execute on function public.epp_create_account(uuid,text,text,text,boolean,text,text,uuid) to service_role;
alter function public.epp_disable_account(uuid,uuid) rename to epp_disable_account_legacy;
create function public.epp_disable_account(p_actor uuid,p_target uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from app_accounts where id=p_target and is_platform_admin) then raise exception 'hoofdbeheer_beschermd';end if;
  if exists(select 1 from app_accounts where id=p_target and (is_admin or role='trainer')) and not exists(select 1 from app_accounts where id=p_actor and active and is_platform_admin and not must_change_password) then raise exception 'alleen_hoofdbeheer_deelt_rechten_uit';end if;
  perform epp_disable_account_legacy(p_actor,p_target);
end $$;
revoke all on function public.epp_disable_account_legacy(uuid,uuid) from service_role;
revoke all on function public.epp_disable_account(uuid,uuid) from public,anon,authenticated;
grant execute on function public.epp_disable_account(uuid,uuid) to service_role;
create function public.epp_clear_initial_password() returns trigger language plpgsql as $$
begin
  if new.password_hash is distinct from old.password_hash then new.must_change_password:=false;end if;return new;
end $$;
create trigger epp_clear_initial_password before update of password_hash on public.app_accounts for each row execute function public.epp_clear_initial_password();
create function public.epp_backup_access() returns trigger language plpgsql set search_path=public,extensions as $$
begin
  new.snapshot:=new.snapshot||jsonb_build_object('epp_access_audit',(select coalesce(jsonb_agg(t),'[]') from epp_access_audit t));
  new.checksum:=encode(digest(new.snapshot::text,'sha256'),'hex');return new;
end $$;
create trigger epp_backup_access before insert on public.platform_backups for each row execute function public.epp_backup_access();
commit;
