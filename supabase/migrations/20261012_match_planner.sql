begin;
create table public.epp_match_planners (
  match_id uuid primary key references public.epp_matches(id) on delete cascade,
  owner_club text not null references public.clubs(code),
  config jsonb not null,
  revision integer not null default 1,
  published boolean not null default false,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  min_gap integer not null default 0 check(min_gap between 0 and 180),
  updated_by uuid not null references public.app_accounts(id),
  updated_at timestamptz not null default now(),
  check(opens_at<closes_at)
);
create table public.epp_match_slots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.epp_match_planners(match_id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check(capacity between 1 and 100),
  unique(match_id,starts_at),check(ends_at>starts_at)
);
alter table public.epp_signup_disciplines add column slot_id uuid references public.epp_match_slots(id) on delete restrict;
alter table public.epp_signups add column planner_revision integer not null default 0;
create index epp_signup_slot_idx on public.epp_signup_disciplines(slot_id);
create table public.epp_planner_audit (
  id uuid primary key default gen_random_uuid(),match_id uuid not null,
  actor_id uuid not null references public.app_accounts(id),action text not null,
  before_data jsonb,after_data jsonb,reason text,created_at timestamptz not null default now()
);
alter table public.epp_match_planners enable row level security;
alter table public.epp_match_slots enable row level security;
alter table public.epp_planner_audit enable row level security;
revoke all on public.epp_match_planners,public.epp_match_slots,public.epp_planner_audit from anon,authenticated;
grant all on public.epp_match_planners,public.epp_match_slots,public.epp_planner_audit to service_role;

