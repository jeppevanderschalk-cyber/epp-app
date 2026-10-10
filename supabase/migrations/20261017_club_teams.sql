begin;
create table public.epp_teams (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.epp_matches(id),
  discipline text not null check(discipline in ('pistool','optiek','pcc')),
  club_id uuid not null references public.clubs(id),
  number integer not null check(number between 1 and 99),
  revision integer not null default 1,
  updated_by uuid not null references public.app_accounts(id),
  updated_at timestamptz not null default now(),
  unique(match_id,discipline,club_id,number),
  unique(id,match_id,discipline)
);
create table public.epp_team_members (
  team_id uuid not null,
  match_id uuid not null,
  discipline text not null,
  shooter_id uuid not null references public.shooters(id),
  foreign key(team_id,match_id,discipline) references public.epp_teams(id,match_id,discipline) on delete cascade,
  primary key(team_id,shooter_id),
  unique(match_id,discipline,shooter_id)
);
create table public.epp_team_audit (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  actor_id uuid not null references public.app_accounts(id),
  before_data jsonb,after_data jsonb,
  created_at timestamptz not null default now()
);
alter table public.epp_teams enable row level security;
alter table public.epp_team_members enable row level security;
alter table public.epp_team_audit enable row level security;
revoke all on public.epp_teams,public.epp_team_members,public.epp_team_audit from anon,authenticated;
grant all on public.epp_teams,public.epp_team_members,public.epp_team_audit to service_role;

create function public.epp_team_match(p_match uuid) returns uuid language sql stable set search_path=public as $$
  select c.id from epp_matches m join epp_matches c on c.organizer=m.organizer and c.match_date=m.match_date
  where m.id=p_match order by exists(select 1 from epp_teams t where t.match_id=c.id) desc,c.id limit 1
$$;

