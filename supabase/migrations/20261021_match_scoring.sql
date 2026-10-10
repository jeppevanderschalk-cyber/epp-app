begin;
create table public.epp_scoring_matches (
  match_id uuid primary key references epp_matches(id),
  organizer text not null,match_date date not null,owner_club text not null references clubs(code),
  closed boolean not null default false,revision integer not null default 1,
  unique(organizer,match_date)
);
create table public.epp_match_scorers (
  match_id uuid references epp_scoring_matches(match_id),account_id uuid references app_accounts(id),
  primary key(match_id,account_id)
);
create table public.epp_score_leases (
  match_id uuid references epp_scoring_matches(match_id),shooter_id uuid references shooters(id),
  discipline text not null check(discipline in ('pistool','optiek')),
  actor_id uuid not null references app_accounts(id),token uuid not null,expires_at timestamptz not null,
  primary key(match_id,shooter_id,discipline)
);
create table public.epp_scoring_audit (
  id uuid primary key default gen_random_uuid(),match_id uuid not null references epp_scoring_matches(match_id),
  actor_id uuid not null references app_accounts(id),action text not null,before_data jsonb,after_data jsonb,
  created_at timestamptz not null default now()
);
alter table epp_scoring_matches enable row level security;
alter table epp_match_scorers enable row level security;
alter table epp_score_leases enable row level security;
alter table epp_scoring_audit enable row level security;
revoke all on epp_scoring_matches,epp_match_scorers,epp_score_leases,epp_scoring_audit from anon,authenticated;
grant all on epp_scoring_matches,epp_match_scorers,epp_score_leases,epp_scoring_audit to service_role;

create function public.epp_scoring_allowed(p_actor uuid,p_match uuid,p_manage boolean default false)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from app_accounts a join epp_scoring_matches m on m.match_id=p_match
    where a.id=p_actor and a.active and not a.must_change_password and
    ((a.role='trainer' and a.is_admin and a.club_code=m.owner_club)
      or (not p_manage and exists(select 1 from epp_match_scorers s where s.match_id=m.match_id and s.account_id=a.id))))
$$;

