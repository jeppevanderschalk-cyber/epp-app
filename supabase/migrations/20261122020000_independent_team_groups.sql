begin;
create table public.epp_team_groups(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 80),
 revision integer not null default 1,
 created_at timestamptz not null default now()
);
create unique index epp_team_group_name on public.epp_team_groups(lower(trim(name)));
create table public.epp_team_group_members(
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.epp_team_groups(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 140),
 shooter_id uuid references public.shooters(id),
 unique(group_id,name), unique(group_id,shooter_id)
);
create table public.epp_team_group_audit(
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.epp_team_groups(id),
 actor_id uuid not null references public.app_accounts(id),
 before_data jsonb,after_data jsonb,created_at timestamptz not null default now()
);
alter table public.epp_teams alter column club_id drop not null;
alter table public.epp_teams add column group_id uuid references public.epp_team_groups(id);
alter table public.epp_teams add constraint epp_team_one_owner check((club_id is not null and group_id is null) or (club_id is null and group_id is not null));
create unique index epp_team_one_group_lineup on public.epp_teams(match_id,discipline,group_id) where group_id is not null;
alter table public.epp_team_groups enable row level security;
alter table public.epp_team_group_members enable row level security;
alter table public.epp_team_group_audit enable row level security;
revoke all on public.epp_team_groups,public.epp_team_group_members,public.epp_team_group_audit from anon,authenticated;
grant all on public.epp_team_groups,public.epp_team_group_members,public.epp_team_group_audit to service_role;

create function public.epp_can_manage_team_group(p_actor uuid,p_group uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from app_accounts a where a.id=p_actor and a.active and a.deleted_at is null and a.membership_approved and not a.must_change_password
 and ((a.is_platform_admin and a.is_admin and a.role='trainer') or exists(
 select 1 from epp_team_group_members gm join shooters s on s.id=gm.shooter_id where gm.group_id=p_group and s.linked_user_id=a.id)))
$$;

create function public.epp_team_groups_context(p_actor uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'revision',g.revision,
 'canManage',epp_can_manage_team_group(p_actor,g.id),
 'canLink',exists(select 1 from app_accounts a where a.id=p_actor and a.active and a.deleted_at is null and a.membership_approved and a.is_platform_admin and a.is_admin and a.role='trainer' and not a.must_change_password),
 'members',coalesce((select jsonb_agg(jsonb_build_object('memberId',gm.id,'id',s.id,'name',coalesce(s.display_name,gm.name),'publicId',s.public_id,
 'clubs',coalesce((select jsonb_agg(jsonb_build_object('code',c.code,'name',c.naam)) from memberships mb join clubs c on c.id=mb.club_id where mb.shooter_id=s.id and mb.valid_from<=current_date and (mb.valid_until is null or mb.valid_until>=current_date)),'[]'::jsonb)) order by gm.name)
 from epp_team_group_members gm left join shooters s on s.id=gm.shooter_id where gm.group_id=g.id),'[]'::jsonb)) order by g.name),'[]'::jsonb) from epp_team_groups g
$$;

