begin;
create table public.epp_password_help_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app_accounts(id) on delete cascade,
  requested_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references app_accounts(id)
);
create unique index epp_password_help_pending_account on epp_password_help_requests(account_id) where handled_at is null;
alter table epp_password_help_requests enable row level security;
revoke all on epp_password_help_requests from public,anon,authenticated;
grant all on epp_password_help_requests to service_role;
create function public.epp_request_password_help(p_identifier text,p_club text,p_ip_hash text)
returns void language plpgsql security definer set search_path=public as $$
declare a app_accounts; k text; n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('password-help-requests',0));
  delete from epp_password_reset_limits where window_start<now()-interval '1 hour';
  foreach k in array array['help-user:'||encode(sha256(convert_to(lower(trim(p_identifier)),'UTF8')),'hex'),'help-ip:'||p_ip_hash] loop
    insert into epp_password_reset_limits(key,window_start,attempts) values(k,now(),1)
    on conflict(key) do update set attempts=epp_password_reset_limits.attempts+1 returning attempts into n;
    if n>(case when k like 'help-user:%' then 5 else 30 end) then return;end if;
  end loop;
  select * into a from app_accounts where club_code=p_club
    and (case when position('@' in p_identifier)>0 then lower(email)=lower(trim(p_identifier)) else lower(login_username)=lower(trim(p_identifier)) or lower(username)=lower(trim(p_identifier)) end)
    and active and deleted_at is null and not legacy and not is_platform_admin and username not in ('kijker','beheer','hoofdbeheer')
    order by created_at limit 1 for update;
  if a.id is null then return;end if;
  insert into epp_password_help_requests(account_id) values(a.id) on conflict(account_id) where handled_at is null do nothing;
end $$;
create function public.epp_list_password_help(p_actor uuid)
returns table(id uuid,account_id uuid,requested_at timestamptz,display_name text,login_username text,email text,club_code text,club_name text)
language plpgsql security definer set search_path=public as $$
declare a app_accounts;
begin
  select * into a from app_accounts where app_accounts.id=p_actor and active and deleted_at is null and is_admin and role='trainer' and membership_approved and not must_change_password;
  if a.id is null then raise exception 'geen_beheerrechten';end if;
  return query select r.id,t.id,r.requested_at,t.display_name,t.login_username,t.email,t.club_code,c.naam
    from epp_password_help_requests r join app_accounts t on t.id=r.account_id left join clubs c on c.code=t.club_code
    where r.handled_at is null and t.active and t.deleted_at is null and not t.is_platform_admin
      and (a.is_platform_admin or (t.club_code=a.club_code and not t.is_admin))
    order by r.requested_at,r.id;
end $$;
create or replace function public.epp_admin_reset_password(p_actor uuid,p_target uuid,p_salt text,p_hash text)
returns void language plpgsql security definer set search_path=public as $$
declare a app_accounts; t app_accounts;
begin
  select * into a from app_accounts where id=p_actor and active and deleted_at is null and is_admin and role='trainer' and membership_approved and not must_change_password;
  if a.id is null then raise exception 'geen_beheerrechten';end if;
  select * into t from app_accounts where id=p_target and active and deleted_at is null for update;
  if t.id is null or t.id=a.id or t.is_platform_admin or t.legacy or t.username in ('kijker','beheer','hoofdbeheer') then raise exception 'ongeldig_beheeraccount';end if;
  if not a.is_platform_admin and (t.club_code<>a.club_code or t.is_admin) then raise exception 'geen_beheerrechten';end if;
  update app_accounts set password_salt=p_salt,password_hash=p_hash,iterations=600000,legacy=false,must_change_password=true,failed_attempts=0,locked_until=null where id=t.id;
  -- The existing password-change trigger clears the flag; set it after that trigger.
  update app_accounts set must_change_password=true where id=t.id;
  delete from app_sessions where account_id=t.id;
  delete from epp_password_resets where account_id=t.id;
  update epp_password_help_requests set handled_at=now(),handled_by=a.id where account_id=t.id and handled_at is null;
  insert into epp_access_audit(actor_id,target_id,before_data,after_data) values(a.id,t.id,jsonb_build_object('password_reset',false),jsonb_build_object('password_reset',true,'must_change_password',true));
end $$;
create function public.epp_resolve_password_help(p_actor uuid,p_request uuid,p_salt text,p_hash text)
returns void language plpgsql security definer set search_path=public as $$
declare r epp_password_help_requests;
begin
  select * into r from epp_password_help_requests where id=p_request;
  if r.id is null then raise exception 'herstelverzoek_afgehandeld';end if;
  -- Use the same account -> request lock order as manual password resets.
  perform 1 from app_accounts where id=r.account_id for update;
  select * into r from epp_password_help_requests where id=p_request for update;
  if r.handled_at is not null then raise exception 'herstelverzoek_afgehandeld';end if;
  perform epp_admin_reset_password(p_actor,r.account_id,p_salt,p_hash);
end $$;
revoke all on function epp_request_password_help(text,text,text),epp_list_password_help(uuid),epp_resolve_password_help(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function epp_request_password_help(text,text,text),epp_list_password_help(uuid),epp_resolve_password_help(uuid,uuid,text,text) to service_role;
commit;