create function public.epp_team_save(p_actor uuid,p_match uuid,p_discipline text,p_team uuid,p_number integer,p_members uuid[],p_expected integer,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a app_accounts;cid uuid;mid uuid;m epp_matches;old epp_teams;before_state jsonb;after_state jsonb;
begin
  select * into a from app_accounts where id=p_actor and active and role='trainer' and is_admin and not must_change_password;
  if a.id is null then raise exception 'geen_beheerrechten';end if;
  select id into cid from clubs where code=a.club_code;
  mid:=epp_team_match(p_match);
  select * into m from epp_matches where id=mid;
  if mid is null or p_discipline is null or p_discipline not in ('pistool','optiek','pcc') or not p_discipline=any(m.offered_disciplines) then raise exception 'ongeldige_wedstrijd_of_discipline';end if;
  perform pg_advisory_xact_lock(hashtextextended(mid::text||p_discipline,0));
  select * into old from epp_teams where id=p_team for update;
  if old.id is not null and (old.club_id<>cid or old.match_id<>mid or old.discipline<>p_discipline) then raise exception 'geen_beheerrechten';end if;
  if coalesce(old.revision,0) is distinct from p_expected then raise exception 'team_conflict';end if;
  if old.id is not null then
    select to_jsonb(old)||jsonb_build_object('members',(select jsonb_agg(shooter_id order by shooter_id) from epp_team_members where team_id=old.id)) into before_state;
    if exists(select 1 from epp_team_members tm join results r on r.shooter_id=tm.shooter_id join rounds rd on rd.id=r.round_id join events e on e.id=rd.event_id join divisions d on d.id=r.division_id
      where tm.team_id=old.id and r.status='confirmed' and r.represented_club_id=old.club_id and e.ranking_eligible and d.naam=case p_discipline when 'optiek' then 'Open' when 'pcc' then 'PCC' else 'EPP pistool' end and epp_team_match(e.registration_match_id)=mid)
      then raise exception 'team_vast_na_score';end if;
  end if;
  if p_delete then
    if old.id is null then raise exception 'team_niet_gevonden';end if;
    delete from epp_teams where id=p_team;
  else
    if p_number is null or p_number not between 1 and 99 or cardinality(p_members) is distinct from 4 or (select count(distinct x) from unnest(p_members) x)<>4 then raise exception 'vier_unieke_schutters_verplicht';end if;
    if exists(select 1 from unnest(p_members) sid where not exists(select 1 from memberships where shooter_id=sid and club_id=cid and valid_from<=m.match_date and (valid_until is null or valid_until>=m.match_date))) then raise exception 'schutter_niet_van_vereniging';end if;
    if exists(select 1 from epp_team_members where match_id=mid and discipline=p_discipline and shooter_id=any(p_members) and team_id<>p_team) then raise exception 'schutter_al_in_team';end if;
    insert into epp_teams(id,match_id,discipline,club_id,number,updated_by)
    values(p_team,mid,p_discipline,cid,p_number,p_actor)
    on conflict(id) do update set number=excluded.number,revision=epp_teams.revision+1,updated_by=p_actor,updated_at=now();
    delete from epp_team_members where team_id=p_team;
    insert into epp_team_members(team_id,match_id,discipline,shooter_id) select p_team,mid,p_discipline,x from unnest(p_members) x;
    select to_jsonb(t)||jsonb_build_object('members',to_jsonb(p_members)) into after_state from epp_teams t where id=p_team;
  end if;
  insert into epp_team_audit(team_id,actor_id,before_data,after_data) values(p_team,p_actor,before_state,after_state);
  return jsonb_build_object('ok',true,'team',after_state);
end $$;

create function public.epp_team_context(p_actor uuid,p_match uuid default null,p_discipline text default 'pistool')
returns jsonb language plpgsql security definer set search_path=public as $$
declare a app_accounts;mid uuid;catalog jsonb;directory jsonb;standings jsonb;
begin
  select * into a from app_accounts where id=p_actor and active and not must_change_password;
  if a.id is null then raise exception 'geen_toegang';end if;
  if p_discipline not in ('pistool','optiek','pcc') then raise exception 'ongeldige_discipline';end if;
  mid:=epp_team_match(p_match);
  select coalesce(jsonb_agg(t order by t.match_date,t.organizer),'[]') into catalog from (
    select distinct on(organizer,match_date) id,organizer,match_date,offered_disciplines from epp_matches order by organizer,match_date,id
  ) t;
  select coalesce(jsonb_agg(t order by t.name),'[]') into directory from (
    select s.id,s.public_id as "publicId",s.display_name as name,
      coalesce((select jsonb_agg(distinct jsonb_build_object('id',c.id,'code',c.code,'name',c.naam)) from memberships mb join clubs c on c.id=mb.club_id where mb.shooter_id=s.id and mb.valid_from<=coalesce((select match_date from epp_matches where id=mid),current_date) and (mb.valid_until is null or mb.valid_until>=coalesce((select match_date from epp_matches where id=mid),current_date))),'[]') as clubs
    from shooters s
  ) t;
  with member_scores as (
    select tm.team_id,s.id,s.display_name,s.public_id,r.final_score,r.hits5,r.rapid_score,r.rapid_time_ms,r.total_time_ms,
      r.id as result_id
    from epp_team_members tm join epp_teams t on t.id=tm.team_id join shooters s on s.id=tm.shooter_id
    left join lateral (
      select r.* from results r join rounds rd on rd.id=r.round_id join events e on e.id=rd.event_id join divisions d on d.id=r.division_id
      where r.shooter_id=s.id and r.represented_club_id=t.club_id and r.status='confirmed' and e.ranking_eligible
        and epp_team_match(e.registration_match_id)=mid and d.naam=case p_discipline when 'optiek' then 'Open' when 'pcc' then 'PCC' else 'EPP pistool' end
      order by r.final_score desc,r.hits5 desc nulls last,r.rapid_score desc nulls last,r.rapid_time_ms asc nulls last,r.total_time_ms asc nulls last,r.id limit 1
    ) r on true where t.match_id=mid and t.discipline=p_discipline
  ), totals as (
    select t.id,t.number,t.revision,c.code as "clubCode",c.naam as club,
      count(ms.result_id)::integer as completed,coalesce(sum(ms.final_score),0)::integer as score,
      sum(ms.hits5) as hits5,sum(ms.rapid_score) as rapid_score,
      case when count(ms.rapid_time_ms)=4 then sum(ms.rapid_time_ms) end as rapid_time,
      case when count(ms.total_time_ms)=4 then sum(ms.total_time_ms) end as total_time,
      jsonb_agg(jsonb_build_object('id',ms.id,'name',ms.display_name,'publicId',ms.public_id,'club',c.naam,'score',ms.final_score) order by ms.display_name) as members,
      exists(select 1 from member_scores lock_scores where lock_scores.team_id=t.id and lock_scores.result_id is not null) as locked
    from epp_teams t join clubs c on c.id=t.club_id join member_scores ms on ms.team_id=t.id
    group by t.id,c.code,c.naam
  ), ranked as (
    select *,case when completed=4 then dense_rank() over(partition by completed order by score desc) end as position
    from totals
  ) select coalesce(jsonb_agg(to_jsonb(r) order by (completed=4) desc,position nulls last,club,number),'[]') into standings from ranked r;
  return jsonb_build_object('ok',true,'matches',catalog,'matchId',mid,'shooters',directory,'teams',standings,'canManage',a.role='trainer' and a.is_admin,'clubCode',a.club_code);
end $$;
revoke all on function public.epp_team_match(uuid),public.epp_team_save(uuid,uuid,text,uuid,integer,uuid[],integer,boolean),public.epp_team_context(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.epp_team_match(uuid),public.epp_team_save(uuid,uuid,text,uuid,integer,uuid[],integer,boolean),public.epp_team_context(uuid,uuid,text) to service_role;

create function public.epp_backup_teams() returns trigger language plpgsql set search_path=public,extensions as $$
begin
  new.snapshot:=new.snapshot||jsonb_build_object('epp_teams',(select coalesce(jsonb_agg(t),'[]') from epp_teams t),'epp_team_members',(select coalesce(jsonb_agg(t),'[]') from epp_team_members t),'epp_team_audit',(select coalesce(jsonb_agg(t),'[]') from epp_team_audit t));
  new.checksum:=encode(digest(new.snapshot::text,'sha256'),'hex');return new;
end $$;
create trigger epp_backup_teams before insert on public.platform_backups for each row execute function public.epp_backup_teams();
commit;
