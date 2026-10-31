begin;
-- Fixed EUR price, frozen recipient and pending holds separate from confirmed signups.
alter table public.epp_matches add column payment_required boolean not null default false;
create table public.epp_payment_runtime(singleton boolean primary key default true check(singleton),enabled boolean not null default false,mode text not null default 'live' check(mode in('live','test')));
insert into public.epp_payment_runtime(singleton,enabled)values(true,false);
create table public.epp_payment_accounts(
  club_code text primary key references public.clubs(code),
  organization_id text not null unique,
  organization_name text not null,
  profile_id text,
  credentials text not null,
  can_receive boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.epp_payment_oauth_states(
  token_hash text primary key,club_code text not null references public.clubs(code),
  actor_id uuid not null references public.app_accounts(id),expires_at timestamptz not null
);
create table public.epp_payment_orders(
  id uuid primary key default gen_random_uuid(),match_id uuid not null references public.epp_matches(id),
  actor_id uuid not null references public.app_accounts(id),shooter_id uuid not null references public.shooters(id),
  club_code text not null references public.epp_payment_accounts(club_code),
  organization_id text not null,profile_id text not null,provider_mode text not null default 'live' check(provider_mode in('live','test')),
  choices jsonb not null check(jsonb_typeof(choices)='array' and jsonb_array_length(choices) between 1 and 2),
  amount_cents integer not null check(amount_cents=1200*jsonb_array_length(choices)),currency text not null default 'EUR' check(currency='EUR'),
  status text not null default 'creating' check(status in('creating','open','pending','paid','failed','expired','canceled','review')),
  expected_revision integer not null,provider_id text unique,checkout_url text,create_token text,
  expires_at timestamptz,refunded_cents integer not null default 0,registration_canceled boolean not null default false,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),confirmed_at timestamptz,last_error text
);
create unique index epp_payment_one_active on public.epp_payment_orders(match_id,shooter_id) where status in('creating','open','pending');
create index epp_payment_reconcile on public.epp_payment_orders(updated_at) where status in('creating','open','pending');
create table public.epp_payment_audit(
  id uuid primary key default gen_random_uuid(),order_id uuid references public.epp_payment_orders(id),
  actor_id uuid references public.app_accounts(id),club_code text,action text not null,created_at timestamptz not null default now()
);
do $$declare t text;begin
  foreach t in array array['epp_payment_runtime','epp_payment_accounts','epp_payment_oauth_states','epp_payment_orders','epp_payment_audit'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create function public.epp_payment_holds(p_slot uuid,p_except uuid default null) returns bigint
language sql stable security definer set search_path=public as $$
  select count(*) from epp_payment_orders o cross join jsonb_array_elements(o.choices) c
  where o.status in('creating','open','pending','review') and o.id is distinct from p_except and c->>'slotId'=p_slot::text
$$;

create function public.epp_payment_configure(p_actor uuid,p_match uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path=public as $$
declare a app_accounts;m epp_matches;owner text;
begin
  select * into a from app_accounts where id=p_actor and active and deleted_at is null and role='trainer' and is_admin;
  select * into m from epp_matches where id=p_match for update;
  select owner_club into owner from epp_match_planners where match_id=p_match;
  if a.id is null or owner is null or not(a.club_code=owner or a.is_platform_admin) then raise exception 'geen_beheerrechten';end if;
  if m.archived_at is not null then raise exception 'wedstrijd_gearchiveerd';end if;
  if p_enabled is null then raise exception 'ongeldige_betaalinstelling';end if;
  if m.payment_required=p_enabled then return;end if;
  if exists(select 1 from epp_payment_orders where match_id=p_match) then raise exception 'betaalinstelling_vast';end if;
  if p_enabled then
    if not (select enabled from epp_payment_runtime where singleton) then raise exception 'betalingen_nog_niet_actief';end if;
    if not exists(select 1 from epp_payment_accounts where club_code=owner and profile_id is not null and can_receive) then raise exception 'betaalaccount_niet_gereed';end if;
    if exists(select 1 from epp_signups s join epp_signup_disciplines d on d.signup_id=s.id where s.match_id=p_match) then raise exception 'bestaande_inschrijvingen_eerst_controleren';end if;
    if not (m.offered_disciplines <@ array['pistool','optiek']) then raise exception 'alleen_standaard_en_optics';end if;
  end if;
  update epp_matches set payment_required=p_enabled where id=p_match;
  insert into epp_payment_audit(actor_id,club_code,action)values(p_actor,owner,case when p_enabled then 'enable_match:' else 'disable_match:' end||p_match);
end $$;

create function public.epp_payment_reserve(p_actor uuid,p_match uuid,p_choices jsonb,p_expected integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a app_accounts;m epp_matches;p epp_match_planners;s shooters;ac epp_payment_accounts;o epp_payment_orders;c jsonb;sl epp_match_slots;old epp_signups;
begin
  select * into a from app_accounts where id=p_actor and active and deleted_at is null and membership_approved is not false and not must_change_password;
  if a.id is null or a.username='kijker' then raise exception 'geen_toegang';end if;
  select * into s from shooters where linked_user_id=p_actor;
  if s.id is null then raise exception 'persoonlijk_schutterprofiel_verplicht';end if;
  select * into m from epp_matches where id=p_match for update;
  perform pg_advisory_xact_lock(hashtextextended('planner:'||s.id::text,0));
  if m.id is null or m.archived_at is not null then raise exception 'wedstrijd_niet_beschikbaar';end if;
  if not m.payment_required or not(select enabled from epp_payment_runtime where singleton) then raise exception 'betalingen_nog_niet_actief';end if;
  select * into p from epp_match_planners where match_id=p_match;
  if p.match_id is null or not p.published or now()<p.opens_at or now()>p.closes_at then raise exception 'inschrijving_gesloten';end if;
  select * into ac from epp_payment_accounts where club_code=p.owner_club and can_receive and profile_id is not null;
  if ac.club_code is null then raise exception 'betaalaccount_niet_gereed';end if;
  select * into o from epp_payment_orders where match_id=p_match and shooter_id=s.id and status in('creating','open','pending','review') order by (status='review') desc,created_at desc limit 1;
  if o.id is not null then
    if o.status='review' then raise exception 'betaling_controle_nodig';end if;
    if o.choices=p_choices then return to_jsonb(o);end if;
    raise exception 'betaling_loopt_al';
  end if;
  select * into old from epp_signups where match_id=p_match and shooter_id=s.id;
  if exists(select 1 from epp_signup_disciplines where signup_id=old.id) then raise exception 'betaalde_inschrijving_wijzigen_via_planner';end if;
  if p_expected is null or coalesce(old.planner_revision,0)<>p_expected then raise exception 'boeking_conflict';end if;
  if jsonb_typeof(p_choices) is distinct from 'array' or jsonb_array_length(p_choices) not between 1 and 2 then raise exception 'ongeldige_boeking';end if;
  if (select count(distinct value->>'discipline') from jsonb_array_elements(p_choices))<>jsonb_array_length(p_choices) then raise exception 'dubbele_discipline';end if;
  for c in select value from jsonb_array_elements(p_choices) loop
    if c->>'discipline' is null or not(c->>'discipline'=any(array['pistool','optiek'])) or not(c->>'discipline'=any(m.offered_disciplines)) then raise exception 'discipline_niet_aangeboden';end if;
    select * into sl from epp_match_slots where id=(c->>'slotId')::uuid and match_id=p_match;
    if sl.id is null or sl.starts_at<=now() then raise exception 'ongeldig_tijdslot';end if;
    if sl.blocked then raise exception 'tijdslot_geblokkeerd';end if;
    if (select count(*) from epp_signup_disciplines where slot_id=sl.id)+epp_payment_holds(sl.id)>=sl.capacity then raise exception 'tijdslot_vol';end if;
    if exists(select 1 from jsonb_array_elements(p_choices) other join epp_match_slots os on os.id=(other->>'slotId')::uuid where other->>'discipline'<>c->>'discipline' and sl.starts_at<os.ends_at+make_interval(mins=>p.min_gap) and sl.ends_at+make_interval(mins=>p.min_gap)>os.starts_at) then raise exception 'overlappende_boeking';end if;
    if exists(select 1 from epp_signup_disciplines d join epp_signups su on su.id=d.signup_id join epp_match_slots os on os.id=d.slot_id join epp_match_planners op on op.match_id=os.match_id where su.shooter_id=s.id and sl.starts_at<os.ends_at+make_interval(mins=>greatest(p.min_gap,op.min_gap)) and sl.ends_at+make_interval(mins=>greatest(p.min_gap,op.min_gap))>os.starts_at) then raise exception 'overlappende_boeking';end if;
    if exists(select 1 from epp_payment_orders po cross join jsonb_array_elements(po.choices) pc join epp_match_slots os on os.id=(pc->>'slotId')::uuid join epp_match_planners op on op.match_id=os.match_id where po.shooter_id=s.id and po.status in('creating','open','pending','review') and sl.starts_at<os.ends_at+make_interval(mins=>greatest(p.min_gap,op.min_gap)) and sl.ends_at+make_interval(mins=>greatest(p.min_gap,op.min_gap))>os.starts_at) then raise exception 'overlappende_boeking';end if;
  end loop;
  insert into epp_payment_orders(match_id,actor_id,shooter_id,club_code,organization_id,profile_id,choices,amount_cents,expected_revision,provider_mode)
    values(p_match,p_actor,s.id,ac.club_code,ac.organization_id,ac.profile_id,p_choices,1200*jsonb_array_length(p_choices),p_expected,(select mode from epp_payment_runtime where singleton)) returning * into o;
  insert into epp_payment_audit(order_id,actor_id,club_code,action)values(o.id,p_actor,ac.club_code,'reserve');
  return to_jsonb(o);
end $$;

-- Called exclusively after the server retrieved and validated the provider payment.
create function public.epp_payment_apply(p_order uuid,p_provider text,p_status text,p_refunded integer default 0) returns jsonb
language plpgsql security definer set search_path=public as $$
declare o epp_payment_orders;mid uuid;result jsonb;
begin
  select match_id into mid from epp_payment_orders where id=p_order;
  perform 1 from epp_matches where id=mid for update;
  select * into o from epp_payment_orders where id=p_order for update;
  if o.id is null or o.provider_id is distinct from p_provider then raise exception 'ongeldige_betaling';end if;
  if p_status is null or p_status not in('open','pending','paid','failed','expired','canceled') or p_refunded is null or p_refunded not between 0 and o.amount_cents then raise exception 'ongeldige_betaalstatus';end if;
  if o.status in('paid','review') then
    if p_status<>'paid' then raise exception 'betaalstatus_conflict';end if;
    update epp_payment_orders set refunded_cents=p_refunded,updated_at=now() where id=o.id;
    return jsonb_build_object('status',o.status);
  end if;
  if o.status in('failed','expired','canceled') then
    if p_status='paid' then
      update epp_payment_orders set status='review',last_error='late_payment',updated_at=now() where id=o.id;
      return jsonb_build_object('status','review');
    end if;
    return jsonb_build_object('status',o.status);
  end if;
  if p_status='paid' then
    begin
      update epp_payment_orders set status='paid',refunded_cents=p_refunded,updated_at=now() where id=o.id;
      perform set_config('epp.payment_order',o.id::text,true);
      result:=epp_planner_book(o.actor_id,o.match_id,o.shooter_id,o.choices,o.expected_revision,'Betaling bevestigd');
      perform set_config('epp.payment_order','',true);
      update epp_payment_orders set confirmed_at=now() where id=o.id;
    exception when others then
      perform set_config('epp.payment_order','',true);
      update epp_payment_orders set status='review',last_error=sqlerrm,updated_at=now() where id=o.id;
      insert into epp_payment_audit(order_id,club_code,action)values(o.id,o.club_code,'review');
      return jsonb_build_object('status','review');
    end;
  else
    update epp_payment_orders set status=p_status,updated_at=now() where id=o.id;
  end if;
  if o.status<>p_status then insert into epp_payment_audit(order_id,club_code,action)values(o.id,o.club_code,p_status);end if;
  return jsonb_build_object('status',p_status);
end $$;

create function public.epp_payment_retry_review(p_actor uuid,p_order uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a app_accounts;o epp_payment_orders;mid uuid;
begin
  select match_id into mid from epp_payment_orders where id=p_order;
  perform 1 from epp_matches where id=mid for update;
  select * into a from app_accounts where id=p_actor and active and deleted_at is null and role='trainer' and is_admin;
  select * into o from epp_payment_orders where id=p_order for update;
  if a.id is null or o.id is null or not(a.club_code=o.club_code or a.is_platform_admin) then raise exception 'geen_beheerrechten';end if;
  if o.status<>'review' or o.provider_id is null or o.refunded_cents>0 then raise exception 'betaling_controle_nodig';end if;
  insert into epp_payment_audit(order_id,actor_id,club_code,action)values(o.id,p_actor,o.club_code,'retry_verified_payment');
  update epp_payment_orders set status='pending',last_error=null where id=o.id;
  return epp_payment_apply(o.id,o.provider_id,'paid',0);
end $$;

-- A verified paid order is the only way to create a paid signup. Existing paid
-- participants may move time slots, but cannot add/remove disciplines for free.
create function public.epp_payment_booking_guard(p_match uuid,p_shooter uuid,p_choices jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare oid uuid;paid_choices jsonb;
begin
  oid:=nullif(current_setting('epp.payment_order',true),'')::uuid;
  if exists(select 1 from epp_payment_orders where id=oid and match_id=p_match and shooter_id=p_shooter and status='paid' and choices=p_choices) then return;end if;
  if exists(select 1 from epp_payment_orders where shooter_id=p_shooter and match_id=p_match and status in('creating','open','pending','review')) then raise exception 'betaling_loopt_al';end if;
  if not(select payment_required from epp_matches where id=p_match) then return;end if;
  if jsonb_array_length(p_choices)=0 then
    update epp_payment_orders set registration_canceled=true where match_id=p_match and shooter_id=p_shooter and status='paid';
    return;
  end if;
  select jsonb_agg(d.discipline order by d.discipline) into paid_choices from epp_signup_disciplines d join epp_signups s on s.id=d.signup_id where s.match_id=p_match and s.shooter_id=p_shooter;
  if paid_choices=(select jsonb_agg(value->>'discipline' order by value->>'discipline') from jsonb_array_elements(p_choices))
    and exists(select 1 from epp_payment_orders where match_id=p_match and shooter_id=p_shooter and status='paid') then return;end if;
  raise exception 'betaling_verplicht';
end $$;

-- Pending reservations survive edits to the planner and count toward capacity.
create function public.epp_payment_protect_slot() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if epp_payment_holds(old.id)>0 then
    if tg_op='DELETE' then raise exception 'tijdslot_betaling_loopt';end if;
    if new.id<>old.id or new.match_id<>old.match_id or new.starts_at<>old.starts_at or new.ends_at<>old.ends_at or new.capacity<epp_payment_holds(old.id)+(select count(*) from epp_signup_disciplines where slot_id=old.id) then raise exception 'tijdslot_betaling_loopt';end if;
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger epp_payment_protect_slot before update or delete on public.epp_match_slots for each row execute function public.epp_payment_protect_slot();

do $$declare definition text;anchor text;begin
  definition:=pg_get_functiondef('public.epp_planner_book(uuid,uuid,uuid,jsonb,integer,text)'::regprocedure);
  -- Serialize the match before taking a shooter lock, consistently with reserve
  -- and settlement. Avoid a shared-lock upgrade cycle during simultaneous calls.
  definition:=replace(definition,'perform 1 from epp_matches where id=p_match for share;','perform 1 from epp_matches where id=p_match for update;');
  anchor:='if not managing and (not p.published or now()<p.opens_at or now()>p.closes_at) then raise exception ''inschrijving_gesloten'';end if;';
  if position(anchor in definition)=0 then raise exception 'Expected booking guard missing';end if;
  -- Settled payment may arrive after closing; it has already reserved its slots.
  definition:=replace(definition,anchor,'perform epp_payment_booking_guard(p_match,p_shooter,p_choices);'||E'\n  if nullif(current_setting(''epp.payment_order'',true),'''') is null then '||anchor||' end if;');
  anchor:='if slot.blocked and not exists';
  if position(anchor in definition)=0 then raise exception 'Expected block guard missing';end if;
  definition:=replace(definition,anchor,'if slot.blocked and nullif(current_setting(''epp.payment_order'',true),'''') is null and not exists');
  anchor:='if (select count(*) from epp_signup_disciplines where slot_id=slot.id and signup_id is distinct from old.id)>=slot.capacity';
  if position(anchor in definition)=0 then raise exception 'Expected capacity guard missing';end if;
  definition:=replace(definition,anchor,'if (select count(*) from epp_signup_disciplines where slot_id=slot.id and signup_id is distinct from old.id)+epp_payment_holds(slot.id,nullif(current_setting(''epp.payment_order'',true),'''')::uuid)>=slot.capacity');
  execute definition;
end $$;

do $$declare f record;begin
  for f in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and proname in('epp_payment_holds','epp_payment_configure','epp_payment_reserve','epp_payment_apply','epp_payment_retry_review','epp_payment_booking_guard','epp_payment_protect_slot') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to service_role',f.sig);
  end loop;
end $$;

-- Existing backup snapshots automatically include the new slot columns. Also
-- capture payment records and encrypted account credentials, never OAuth state.
alter function public.epp_capture_backup() rename to epp_capture_backup_before_payments;
create function public.epp_capture_backup() returns uuid language plpgsql security definer set search_path=public as $$
declare bid uuid;begin
  bid:=epp_capture_backup_before_payments();
  update platform_backups set snapshot=snapshot||jsonb_build_object('epp_payment_accounts',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from epp_payment_accounts a),'epp_payment_orders',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from epp_payment_orders o),'epp_payment_audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from epp_payment_audit a)) where id=bid;
  update platform_backups set checksum=encode(extensions.digest(snapshot::text,'sha256'),'hex') where id=bid;
  return bid;
end $$;
revoke all on function public.epp_capture_backup() from public,anon,authenticated;
grant execute on function public.epp_capture_backup() to service_role;

-- The supplied 2027 EPP calendar offers exactly Standaard and Optics. This adds
-- the second option without moving existing slots or enabling payments.
update public.epp_matches set offered_disciplines=array['pistool','optiek']
where archived_at is null and offered_disciplines=array['pistool']
  and (club_id,match_date) in (('apgs','2027-02-27'::date),('maarheeze','2027-04-10'::date),('svbb','2027-05-28'::date),('politienoordholland','2027-09-25'::date),('hansi','2027-10-09'::date),('dekorrel','2027-11-13'::date));
commit;
