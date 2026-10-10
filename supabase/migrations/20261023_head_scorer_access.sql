begin;
create or replace function public.epp_scoring_allowed(p_actor uuid,p_match uuid,p_manage boolean default false)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from app_accounts a join epp_scoring_matches m on m.match_id=p_match
    where a.id=p_actor and a.active and not a.must_change_password and
    ((a.role='trainer' and a.is_admin and (a.club_code=m.owner_club or a.is_platform_admin))
      or (not p_manage and exists(select 1 from epp_match_scorers s where s.match_id=m.match_id and s.account_id=a.id))))
$$;

create or replace function public.epp_scoring_prepare(p_actor uuid,p_match uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a app_accounts;m epp_matches;state epp_scoring_matches;ev uuid;rnd uuid;sid uuid;rid uuid;cid uuid;owner text;
begin
  select * into a from app_accounts where id=p_actor and active and not must_change_password;
  select * into m from epp_matches where id=p_match;
  if a.id is null or m.id is null then raise exception 'geen_toegang';end if;
  perform pg_advisory_xact_lock(hashtextextended('scoring:'||m.organizer||m.match_date::text,0));
  select * into state from epp_scoring_matches where organizer=m.organizer and match_date=m.match_date;
  if state.match_id is null then
    select p.owner_club into owner from epp_match_planners p where p.match_id=m.id and p.published;
    if not (a.role='trainer' and a.is_admin) or owner is null or not (a.club_code=owner or a.is_platform_admin) then raise exception 'publiceer_eerst_wedstrijdplanner';end if;
    if exists(select 1 from epp_match_planners p join epp_matches other on other.id=p.match_id where other.organizer=m.organizer and other.match_date=m.match_date and p.published and p.owner_club<>owner) then raise exception 'andere_organisator';end if;
    insert into epp_scoring_matches(match_id,organizer,match_date,owner_club) values(m.id,m.organizer,m.match_date,owner) returning * into state;
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

-- Definitive results allow revocation, but not new scorer assignments.
do $$
declare definition text;old text:='if p_enabled then';
begin
  select pg_get_functiondef('public.epp_scoring_control(uuid,uuid,text,uuid,boolean,integer)'::regprocedure) into definition;
  if position(old in definition)=0 then raise exception 'scoring_control_onverwacht';end if;
  execute replace(definition,old,old||E'\n      if state.closed then raise exception ''uitslag_definitief'';end if;');
end $$;
commit;
