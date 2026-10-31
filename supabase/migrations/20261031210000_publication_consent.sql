begin;
alter table public.app_accounts
  add column publication_consent boolean not null default false,
  add column publication_consent_at timestamptz,
  add column publication_consent_version text;
create table public.epp_publication_consent_audit(
  id uuid primary key default gen_random_uuid(),account_id uuid not null references public.app_accounts(id),
  allowed boolean not null,policy_version text not null,
  source text not null check(source in('registration','settings')),
  decided_at timestamptz not null default now()
);
alter table public.epp_publication_consent_audit enable row level security;
revoke all on public.epp_publication_consent_audit from public,anon,authenticated;
grant select,insert on public.epp_publication_consent_audit to service_role;

create function public.epp_register_member_with_consent(p_club text,p_username text,p_first text,p_last text,p_email text,p_salt text,p_hash text,p_login_username text,p_consent boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare aid uuid;decision boolean:=coalesce(p_consent,false);version constant text:='EPP_PUBLICATION_2026_10_V1';
begin
  aid:=epp_register_public_member_username(p_club,p_username,p_first,p_last,p_email,p_salt,p_hash,p_login_username);
  update app_accounts set publication_consent=decision,publication_consent_at=now(),publication_consent_version=version where id=aid;
  insert into epp_publication_consent_audit(account_id,allowed,policy_version,source)values(aid,decision,version,'registration');
  return aid;
end $$;

create function public.epp_set_publication_consent(p_actor uuid,p_consent boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a app_accounts;version constant text:='EPP_PUBLICATION_2026_10_V1';
begin
  if p_consent is null then raise exception 'publicatiekeuze_verplicht';end if;
  select * into a from app_accounts where id=p_actor and active and deleted_at is null and username<>'kijker' and not must_change_password for update;
  if a.id is null then raise exception 'geen_toegang';end if;
  if a.publication_consent is distinct from p_consent or a.publication_consent_version is distinct from version then
    update app_accounts set publication_consent=p_consent,publication_consent_at=now(),publication_consent_version=version where id=a.id returning * into a;
    insert into epp_publication_consent_audit(account_id,allowed,policy_version,source)values(a.id,p_consent,version,'settings');
  end if;
  return jsonb_build_object('allowed',a.publication_consent,'decidedAt',a.publication_consent_at,'version',a.publication_consent_version);
end $$;

create function public.epp_publication_states(p_shooters uuid[])
returns table(shooter_id uuid,account_id uuid,allowed boolean)
language sql stable security definer set search_path=public as $$
  select s.id,a.id,coalesce(a.publication_consent and a.active and a.membership_approved is true and a.deleted_at is null,false)
  from shooters s left join app_accounts a on a.id=s.linked_user_id where s.id=any(p_shooters)
$$;
do $$declare f record;begin
  for f in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and proname in('epp_register_member_with_consent','epp_set_publication_consent','epp_publication_states') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;

-- Record consent history in the existing protected backup snapshots.
alter function public.epp_capture_backup() rename to epp_capture_backup_before_publication;
create function public.epp_capture_backup() returns uuid language plpgsql security definer set search_path=public as $$
declare bid uuid;begin
  bid:=epp_capture_backup_before_publication();
  update platform_backups set snapshot=snapshot||jsonb_build_object('epp_publication_consent_audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from epp_publication_consent_audit a)) where id=bid;
  update platform_backups set checksum=encode(extensions.digest(snapshot::text,'sha256'),'hex') where id=bid;
  return bid;
end $$;
revoke all on function public.epp_capture_backup() from public,anon,authenticated;
grant execute on function public.epp_capture_backup() to service_role;

-- Future EPP entries always offer the two pistol disciplines. Existing dates,
-- planners, bookings and historical non-EPP disciplines are not rewritten.
create function public.epp_two_pistol_disciplines() returns trigger language plpgsql set search_path=public as $$
begin
  if new.archived_at is null and (tg_op='INSERT' or new.match_date>=current_date) then new.offered_disciplines:=array['pistool','optiek'];end if;
  return new;
end $$;
create trigger epp_two_pistol_disciplines before insert or update of offered_disciplines,match_date on public.epp_matches for each row execute function public.epp_two_pistol_disciplines();
update public.epp_matches set offered_disciplines=array['pistool','optiek'] where archived_at is null and match_date>=current_date and offered_disciplines is distinct from array['pistool','optiek'];
commit;
