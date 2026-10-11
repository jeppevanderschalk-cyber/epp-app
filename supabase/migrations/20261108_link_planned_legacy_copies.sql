begin;
-- A legacy copy can later receive a planner. It still belongs to the same
-- event as its registration copies created together at the original import.
with imported as (
 select id,first_value(id) over (
  partition by organizer,location,match_date,match_dates,created_at order by id
 ) as group_id
 from public.epp_matches
)
update public.epp_matches m set event_group_id=i.group_id from imported i where i.id=m.id;
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