create function public.epp_team_group_link(p_actor uuid,p_group uuid,p_member uuid,p_shooter uuid,p_expected integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare g epp_team_groups; old epp_team_group_members;
begin
 if not exists(select 1 from app_accounts where id=p_actor and active and deleted_at is null and membership_approved and not must_change_password and is_platform_admin and is_admin and role='trainer') then raise exception 'geen_beheerrechten';end if;
 select * into g from epp_team_groups where id=p_group for update;
 if g.id is null then raise exception 'team_niet_gevonden';end if;
 if g.revision is distinct from p_expected then raise exception 'team_conflict';end if;
 select * into old from epp_team_group_members where id=p_member and group_id=p_group;
 if old.id is null or old.shooter_id is not null then raise exception 'teamlid_al_gekoppeld';end if;
 if not exists(select 1 from shooters s where s.id=p_shooter and not exists(select 1 from app_accounts a where a.id=s.linked_user_id and a.deleted_at is not null)) then raise exception 'schutter_niet_gevonden';end if;
 if exists(select 1 from epp_team_group_members where group_id=p_group and shooter_id=p_shooter) then raise exception 'schutter_al_in_teamgroep';end if;
 update epp_team_group_members set shooter_id=p_shooter where id=p_member;
 update epp_team_groups set revision=revision+1 where id=p_group;
 insert into epp_team_group_audit(group_id,actor_id,before_data,after_data) values(p_group,p_actor,to_jsonb(old),jsonb_build_object('memberId',p_member,'shooterId',p_shooter));
 return jsonb_build_object('ok',true);
end $$;

create function public.epp_team_group_lineup_save(p_actor uuid,p_group uuid,p_match uuid,p_discipline text,p_members uuid[],p_expected integer,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare mid uuid;m epp_matches;old epp_teams;tid uuid;before_state jsonb;after_state jsonb;
begin
 if not exists(select 1 from epp_team_groups where id=p_group) or not epp_can_manage_team_group(p_actor,p_group) then raise exception 'geen_beheerrechten';end if;
 mid:=epp_team_match(p_match);
 select * into m from epp_matches where id=mid and archived_at is null;
 if m.id is null or p_discipline is null or not p_discipline=any(m.offered_disciplines) then raise exception 'ongeldige_wedstrijd_of_discipline';end if;
 perform pg_advisory_xact_lock(hashtextextended(mid::text||p_discipline,0));
 select * into old from epp_teams where group_id=p_group and match_id=mid and discipline=p_discipline for update;
 if coalesce(old.revision,0) is distinct from p_expected then raise exception 'team_conflict';end if;
 if old.id is not null then
  select to_jsonb(old)||jsonb_build_object('members',(select jsonb_agg(shooter_id order by shooter_id) from epp_team_members where team_id=old.id)) into before_state;
  if exists(select 1 from epp_team_members tm join results r on r.shooter_id=tm.shooter_id join rounds rd on rd.id=r.round_id join events e on e.id=rd.event_id join divisions d on d.id=r.division_id
  where tm.team_id=old.id and r.status='confirmed' and e.ranking_eligible and d.naam=case p_discipline when 'optiek' then 'Open' when 'pcc' then 'PCC' else 'EPP pistool' end and epp_team_match(e.registration_match_id)=mid) then raise exception 'team_vast_na_score';end if;
 end if;
 tid:=coalesce(old.id,gen_random_uuid());
 if p_delete then
  if old.id is null then raise exception 'team_niet_gevonden';end if;
  delete from epp_teams where id=tid;
 else
  if cardinality(p_members) is distinct from 4 or (select count(distinct x) from unnest(p_members) x)<>4 then raise exception 'vier_unieke_schutters_verplicht';end if;
  if exists(select 1 from unnest(p_members) sid where not exists(select 1 from epp_team_group_members gm join shooters s on s.id=gm.shooter_id where gm.group_id=p_group and gm.shooter_id=sid and not exists(select 1 from app_accounts a where a.id=s.linked_user_id and a.deleted_at is not null))) then raise exception 'schutter_niet_in_teamgroep';end if;
  if exists(select 1 from epp_team_members where match_id=mid and discipline=p_discipline and shooter_id=any(p_members) and team_id<>tid) then raise exception 'schutter_al_in_team';end if;
  insert into epp_teams(id,match_id,discipline,club_id,group_id,number,updated_by) values(tid,mid,p_discipline,null,p_group,1,p_actor)
  on conflict(id) do update set revision=epp_teams.revision+1,updated_by=p_actor,updated_at=now();
  delete from epp_team_members where team_id=tid;
  insert into epp_team_members(team_id,match_id,discipline,shooter_id) select tid,mid,p_discipline,x from unnest(p_members) x;
  select to_jsonb(t)||jsonb_build_object('members',to_jsonb(p_members)) into after_state from epp_teams t where id=tid;
 end if;
 insert into epp_team_audit(team_id,actor_id,before_data,after_data) values(tid,p_actor,before_state,after_state);
 return jsonb_build_object('ok',true,'team',after_state);
end $$;

-- Keep legacy club management scoped to club-owned teams, including when club_id is null.
do $$
declare definition text;anchor text;
begin
 definition:=pg_get_functiondef('public.epp_team_save(uuid,uuid,text,uuid,integer,uuid[],integer,boolean)'::regprocedure);
 anchor:='old.club_id<>cid or old.match_id<>mid';
 if position(anchor in definition)=0 then raise exception 'Unexpected team authorization';end if;
 execute replace(definition,anchor,'old.club_id is distinct from cid or old.group_id is not null or old.match_id<>mid');
end $$;

-- Extend the existing standings, retaining club team rules and individual representation.
do $patch$
declare definition text;anchor text;
begin
 definition:=pg_get_functiondef('public.epp_team_context(uuid,uuid,text)'::regprocedure);
 anchor:=$old$r.id as result_id$old$;
 if position(anchor in definition)=0 then raise exception 'Unexpected team standings anchor 0';end if;
 definition:=replace(definition,anchor,$new$r.id as result_id,coalesce((select naam from clubs where id=r.represented_club_id),(select naam from clubs where id=s.home_club_id)) as member_club$new$);
 anchor:=$old$r.shooter_id=s.id and r.represented_club_id=t.club_id$old$;
 if position(anchor in definition)=0 then raise exception 'Unexpected team standings anchor 1';end if;
 definition:=replace(definition,anchor,$new$r.shooter_id=s.id and (t.group_id is not null or r.represented_club_id=t.club_id)$new$);
 anchor:=$old$select t.id,t.number,t.revision,c.code as "clubCode",c.naam as club,$old$;
 if position(anchor in definition)=0 then raise exception 'Unexpected team standings anchor 2';end if;
 definition:=replace(definition,anchor,$new$select t.id,t.number,t.revision,t.group_id as "groupId",g.name as "teamName",c.code as "clubCode",coalesce(g.name,c.naam) as club,$new$);
 anchor:=$old$'club',c.naam,'score',ms.final_score$old$;
 if position(anchor in definition)=0 then raise exception 'Unexpected team standings anchor 3';end if;
 definition:=replace(definition,anchor,$new$'club',case when t.group_id is not null then ms.member_club else c.naam end,'score',ms.final_score$new$);
 anchor:=$old$from epp_teams t join clubs c on c.id=t.club_id join member_scores ms on ms.team_id=t.id$old$;
 if position(anchor in definition)=0 then raise exception 'Unexpected team standings anchor 4';end if;
 definition:=replace(definition,anchor,$new$from epp_teams t left join clubs c on c.id=t.club_id left join epp_team_groups g on g.id=t.group_id join member_scores ms on ms.team_id=t.id$new$);
 anchor:=$old$group by t.id,c.code,c.naam$old$;
 if position(anchor in definition)=0 then raise exception 'Unexpected team standings anchor 5';end if;
 definition:=replace(definition,anchor,$new$group by t.id,c.code,c.naam,g.name$new$);
 anchor:=$old$'clubCode',a.club_code);$old$;
 if position(anchor in definition)=0 then raise exception 'Unexpected team standings anchor 6';end if;
 definition:=replace(definition,anchor,$new$'clubCode',a.club_code,'teamGroups',epp_team_groups_context(p_actor));$new$);
 execute definition;