create function public.epp_scoring_prepare(p_actor uuid,p_match uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a app_accounts;m epp_matches;state epp_scoring_matches;ev uuid;rnd uuid;sid uuid;rid uuid;cid uuid;
begin
  select * into a from app_accounts where id=p_actor and active and not must_change_password;
  select * into m from epp_matches where id=p_match;
  if a.id is null or m.id is null then raise exception 'geen_toegang';end if;
  perform pg_advisory_xact_lock(hashtextextended('scoring:'||m.organizer||m.match_date::text,0));
  select * into state from epp_scoring_matches where organizer=m.organizer and match_date=m.match_date;
  if state.match_id is null then
    if not (a.role='trainer' and a.is_admin) or not exists(select 1 from epp_match_planners p where p.match_id=m.id and p.owner_club=a.club_code and p.published) then raise exception 'publiceer_eerst_wedstrijdplanner';end if;
    if exists(select 1 from epp_match_planners p join epp_matches other on other.id=p.match_id where other.organizer=m.organizer and other.match_date=m.match_date and p.published and p.owner_club<>a.club_code) then raise exception 'andere_organisator';end if;
    insert into epp_scoring_matches(match_id,organizer,match_date,owner_club) values(m.id,m.organizer,m.match_date,a.club_code) returning * into state;
    insert into epp_scoring_audit(match_id,actor_id,action,after_data)values(m.id,a.id,'open',to_jsonb(state));
  end if;
  if not epp_scoring_allowed(a.id,state.match_id) then raise exception 'geen_wedstrijdrechten';end if;
  select id into cid from clubs where code=state.owner_club;
  insert into seasons(naam,start_date,end_date,ranking_version)values(extract(year from m.match_date)::text,date_trunc('year',m.match_date)::date,(date_trunc('year',m.match_date)+interval '1 year - 1 day')::date,'EPP_TIEBREAK_V2')on conflict(naam)do nothing;
  select id into sid from seasons where naam=extract(year from m.match_date)::text;
  select id into rid from rule_profiles where version='EPP_PISTOL_250_V1';
  if rid is null then raise exception 'regelprofiel_ontbreekt';end if;
  insert into events(registration_match_id,organizer_club_id,season_id,naam,type,local_date,rule_profile_id,ranking_eligible)
    values(state.match_id,cid,sid,m.organizer||' - '||m.match_date,'wedstrijd',m.match_date,rid,true)on conflict(registration_match_id)where registration_match_id is not null do nothing;
  select id into ev from events where registration_match_id=state.match_id;
  select id into rnd from rounds where event_id=ev order by created_at,id limit 1;
  if rnd is null then insert into rounds(event_id,label)values(ev,'Wedstrijdscore')returning id into rnd;end if;
  return jsonb_build_object('matchId',state.match_id,'roundId',rnd,'closed',state.closed,'revision',state.revision,'managing',epp_scoring_allowed(a.id,state.match_id,true));
end $$;

create function public.epp_scoring_control(p_actor uuid,p_match uuid,p_action text,p_target uuid default null,p_enabled boolean default false,p_expected integer default 0)
returns void language plpgsql security definer set search_path=public as $$
declare state epp_scoring_matches;before_value jsonb;
begin
  select * into state from epp_scoring_matches where match_id=p_match for update;
  if not epp_scoring_allowed(p_actor,p_match,true)then raise exception 'geen_beheerrechten';end if;
  if state.revision<>p_expected then raise exception 'wedstrijd_conflict';end if;
  before_value:=jsonb_build_object('state',to_jsonb(state),'scorers',(select coalesce(jsonb_agg(account_id),'[]')from epp_match_scorers where match_id=p_match));
  if p_action='scorer' then
    if p_enabled then
      if not exists(select 1 from app_accounts where id=p_target and active and username like 'lid.%' and not must_change_password)then raise exception 'persoonlijk_account_verplicht';end if;
      insert into epp_match_scorers values(p_match,p_target)on conflict do nothing;
    else delete from epp_match_scorers where match_id=p_match and account_id=p_target;
      delete from epp_score_leases where match_id=p_match and actor_id=p_target;
    end if;
  elsif p_action='close' then
    if not p_enabled then raise exception 'uitslag_definitief';end if;
    if exists(select 1 from epp_score_leases where match_id=p_match and expires_at>now())then raise exception 'invoer_nog_actief';end if;
    update epp_scoring_matches set closed=true where match_id=p_match;
  else raise exception 'onbekende_actie';end if;
  update epp_scoring_matches set revision=revision+1 where match_id=p_match;
  insert into epp_scoring_audit(match_id,actor_id,action,before_data,after_data)values(p_match,p_actor,p_action,before_value,jsonb_build_object('target',p_target,'enabled',p_enabled));
end $$;

create function public.epp_scoring_lease(p_actor uuid,p_match uuid,p_shooter uuid,p_discipline text,p_token uuid,p_release boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare state epp_scoring_matches;lease epp_score_leases;
begin
  select * into state from epp_scoring_matches where match_id=p_match for share;
  if not epp_scoring_allowed(p_actor,p_match)then raise exception 'geen_wedstrijdrechten';end if;
  if p_release then
    delete from epp_score_leases where match_id=p_match and shooter_id=p_shooter and discipline=p_discipline and actor_id=p_actor and token=p_token;
    return jsonb_build_object('released',true);
  end if;
  if state.closed then raise exception 'uitslag_definitief';end if;
  if p_token is null or p_discipline not in ('pistool','optiek') or not exists(select 1 from epp_signups s join epp_signup_disciplines d on d.signup_id=s.id where s.match_id=p_match and s.shooter_id=p_shooter and d.discipline=p_discipline)then raise exception 'schutter_niet_ingeschreven';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_match::text||p_shooter::text||p_discipline,0));
  select * into lease from epp_score_leases where match_id=p_match and shooter_id=p_shooter and discipline=p_discipline for update;
  if lease.expires_at>now() and (lease.actor_id<>p_actor or lease.token<>p_token)then raise exception 'schutter_in_bewerking';end if;
  insert into epp_score_leases values(p_match,p_shooter,p_discipline,p_actor,p_token,now()+interval '90 seconds')
    on conflict(match_id,shooter_id,discipline)do update set actor_id=excluded.actor_id,token=excluded.token,expires_at=excluded.expires_at returning * into lease;
  return to_jsonb(lease);
end $$;

