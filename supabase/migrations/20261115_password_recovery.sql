begin;
create table public.epp_password_reset_limits (
  key text primary key, window_start timestamptz not null, attempts integer not null
);
create table public.epp_password_resets (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  account_id uuid not null references app_accounts(id) on delete cascade,
  password_snapshot text not null, email_snapshot text not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 minutes'
);
alter table epp_password_resets enable row level security;
alter table epp_password_reset_limits enable row level security;
revoke all on epp_password_resets,epp_password_reset_limits from public,anon,authenticated;
grant all on epp_password_resets,epp_password_reset_limits to service_role;
create function public.epp_request_password_reset(p_email text,p_club text,p_token_hash text,p_ip_hash text)
returns table(account_id uuid,email text) language plpgsql security definer set search_path=public as $$
declare a app_accounts; k text; n integer;
begin
  -- Serialize requests, including unknown addresses, before looking up accounts.
  perform pg_advisory_xact_lock(hashtextextended('password-reset-requests',0));
  delete from epp_password_reset_limits where window_start<now()-interval '1 hour';
  delete from epp_password_resets where expires_at<now();
  foreach k in array array['email:'||encode(sha256(convert_to(lower(p_email),'UTF8')),'hex'),'ip:'||p_ip_hash] loop
    insert into epp_password_reset_limits(key,window_start,attempts) values(k,now(),1)
    on conflict(key) do update set attempts=epp_password_reset_limits.attempts+1 returning attempts into n;
    if n>(case when k like 'email:%' then 5 else 30 end) then return;end if;
  end loop;
  select * into a from app_accounts where club_code=p_club and lower(app_accounts.email)=lower(p_email)
    and active and deleted_at is null and not legacy and username not in ('kijker','beheer','hoofdbeheer') and not is_platform_admin
    order by created_at limit 1;
  if a.id is null then return;end if;
  if exists(select 1 from epp_password_resets where epp_password_resets.account_id=a.id and created_at>now()-interval '2 minutes') then return;end if;
  insert into epp_password_resets(token_hash,account_id,password_snapshot,email_snapshot) values(p_token_hash,a.id,a.password_hash,a.email);
  return query select a.id,a.email;
end $$;
create function public.epp_complete_password_reset(p_token_hash text,p_salt text,p_hash text)
returns void language plpgsql security definer set search_path=public as $$
declare r epp_password_resets; a app_accounts;
begin
  select * into r from epp_password_resets where token_hash=p_token_hash;
  if r.account_id is null then raise exception 'resetlink_ongeldig';end if;
  select * into a from app_accounts where id=r.account_id for update;
  -- Re-read after the account lock: concurrent redemption can only succeed once.
  select * into r from epp_password_resets where token_hash=p_token_hash for update;
  if r.account_id is null or r.expires_at<=now() or not a.active or a.deleted_at is not null or a.is_platform_admin
    or a.password_hash is distinct from r.password_snapshot or a.email is distinct from r.email_snapshot
    then raise exception 'resetlink_ongeldig';end if;
  update app_accounts set password_salt=p_salt,password_hash=p_hash,iterations=600000,legacy=false,
    must_change_password=false,failed_attempts=0,locked_until=null where id=a.id;
  delete from app_sessions where account_id=a.id;
  delete from epp_password_resets where account_id=a.id;
end $$;
create function public.epp_admin_reset_password(p_actor uuid,p_target uuid,p_salt text,p_hash text)
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
  insert into epp_access_audit(actor_id,target_id,before_data,after_data) values(a.id,t.id,jsonb_build_object('password_reset',false),jsonb_build_object('password_reset',true,'must_change_password',true));
end $$;
revoke all on function epp_request_password_reset(text,text,text,text),epp_complete_password_reset(text,text,text),epp_admin_reset_password(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function epp_request_password_reset(text,text,text,text),epp_complete_password_reset(text,text,text),epp_admin_reset_password(uuid,uuid,text,text) to service_role;
commit;
