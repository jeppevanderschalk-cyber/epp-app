begin;
alter table public.clubs add column notification_email text;
alter table public.clubs add column notifications_enabled boolean not null default false;
alter table public.clubs add constraint epp_notification_email_valid check(notification_email is null or (length(notification_email)<=254 and notification_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
create table public.epp_email_notifications (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('account','signup')),
 event_id uuid not null,club_code text not null references public.clubs(code),recipient text not null,
 account_id uuid references public.app_accounts(id) on delete cascade,
 signup_id uuid references public.epp_signups(id) on delete cascade,payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','processing','sent','failed','cancelled')),
 attempts integer not null default 0,available_at timestamptz not null default now(),lease_token uuid,leased_until timestamptz,
 provider_id text,last_error text,first_attempt_at timestamptz,created_at timestamptz not null default now(),sent_at timestamptz,
 unique(kind,event_id,recipient)
);
alter table public.epp_email_notifications enable row level security;
revoke all on public.epp_email_notifications from public,anon,authenticated;
grant all on public.epp_email_notifications to service_role;
create index epp_email_notifications_due on public.epp_email_notifications(available_at) where status in ('pending','processing');
create function public.epp_notification_recipients(p_club text) returns text[] language sql stable security definer set search_path=public as $$
 select case when c.notification_email is not null then array[lower(c.notification_email)] else
 coalesce((select array_agg(distinct lower(a.email)) from app_accounts a where a.club_code=c.code and a.active and a.deleted_at is null and a.role='trainer' and a.is_admin and not a.is_platform_admin and a.membership_approved and a.email is not null),'{}'::text[]) end
 from clubs c where c.code=p_club and c.actief
$$;
create function public.epp_queue_account_email() returns trigger language plpgsql security definer set search_path=public as $$
declare address text;c clubs;
begin
 if new.role<>'schutter' or new.username='kijker' or new.membership_approved or new.deleted_at is not null then return new;end if;
 select * into c from clubs where code=new.club_code and notifications_enabled and actief;
 if c.id is null then return new;end if;
 foreach address in array epp_notification_recipients(c.code) loop
 insert into epp_email_notifications(kind,event_id,club_code,recipient,account_id,payload)
 values('account',new.id,c.code,address,new.id,jsonb_build_object('name',new.display_name,'club',c.naam)) on conflict do nothing;
 end loop;return new;
end $$;
create trigger epp_queue_account_email after insert on public.app_accounts for each row execute function public.epp_queue_account_email();
create function public.epp_queue_signup_email() returns trigger language plpgsql security definer set search_path=public as $$
declare address text;s shooters;c clubs;m epp_matches;su epp_signups;choices jsonb;
begin
 if new.action<>'book' or jsonb_array_length(coalesce(new.before_data->'choices','[]'::jsonb))<>0 or jsonb_array_length(coalesce(new.after_data->'choices','[]'::jsonb))=0 then return new;end if;
 select * into s from shooters where id=(new.after_data->>'shooterId')::uuid;
 select * into c from clubs where id=s.home_club_id and notifications_enabled and actief;
 if c.id is null then return new;end if;
 select * into m from epp_matches where id=new.match_id and archived_at is null;
 select * into su from epp_signups where match_id=m.id and shooter_id=s.id;
 if su.id is null then return new;end if;
 select jsonb_agg(jsonb_build_object('discipline',d.discipline,'time',d.specific_time,'day',to_char(sl.starts_at at time zone 'Europe/Amsterdam','YYYY-MM-DD')) order by d.discipline) into choices from epp_signup_disciplines d left join epp_match_slots sl on sl.id=d.slot_id where d.signup_id=su.id;
 foreach address in array epp_notification_recipients(c.code) loop
 insert into epp_email_notifications(kind,event_id,club_code,recipient,signup_id,payload)
 values('signup',new.id,c.code,address,su.id,jsonb_build_object('name',s.display_name,'club',c.naam,'match',m.organizer,'date',m.match_date,'location',m.location,'choices',choices)) on conflict do nothing;
 end loop;return new;
end $$;
create trigger epp_queue_signup_email after insert on public.epp_planner_audit for each row execute function public.epp_queue_signup_email();
create function public.epp_claim_notifications(p_limit integer default 10) returns setof public.epp_email_notifications language plpgsql security definer set search_path=public as $$
begin
 update epp_email_notifications n set status='cancelled',lease_token=null,leased_until=null
 where n.status in ('pending','processing') and (
 (n.account_id is not null and exists(select 1 from app_accounts a where a.id=n.account_id and a.deleted_at is not null)) or
 (n.signup_id is not null and not exists(select 1 from epp_signup_disciplines d where d.signup_id=n.signup_id)));
 update epp_email_notifications set status='failed',last_error='verzending_controleren',lease_token=null,leased_until=null where status in ('processing','pending') and first_attempt_at<now()-interval '20 hours';
 update epp_email_notifications set status='failed',last_error='maximum_pogingen',lease_token=null,leased_until=null where status='processing' and leased_until<now() and attempts>=8;
 return query with due as (
 select n.id from epp_email_notifications n join clubs c on c.code=n.club_code
 where c.notifications_enabled and c.actief and n.attempts<8 and
 ((n.status='pending' and n.available_at<=now()) or (n.status='processing' and n.leased_until<now()))
 order by n.available_at limit greatest(1,least(p_limit,20)) for update of n skip locked
 ) update epp_email_notifications n set status='processing',attempts=n.attempts+1,first_attempt_at=coalesce(n.first_attempt_at,now()),lease_token=gen_random_uuid(),leased_until=now()+interval '5 minutes' from due where n.id=due.id returning n.*;
end $$;
create function public.epp_complete_notification(p_id uuid,p_token uuid,p_sent boolean,p_provider_id text default null,p_error text default null,p_retry boolean default true) returns void language plpgsql security definer set search_path=public as $$
begin
 update epp_email_notifications set status=case when p_sent then 'sent' when p_retry and attempts<8 then 'pending' else 'failed' end,
 provider_id=case when p_sent then p_provider_id else provider_id end,last_error=case when p_sent then null else left(p_error,200) end,
 sent_at=case when p_sent then now() else sent_at end,available_at=now()+make_interval(mins=>least(60,power(2,attempts-1)::integer)),lease_token=null,leased_until=null
 where id=p_id and lease_token=p_token and status='processing';
 if not found then raise exception 'melding_lease_verlopen';end if;
end $$;
revoke all on function public.epp_notification_recipients(text),public.epp_queue_account_email(),public.epp_queue_signup_email(),public.epp_claim_notifications(integer),public.epp_complete_notification(uuid,uuid,boolean,text,text,boolean) from public,anon,authenticated;
grant execute on function public.epp_notification_recipients(text),public.epp_claim_notifications(integer),public.epp_complete_notification(uuid,uuid,boolean,text,text,boolean) to service_role;
commit;
