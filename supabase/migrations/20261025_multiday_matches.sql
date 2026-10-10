begin;
alter table public.epp_matches add column match_dates date[] not null default '{}';
update public.epp_matches set match_dates=array[match_date] where match_date is not null;
create function public.epp_match_dates_normalize() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and new.match_date is distinct from old.match_date and new.match_dates=old.match_dates then
    new.match_dates:=case when new.match_date is null then '{}'::date[] else array[new.match_date] end;
  elsif cardinality(new.match_dates)=0 and new.match_date is not null then new.match_dates:=array[new.match_date];end if;
  if cardinality(new.match_dates)>31 or array_position(new.match_dates,null) is not null or cardinality(new.match_dates)<>(select count(distinct d) from unnest(new.match_dates) d) then raise exception 'ongeldige_wedstrijddagen';end if;
  new.match_dates:=array(select d from unnest(new.match_dates) d order by d);
  new.match_date:=new.match_dates[1];
  return new;
end $$;
create trigger epp_match_dates_normalize before insert or update of match_date,match_dates on public.epp_matches for each row execute function public.epp_match_dates_normalize();
create or replace function public.epp_planner_protect_match() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and exists(select 1 from epp_match_planners where match_id=old.id) and (new.match_date is distinct from old.match_date or new.club_id<>old.club_id or not old.match_dates<@new.match_dates) then raise exception 'planner_datum_eerst_controleren';end if;
  if exists(select 1 from epp_signup_disciplines d join epp_signups s on s.id=d.signup_id where s.match_id=old.id and d.slot_id is not null) then
    if tg_op='DELETE' then raise exception 'wedstrijd_heeft_boekingen';end if;
    if exists(select 1 from epp_signup_disciplines d join epp_signups s on s.id=d.signup_id where s.match_id=old.id and not(d.discipline=any(new.offered_disciplines))) then raise exception 'geboekte_wedstrijd_behouden';end if;
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;

-- Only slot generation changes: existing authorization, revisions, bookings and audit remain intact.
create or replace function public.epp_planner_configure(p_actor uuid,p_match uuid,p_config jsonb,p_expected integer)
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
  if first_min is null or last_min is null or first_min>last_min or duration is null or duration not between 1 and 180 or changeover is null or changeover not between 0 and 180 or cap is null or cap not between 1 and 100 or gap is null or gap not between 0 and 180 or last_min+duration>1440 or op is null or cl is null or cl<=op or cl>((m.match_dates[cardinality(m.match_dates)]::timestamp+make_interval(mins=>last_min)) at time zone 'Europe/Amsterdam') then raise exception 'ongeldige_planning';end if;
  if (last_min-first_min)%(duration+changeover)<>0 then raise exception 'laatste_ronde_sluit_niet_aan';end if;
  if jsonb_typeof(p_config->'breaks') is distinct from 'array' or jsonb_typeof(p_config->'overrides') is distinct from 'array' then raise exception 'ongeldige_planning';end if;
  if exists(select 1 from jsonb_array_elements(p_config->'breaks') b where b->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or b->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or b->>'start'>=b->>'end' or b->>'start' is null or b->>'end' is null) then raise exception 'ongeldige_pauze';end if;
  if exists(select 1 from jsonb_array_elements(p_config->'overrides') o where o->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (o->>'capacity')::integer not between 1 and 100 or o->>'capacity' is null or o->>'start' is null) then raise exception 'ongeldige_capaciteit';end if;
  select coalesce(jsonb_agg(jsonb_build_object('start',t,'end',t+make_interval(mins=>duration),'capacity',coalesce((select (o->>'capacity')::integer from jsonb_array_elements(p_config->'overrides') o where o->>'start'=to_char(t at time zone 'Europe/Amsterdam','HH24:MI') limit 1),cap)) order by t),'[]') into generated
  from (select (day::timestamp+make_interval(mins=>x)) at time zone 'Europe/Amsterdam' t,day from unnest(m.match_dates) day cross join generate_series(first_min,last_min,duration+changeover) x) times
  where not exists(select 1 from jsonb_array_elements(p_config->'breaks') b where t<((day+(b->>'end')::time) at time zone 'Europe/Amsterdam') and t+make_interval(mins=>duration)>((day+(b->>'start')::time) at time zone 'Europe/Amsterdam'));
  if jsonb_array_length(generated)=0 then raise exception 'geen_tijdsloten';end if;
  if (select count(distinct o->>'start') from jsonb_array_elements(p_config->'overrides') o)<>jsonb_array_length(p_config->'overrides') or exists(select 1 from jsonb_array_elements(p_config->'overrides') o where not exists(select 1 from jsonb_array_elements(generated) g where to_char((g->>'start')::timestamptz at time zone 'Europe/Amsterdam','HH24:MI')=o->>'start')) then raise exception 'ongeldige_capaciteit';end if;
  if coalesce((p_config->>'published')::boolean,false) and exists(select 1 from epp_signups s join epp_signup_disciplines d on d.signup_id=s.id where s.match_id=p_match and d.slot_id is null) then raise exception 'bestaande_inschrijvingen_eerst_plannen';end if;
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
commit;
