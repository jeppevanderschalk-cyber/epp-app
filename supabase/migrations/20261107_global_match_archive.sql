begin;
-- A stable identity links legacy registration copies without coupling unrelated
-- events that happen to share a name or date. Newly created events stay separate.
alter table public.epp_matches add column event_group_id uuid not null default gen_random_uuid();
with legacy as (
 select id,first_value(id) over (
  partition by organizer,location,match_date,match_dates,created_at order by id
 ) as group_id
 from public.epp_matches m
 where not exists(select 1 from public.epp_match_planners p where p.match_id=m.id)
)
update public.epp_matches m set event_group_id=l.group_id from legacy l where l.id=m.id;
create index epp_matches_event_group on public.epp_matches(event_group_id);

create or replace function public.epp_archive_match(p_actor uuid,p_match uuid) returns void
language plpgsql security definer set search_path=public as $$
declare m epp_matches;a app_accounts;changed uuid;
begin
 select * into a from app_accounts where id=p_actor and active and deleted_at is null and is_admin and role='trainer' and not must_change_password;
 select * into m from epp_matches where id=p_match;
 if a.id is null or m.id is null or (a.club_code<>m.club_id and not a.is_platform_admin) then raise exception 'geen_beheerrechten';end if;
 perform pg_advisory_xact_lock(hashtextextended(m.event_group_id::text,0));
 for changed in update epp_matches set archived_at=now()
  where event_group_id=m.event_group_id and archived_at is null returning id
 loop
  insert into epp_planner_audit(match_id,actor_id,action,reason)
  values(changed,a.id,'archive','Wedstrijd overal gearchiveerd; deelnemers, planning en scores behouden');
 end loop;
end $$;
revoke all on function public.epp_archive_match(uuid,uuid) from public,anon,authenticated;
grant execute on function public.epp_archive_match(uuid,uuid) to service_role;

-- Honor earlier archive actions for all remaining copies, including Amsterdam
-- and Druten. Keep the original archive time and record why each copy closed.
do $$
declare original record;changed uuid;
begin
 for original in
  select distinct on (m.event_group_id) m.event_group_id,m.archived_at,a.actor_id
  from epp_matches m join epp_planner_audit a on a.match_id=m.id and a.action='archive'
  where m.archived_at is not null order by m.event_group_id,m.archived_at,a.created_at
 loop
  for changed in update epp_matches set archived_at=original.archived_at
   where event_group_id=original.event_group_id and archived_at is null returning id
  loop
   insert into epp_planner_audit(match_id,actor_id,action,reason)
   values(changed,original.actor_id,'archive','Bestaande archivering doorgezet naar verenigingskopie; gegevens behouden');
  end loop;
 end loop;
end $$;
commit;