-- Preserve score validation and revision/audit handling; expand only match-scoped authorization.
do $$
declare definition text;old_auth text;new_auth text;old_membership text;new_membership text;
begin
  definition:=pg_get_functiondef('public.epp_confirm_result(uuid,uuid,uuid,uuid,uuid,jsonb,text,integer,text)'::regprocedure);
  old_auth:='if not exists(select 1 from app_accounts a join clubs c on c.code=a.club_code where a.id=p_actor and c.id=p_club and a.active and a.role=''trainer'') then raise exception ''geen_schrijfrechten'';end if;';
  new_auth:='if exists(select 1 from rounds r join events e on e.id=r.event_id join epp_matches m on m.id=e.registration_match_id join epp_scoring_matches sm on sm.organizer=m.organizer and sm.match_date=m.match_date where r.id=p_round) then
    if not exists(select 1 from rounds r join events e on e.id=r.event_id join epp_scoring_matches sm on sm.match_id=e.registration_match_id join clubs c on c.code=sm.owner_club where r.id=p_round and c.id=p_club and not sm.closed and epp_scoring_allowed(p_actor,sm.match_id))then raise exception ''geen_wedstrijdrechten'';end if;
    if not exists(select 1 from rounds r join events e on e.id=r.event_id join epp_score_leases l on l.match_id=e.registration_match_id join divisions d on d.id=p_division where r.id=p_round and l.shooter_id=p_shooter and l.discipline=case d.naam when ''Open'' then ''optiek'' else ''pistool'' end and l.actor_id=p_actor and l.expires_at>now() and l.token::text=current_setting(''epp.scoring_token'',true))then raise exception ''reservering_verlopen'';end if;
  else '||old_auth||' end if;';
  old_membership:='if old.id is null and not exists(select 1 from epp_signups s join epp_signup_disciplines d on d.signup_id=s.id where s.match_id=planned_match and s.shooter_id=p_shooter and d.discipline=discipline_code and d.slot_id is not null)';
  new_membership:=replace(old_membership,' and d.slot_id is not null','');
  if position(old_auth in definition)=0 or position(old_membership in definition)=0 then raise exception 'onverwachte_scorefunctie';end if;
  execute replace(replace(definition,old_auth,new_auth),old_membership,new_membership);
end $$;

create function public.epp_scoring_submit(p_actor uuid,p_match uuid,p_shooter uuid,p_discipline text,p_token uuid,p_counts jsonb,p_key text,p_expected integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare state epp_scoring_matches;cid uuid;rnd uuid;div uuid;saved results;result jsonb;
begin
  select * into state from epp_scoring_matches where match_id=p_match for share;
  if not epp_scoring_allowed(p_actor,p_match)then raise exception 'geen_wedstrijdrechten';end if;
  if p_discipline not in ('pistool','optiek')then raise exception 'ongeldige_discipline';end if;
  select r.id into rnd from rounds r join events e on e.id=r.event_id where e.registration_match_id=p_match order by r.created_at,r.id limit 1;
  select id into div from divisions where naam=case p_discipline when 'optiek' then 'Open' else 'EPP pistool' end;
  select id into cid from clubs where code=state.owner_club;
  perform pg_advisory_xact_lock(hashtextextended(rnd::text||p_shooter::text,0));
  select * into saved from results where idempotency_key=p_key;
  if saved.id is not null then
    if saved.round_id<>rnd or saved.shooter_id<>p_shooter or saved.division_id<>div or saved.confirmed_by<>p_actor then raise exception 'ongeldige_herhaling';end if;
    return to_jsonb(saved);
  end if;
  if state.closed then raise exception 'uitslag_definitief';end if;
  perform epp_scoring_lease(p_actor,p_match,p_shooter,p_discipline,p_token);
  perform set_config('epp.scoring_token',p_token::text,true);
  result:=epp_confirm_timed_result(p_actor,cid,rnd,p_shooter,div,p_counts,p_key,p_expected,p_reason);
  delete from epp_score_leases where match_id=p_match and shooter_id=p_shooter and discipline=p_discipline and actor_id=p_actor and token=p_token;
  return result;
end $$;

alter function public.epp_capture_backup() rename to epp_capture_backup_before_scoring;
create function public.epp_capture_backup()returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare bid uuid;snap jsonb;
begin
  bid:=epp_capture_backup_before_scoring();
  select snapshot into snap from platform_backups where id=bid;
  snap:=snap||jsonb_build_object('epp_scoring_matches',(select coalesce(jsonb_agg(t),'[]')from epp_scoring_matches t),'epp_match_scorers',(select coalesce(jsonb_agg(t),'[]')from epp_match_scorers t),'epp_scoring_audit',(select coalesce(jsonb_agg(t),'[]')from epp_scoring_audit t));
  update platform_backups set snapshot=snap,checksum=encode(digest(snap::text,'sha256'),'hex')where id=bid;
  return bid;
end $$;
revoke all on function epp_capture_backup()from public,anon,authenticated;
grant execute on function epp_capture_backup()to service_role;
revoke all on function epp_scoring_allowed(uuid,uuid,boolean),epp_scoring_prepare(uuid,uuid),epp_scoring_control(uuid,uuid,text,uuid,boolean,integer),epp_scoring_lease(uuid,uuid,uuid,text,uuid,boolean),epp_scoring_submit(uuid,uuid,uuid,text,uuid,jsonb,text,integer,text)from public,anon,authenticated;
grant execute on function epp_scoring_allowed(uuid,uuid,boolean),epp_scoring_prepare(uuid,uuid),epp_scoring_control(uuid,uuid,text,uuid,boolean,integer),epp_scoring_lease(uuid,uuid,uuid,text,uuid,boolean),epp_scoring_submit(uuid,uuid,uuid,text,uuid,jsonb,text,integer,text)to service_role;
commit;