end $patch$;

create function public.epp_backup_team_groups() returns trigger language plpgsql set search_path=public,extensions as $$
begin
 new.snapshot:=new.snapshot||jsonb_build_object('epp_team_groups',(select coalesce(jsonb_agg(t),'[]') from epp_team_groups t),'epp_team_group_members',(select coalesce(jsonb_agg(t),'[]') from epp_team_group_members t),'epp_team_group_audit',(select coalesce(jsonb_agg(t),'[]') from epp_team_group_audit t));
 new.checksum:=encode(digest(new.snapshot::text,'sha256'),'hex');return new;
end $$;
create trigger epp_backup_team_groups before insert on public.platform_backups for each row execute function public.epp_backup_team_groups();
revoke all on function public.epp_can_manage_team_group(uuid,uuid),public.epp_team_groups_context(uuid),public.epp_team_group_link(uuid,uuid,uuid,uuid,integer),public.epp_team_group_lineup_save(uuid,uuid,uuid,text,uuid[],integer,boolean) from public,anon,authenticated;
grant execute on function public.epp_can_manage_team_group(uuid,uuid),public.epp_team_groups_context(uuid),public.epp_team_group_link(uuid,uuid,uuid,uuid,integer),public.epp_team_group_lineup_save(uuid,uuid,uuid,text,uuid[],integer,boolean) to service_role;
commit;
