begin;
alter table public.epp_match_slots
  add column blocked boolean not null default false,
  add column block_revision integer not null default 0;

create function public.epp_planner_set_slot_block(p_actor uuid,p_match uuid,p_slot uuid,p_blocked boolean,p_expected integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a app_accounts;m epp_matches;p epp_match_planners;s epp_match_slots;before_value jsonb;
begin
  select * into a from app_accounts where id=p_actor and active and deleted_at is null and role='trainer' and is_admin;
  if a.id is null then raise exception 'geen_beheerrechten';end if;
  -- Same match lock as booking/configuration: blocking and booking are serialized.
  select * into m from epp_matches where id=p_match for update;
  if m.id is null then raise exception 'wedstrijd_niet_gevonden';end if;
  if m.archived_at is not null then raise exception 'wedstrijd_gearchiveerd';end if;
  select * into p from epp_match_planners where match_id=p_match;
  if p.match_id is null then raise exception 'planner_niet_beschikbaar';end if;
  if not (a.club_code=p.owner_club or a.is_platform_admin) then raise exception 'geen_beheerrechten';end if;
  if p_blocked is null or p_expected is null then raise exception 'ongeldige_blokkering';end if;
  select * into s from epp_match_slots where id=p_slot and match_id=p_match for update;
  if s.id is null then raise exception 'ongeldig_tijdslot';end if;
  if s.block_revision<>p_expected then
    if s.blocked=p_blocked then return to_jsonb(s);end if;
    raise exception 'tijdslot_conflict';
  end if;
  if s.blocked=p_blocked then return to_jsonb(s);end if;
  before_value:=to_jsonb(s);
  update epp_match_slots set blocked=p_blocked,block_revision=block_revision+1 where id=s.id returning * into s;
  insert into epp_planner_audit(match_id,actor_id,action,before_data,after_data)
    values(p_match,p_actor,case when p_blocked then 'block_slot' else 'unblock_slot' end,before_value,to_jsonb(s));
  return to_jsonb(s);
end $$;
revoke all on function public.epp_planner_set_slot_block(uuid,uuid,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.epp_planner_set_slot_block(uuid,uuid,uuid,boolean,integer) to service_role;

-- Keep every current booking guard and add the block check after slot validation.
-- An existing reservation may be retained when editing another discipline.
do $$
declare definition text;guard text:='if slot.id is null or slot.starts_at<=now() then raise exception ''ongeldig_tijdslot'';end if;';
begin
  definition:=pg_get_functiondef('public.epp_planner_book(uuid,uuid,uuid,jsonb,integer,text)'::regprocedure);
  if position(guard in definition)=0 then raise exception 'Expected booking validation not found';end if;
  definition:=replace(definition,guard,guard||E'\n    if slot.blocked and not exists(select 1 from epp_signup_disciplines where signup_id=old.id and discipline=choice->>''discipline'' and slot_id=slot.id) then raise exception ''tijdslot_geblokkeerd'';end if;');
  execute definition;
end $$;
commit;
