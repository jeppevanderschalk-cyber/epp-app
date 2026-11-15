begin;
create table public.epp_push_subscriptions (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references app_accounts(id) on delete cascade,
 endpoint text not null unique,p256dh text not null,auth text not null,
 updated_at timestamptz not null default now(),last_test_at timestamptz
);
create table public.epp_push_jobs (
 id uuid primary key default gen_random_uuid(),subscription_id uuid not null references epp_push_subscriptions(id) on delete cascade,
 request_id uuid not null references epp_password_help_requests(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','processing','sent','failed','cancelled')),
 attempts integer not null default 0,available_at timestamptz not null default now(),created_at timestamptz not null default now(),
 lease_token uuid,leased_until timestamptz,sent_at timestamptz,last_error text,
 unique(subscription_id,request_id)
);
alter table epp_push_subscriptions enable row level security;
alter table epp_push_jobs enable row level security;
revoke all on epp_push_subscriptions,epp_push_jobs from public,anon,authenticated;
grant all on epp_push_subscriptions,epp_push_jobs to service_role;
create index epp_push_jobs_due on epp_push_jobs(available_at) where status in ('pending','processing');
create function public.epp_push_can_manage(p_actor uuid,p_target uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from app_accounts a,app_accounts t where a.id=p_actor and t.id=p_target and a.active and a.deleted_at is null
 and a.is_admin and a.role='trainer' and a.membership_approved and not a.must_change_password
 and t.active and t.deleted_at is null and not t.is_platform_admin and not t.legacy and t.username not in ('kijker','beheer','hoofdbeheer')
 and a.id<>t.id and (a.is_platform_admin or (a.club_code=t.club_code and not t.is_admin)))
$$;
create function public.epp_register_push_device(p_actor uuid,p_endpoint text,p_key text,p_auth text) returns void language plpgsql security definer set search_path=public as $$
declare sid uuid; previous uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('push-device:'||p_endpoint,0));
 perform 1 from app_accounts where id=p_actor and active and deleted_at is null and is_admin and role='trainer' and membership_approved and not must_change_password for update;
 if not found then raise exception 'geen_beheerrechten';end if;
 if (select count(*) from epp_push_subscriptions where account_id=p_actor and endpoint<>p_endpoint)>=10 then raise exception 'te_veel_pushapparaten';end if;
 select id,account_id into sid,previous from epp_push_subscriptions where endpoint=p_endpoint;
 if sid is not null and previous<>p_actor then delete from epp_push_jobs where subscription_id=sid;end if;
 insert into epp_push_subscriptions(account_id,endpoint,p256dh,auth) values(p_actor,p_endpoint,p_key,p_auth)
 on conflict(endpoint) do update set account_id=excluded.account_id,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=now() returning id into sid;
 insert into epp_push_jobs(subscription_id,request_id) select sid,r.id from epp_password_help_requests r
 where r.handled_at is null and epp_push_can_manage(p_actor,r.account_id) on conflict do nothing;
end $$;
create function public.epp_queue_help_push() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into epp_push_jobs(subscription_id,request_id)
 select s.id,new.id from epp_push_subscriptions s where epp_push_can_manage(s.account_id,new.account_id) on conflict do nothing;
 return new;
end $$;
create trigger epp_queue_help_push after insert on epp_password_help_requests for each row execute function epp_queue_help_push();
create function public.epp_claim_push_jobs(p_limit integer default 8)
returns table(id uuid,request_id uuid,lease_token uuid,endpoint text,p256dh text,auth text)
language plpgsql security definer set search_path=public as $$
begin
 delete from epp_push_jobs where created_at<now()-interval '30 days';
 update epp_push_jobs set status='failed',lease_token=null,leased_until=null,last_error='pogingen_op' where status='processing' and attempts>=5 and leased_until<now();
 update epp_push_jobs j set status='cancelled',lease_token=null,leased_until=null
 where j.status in ('pending','processing') and (j.created_at<now()-interval '24 hours' or not exists(
   select 1 from epp_password_help_requests r join epp_push_subscriptions s on s.id=j.subscription_id
   where r.id=j.request_id and r.handled_at is null and epp_push_can_manage(s.account_id,r.account_id)));
 return query with due as (
  select j.id from epp_push_jobs j where j.attempts<5 and ((j.status='pending' and j.available_at<=now()) or (j.status='processing' and j.leased_until<now()))
  order by j.available_at,j.id limit least(greatest(p_limit,1),20) for update skip locked
 ), claimed as (
  update epp_push_jobs j set status='processing',attempts=j.attempts+1,lease_token=gen_random_uuid(),leased_until=now()+interval '3 minutes'
  from due where j.id=due.id returning j.*
 ) select j.id,j.request_id,j.lease_token,s.endpoint,s.p256dh,s.auth from claimed j join epp_push_subscriptions s on s.id=j.subscription_id;
end $$;
create function public.epp_finish_push_job(p_id uuid,p_lease uuid,p_sent boolean,p_expired boolean,p_retry boolean,p_error text)
returns void language plpgsql security definer set search_path=public as $$
declare j epp_push_jobs;
begin
 select * into j from epp_push_jobs where id=p_id and lease_token=p_lease and status='processing' for update;
 if j.id is null then return;end if;
 if p_expired then delete from epp_push_subscriptions where id=j.subscription_id;return;end if;
 update epp_push_jobs set status=case when p_sent then 'sent' when p_retry and attempts<5 then 'pending' else 'failed' end,
 available_at=now()+make_interval(secs=>least(3600,60*power(2,attempts)::integer)),sent_at=case when p_sent then now() else null end,
 last_error=case when p_sent then null else left(p_error,100) end,lease_token=null,leased_until=null where id=p_id;
end $$;
create function public.epp_prepare_push_test(p_actor uuid,p_endpoint text)
returns table(endpoint text,p256dh text,auth text) language plpgsql security definer set search_path=public as $$
declare s epp_push_subscriptions;
begin
 select * into s from epp_push_subscriptions where account_id=p_actor and epp_push_subscriptions.endpoint=p_endpoint for update;
 if s.id is null then raise exception 'pushapparaat_niet_gevonden';end if;
 if s.last_test_at>now()-interval '1 minute' then raise exception 'wacht_even_met_testen';end if;
 update epp_push_subscriptions set last_test_at=now() where id=s.id;
 return query select s.endpoint,s.p256dh,s.auth;
end $$;
revoke all on function epp_push_can_manage(uuid,uuid),epp_register_push_device(uuid,text,text,text),epp_queue_help_push(),epp_claim_push_jobs(integer),epp_finish_push_job(uuid,uuid,boolean,boolean,boolean,text),epp_prepare_push_test(uuid,text) from public,anon,authenticated;
grant execute on function epp_push_can_manage(uuid,uuid),epp_register_push_device(uuid,text,text,text),epp_claim_push_jobs(integer),epp_finish_push_job(uuid,uuid,boolean,boolean,boolean,text),epp_prepare_push_test(uuid,text) to service_role;
commit;