create function public.epp_planner_configure(p_actor uuid,p_match uuid,p_config jsonb,p_expected integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a app_accounts;m epp_matches;old epp_match_planners;first_min integer;last_min integer;duration integer;changeover integer;cap integer;gap integer;op timestamptz;cl timestamptz;generated jsonb;before_value jsonb;
begin
  select * into a from app_accounts where id=p_actor and active and role='trainer' and is_admin;
  if a.id is null then raise exception 'geen_beheerrechten';end if;
  select * into m from epp_matches where id=p_match and club_id=a.club_code for update;
  if m.id is null or m.match_date is null then raise exception 'wedstrijd_niet_gevonden';end if;
  select * into old from epp_match_planners where match_id=p_match for update;
  if coalesce(old.revision,0)<>p_expected then
    if old.config=p_config then return to_jsonb(old);end if;
    raise exception 'planning_conflict';
  end if;
  if p_config->>'first' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_config->>'last' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'ongeldige_planning';end if;
  first_min:=extract(hour from (p_config->>'first')::time)*60+extract(minute from (p_config->>'first')::time);
  last_min:=extract(hour from (p_config->>'last')::time)*60+extract(minute from (p_config->>'last')::time);
  duration:=(p_config->>'duration')::integer;changeover:=(p_config->>'changeover')::integer;cap:=(p_config->>'capacity')::integer;gap:=(p_config->>'gap')::integer;
  op:=case when p_config->>'opens' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then (p_config->>'opens')::timestamp at time zone 'Europe/Amsterdam' else (p_config->>'opens')::timestamptz end;
  cl:=case when p_config->>'closes' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then (p_config->>'closes')::timestamp at time zone 'Europe/Amsterdam' else (p_config->>'closes')::timestamptz end;
  if first_min is null or last_min is null or first_min>last_min or duration is null or duration not between 1 and 180 or changeover is null or changeover not between 0 and 180 or cap is null or cap not between 1 and 100 or gap is null or gap not between 0 and 180 or last_min+duration>1440 or op is null or cl is null or cl<=op or cl>((m.match_date::timestamp+make_interval(mins=>last_min)) at time zone 'Europe/Amsterdam') then raise exception 'ongeldige_planning';end if;
  if (last_min-first_min)%(duration+changeover)<>0 then raise exception 'laatste_ronde_sluit_niet_aan';end if;
  if jsonb_typeof(p_config->'breaks') is distinct from 'array' or jsonb_typeof(p_config->'overrides') is distinct from 'array' then raise exception 'ongeldige_planning';end if;
  if exists(select 1 from jsonb_array_elements(p_config->'breaks') b where b->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or b->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or b->>'start'>=b->>'end' or b->>'start' is null or b->>'end' is null) then raise exception 'ongeldige_pauze';end if;
  if exists(select 1 from jsonb_array_elements(p_config->'overrides') o where o->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (o->>'capacity')::integer not between 1 and 100 or o->>'capacity' is null or o->>'start' is null) then raise exception 'ongeldige_capaciteit';end if;
  select coalesce(jsonb_agg(jsonb_build_object('start',t,'end',t+make_interval(mins=>duration),'capacity',coalesce((select (o->>'capacity')::integer from jsonb_array_elements(p_config->'overrides') o where o->>'start'=to_char(t at time zone 'Europe/Amsterdam','HH24:MI') limit 1),cap))),'[]') into generated
  from (select (m.match_date::timestamp+make_interval(mins=>x)) at time zone 'Europe/Amsterdam' t from generate_series(first_min,last_min,duration+changeover) x) times
  where not exists(select 1 from jsonb_array_elements(p_config->'breaks') b where t<((m.match_date+(b->>'end')::time) at time zone 'Europe/Amsterdam') and t+make_interval(mins=>duration)>((m.match_date+(b->>'start')::time) at time zone 'Europe/Amsterdam'));
  if jsonb_array_length(generated)=0 then raise exception 'geen_tijdsloten';end if;
  if (select count(distinct o->>'start') from jsonb_array_elements(p_config->'overrides') o)<>jsonb_array_length(p_config->'overrides') or exists(select 1 from jsonb_array_elements(p_config->'overrides') o where not exists(select 1 from jsonb_array_elements(generated) g where to_char((g->>'start')::timestamptz at time zone 'Europe/Amsterdam','HH24:MI')=o->>'start')) then raise exception 'ongeldige_capaciteit';end if;
  if exists(select 1 from epp_signups s join epp_signup_disciplines d on d.signup_id=s.id where s.match_id=p_match and d.slot_id is null) then raise exception 'bestaande_inschrijvingen_eerst_plannen';end if;
  if exists(select 1 from epp_match_slots s where s.match_id=p_match and exists(select 1 from epp_signup_disciplines d where d.slot_id=s.id) and not exists(select 1 from jsonb_array_elements(generated) g where (g->>'start')::timestamptz=s.starts_at and (g->>'end')::timestamptz=s.ends_at and (g->>'capacity')::integer>=(select count(*) from epp_signup_disciplines d where d.slot_id=s.id))) then raise exception 'geboekte_tijdsloten_behouden';end if;
  if exists(select 1 from epp_signups su join epp_signup_disciplines d on d.signup_id=su.id join epp_match_slots sl on sl.id=d.slot_id join epp_signups other_signup on other_signup.shooter_id=su.shooter_id join epp_signup_disciplines other_d on other_d.signup_id=other_signup.id and other_d.id<>d.id join epp_match_slots other_sl on other_sl.id=other_d.slot_id join epp_match_planners other_p on other_p.match_id=other_sl.match_id where su.match_id=p_match and sl.starts_at<other_sl.ends_at+make_interval(mins=>greatest(gap,case when other_sl.match_id=p_match then gap else other_p.min_gap end)) and sl.ends_at+make_interval(mins=>greatest(gap,case when other_sl.match_id=p_match then gap else other_p.min_gap end))>other_sl.starts_at) then raise exception 'geboekte_tijdsloten_behouden';end if;
  before_value:=case when old.match_id is not null then to_jsonb(old) end;
  insert into epp_match_planners(match_id,owner_club,config,revision,published,opens_at,closes_at,min_gap,updated_by)
  values(p_match,a.club_code,p_config,coalesce(old.revision,0)+1,coalesce((p_config->>'published')::boolean,false),op,cl,gap,p_actor)
  on conflict(match_id) do update set config=excluded.config,revision=excluded.revision,published=excluded.published,opens_at=op,closes_at=cl,min_gap=gap,updated_by=p_actor,updated_at=now();
  delete from epp_match_slots s where s.match_id=p_match and not exists(select 1 from jsonb_array_elements(generated) g where (g->>'start')::timestamptz=s.starts_at);
  insert into epp_match_slots(match_id,starts_at,ends_at,capacity) select p_match,(g->>'start')::timestamptz,(g->>'end')::timestamptz,(g->>'capacity')::integer from jsonb_array_elements(generated) g
  on conflict(match_id,starts_at) do update set ends_at=excluded.ends_at,capacity=excluded.capacity;
  insert into epp_planner_audit(match_id,actor_id,action,before_data,after_data) select p_match,p_actor,'configure',before_value,to_jsonb(p) from epp_match_planners p where match_id=p_match;
  return (select to_jsonb(p) from epp_match_planners p where match_id=p_match);
end $$;

create function public.epp_planner_book(p_actor uuid,p_match uuid,p_shooter uuid,p_choices jsonb,p_expected integer,p_reason text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare a app_accounts;m epp_matches;p epp_match_planners;s shooters;old epp_signups;sid uuid;choice jsonb;slot epp_match_slots;before_value jsonb;desired jsonb;existing jsonb;managing boolean;
begin
  select * into a from app_accounts where id=p_actor and active;
  if a.id is null then raise exception 'geen_toegang';end if;
  select * into s from shooters where id=p_shooter;
  if s.id is null then raise exception 'schutter_niet_gevonden';end if;
  perform pg_advisory_xact_lock(hashtextextended('planner:'||p_shooter::text,0));
  select * into m from epp_matches where id=p_match for update;
  select * into p from epp_match_planners where match_id=p_match;
  if p.match_id is null then raise exception 'planner_niet_beschikbaar';end if;
  managing:=a.role='trainer' and a.is_admin and a.club_code=p.owner_club;
  if not managing and s.linked_user_id is distinct from a.id then raise exception 'alleen_eigen_inschrijving';end if;
  if managing and s.linked_user_id is distinct from a.id and length(trim(p_reason))<3 then raise exception 'wijzigingsreden_verplicht';end if;
  if jsonb_typeof(p_choices) is distinct from 'array' or jsonb_array_length(p_choices)>3 then raise exception 'ongeldige_boeking';end if;
  select * into old from epp_signups where match_id=p_match and shooter_id=p_shooter for update;
  select coalesce(jsonb_agg(jsonb_build_object('discipline',discipline,'slotId',slot_id) order by discipline),'[]') into existing from epp_signup_disciplines where signup_id=old.id;
  select coalesce(jsonb_agg(value order by value->>'discipline'),'[]') into desired from jsonb_array_elements(p_choices);
  if coalesce(old.planner_revision,0)<>p_expected then
    if existing=desired then return jsonb_build_object('ok',true,'revision',old.planner_revision);end if;
    raise exception 'boeking_conflict';
  end if;
  if not managing and (not p.published or now()<p.opens_at or now()>p.closes_at) then raise exception 'inschrijving_gesloten';end if;
  if (select count(distinct value->>'discipline') from jsonb_array_elements(p_choices))<>jsonb_array_length(p_choices) then raise exception 'dubbele_discipline';end if;
  for choice in select value from jsonb_array_elements(p_choices) loop
    if choice->>'discipline' is null or not(choice->>'discipline'=any(m.offered_disciplines)) then raise exception 'discipline_niet_aangeboden';end if;
    select * into slot from epp_match_slots where id=(choice->>'slotId')::uuid and match_id=p_match;
    if slot.id is null or slot.starts_at<=now() then raise exception 'ongeldig_tijdslot';end if;
    if (select count(*) from epp_signup_disciplines where slot_id=slot.id and signup_id is distinct from old.id)>=slot.capacity then raise exception 'tijdslot_vol';end if;
    if exists(select 1 from epp_signup_disciplines d join epp_signups su on su.id=d.signup_id join epp_match_slots other on other.id=d.slot_id join epp_match_planners op on op.match_id=other.match_id where su.shooter_id=p_shooter and su.match_id<>p_match and slot.starts_at<other.ends_at+make_interval(mins=>greatest(p.min_gap,op.min_gap)) and slot.ends_at+make_interval(mins=>greatest(p.min_gap,op.min_gap))>other.starts_at) then raise exception 'overlappende_boeking';end if;
    if exists(select 1 from jsonb_array_elements(p_choices) c join epp_match_slots other on other.id=(c->>'slotId')::uuid where c->>'discipline'<>choice->>'discipline' and slot.starts_at<other.ends_at+make_interval(mins=>p.min_gap) and slot.ends_at+make_interval(mins=>p.min_gap)>other.starts_at) then raise exception 'overlappende_boeking';end if;
  end loop;
  before_value:=jsonb_build_object('shooterId',p_shooter,'choices',existing,'revision',coalesce(old.planner_revision,0));
  insert into epp_signups(match_id,shooter_id,shooter_name,planner_revision) values(p_match,p_shooter,s.display_name,coalesce(old.planner_revision,0)+1)
  on conflict(match_id,shooter_id) where shooter_id is not null do update set planner_revision=excluded.planner_revision,updated_at=now(),shooter_name=excluded.shooter_name returning id into sid;
  delete from epp_signup_disciplines where signup_id=sid;
  insert into epp_signup_disciplines(signup_id,discipline,time_block,specific_time,slot_id)
  select sid,c->>'discipline',case when extract(hour from sl.starts_at at time zone 'Europe/Amsterdam')<12 then 'ochtend' else 'middag' end,to_char(sl.starts_at at time zone 'Europe/Amsterdam','HH24:MI'),sl.id from jsonb_array_elements(p_choices) c join epp_match_slots sl on sl.id=(c->>'slotId')::uuid;
  insert into epp_planner_audit(match_id,actor_id,action,before_data,after_data,reason) values(p_match,p_actor,case when jsonb_array_length(p_choices)=0 then 'cancel' else 'book' end,before_value,jsonb_build_object('shooterId',p_shooter,'choices',desired,'revision',coalesce(old.planner_revision,0)+1),nullif(trim(p_reason),''));
  update epp_matches set mail_status=case when mail_status='verstuurd' then 'gewijzigd' else mail_status end where id=p_match;
  return jsonb_build_object('ok',true,'revision',coalesce(old.planner_revision,0)+1);
end $$;

-- Older clients must not bypass the planner by writing preference-only signups.
alter function public.epp_signup_save(uuid,text,uuid,uuid,jsonb,boolean) rename to epp_signup_save_legacy;
create function public.epp_signup_save(p_actor uuid,p_club text,p_match uuid,p_shooter uuid,p_disciplines jsonb,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform 1 from epp_matches where id=p_match for update;
  if exists(select 1 from epp_match_planners where match_id=p_match) then raise exception 'gebruik_wedstrijdplanner';end if;
  return epp_signup_save_legacy(p_actor,p_club,p_match,p_shooter,p_disciplines,p_delete);
end $$;
revoke all on function public.epp_signup_save_legacy(uuid,text,uuid,uuid,jsonb,boolean) from service_role;
revoke all on function public.epp_planner_configure(uuid,uuid,jsonb,integer),public.epp_planner_book(uuid,uuid,uuid,jsonb,integer,text),public.epp_signup_save(uuid,text,uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.epp_planner_configure(uuid,uuid,jsonb,integer),public.epp_planner_book(uuid,uuid,uuid,jsonb,integer,text),public.epp_signup_save(uuid,text,uuid,uuid,jsonb,boolean) to service_role;

create function public.epp_planner_protect_match() returns trigger language plpgsql set search_path=public as $$
begin
  if exists(select 1 from epp_signup_disciplines d join epp_signups s on s.id=d.signup_id where s.match_id=old.id and d.slot_id is not null) then
    if tg_op='DELETE' then raise exception 'wedstrijd_heeft_boekingen';end if;
    if new.match_date is distinct from old.match_date or new.club_id<>old.club_id or exists(select 1 from epp_signup_disciplines d join epp_signups s on s.id=d.signup_id where s.match_id=old.id and not(d.discipline=any(new.offered_disciplines))) then raise exception 'geboekte_wedstrijd_behouden';end if;
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger epp_planner_protect_match before update or delete on public.epp_matches for each row execute function public.epp_planner_protect_match();
create function public.epp_backup_planner() returns trigger language plpgsql set search_path=public,extensions as $$
begin
  new.snapshot:=new.snapshot||jsonb_build_object('epp_match_planners',(select coalesce(jsonb_agg(t),'[]') from epp_match_planners t),'epp_match_slots',(select coalesce(jsonb_agg(t),'[]') from epp_match_slots t),'epp_planner_audit',(select coalesce(jsonb_agg(t),'[]') from epp_planner_audit t));
  new.checksum:=encode(digest(new.snapshot::text,'sha256'),'hex');return new;
end $$;
create trigger epp_backup_planner before insert on public.platform_backups for each row execute function public.epp_backup_planner();
commit;
