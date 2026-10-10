begin;
create or replace function public.epp_planner_protect_match() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and exists(select 1 from epp_match_planners where match_id=old.id) and (new.match_date is distinct from old.match_date or new.club_id<>old.club_id) then raise exception 'planner_datum_eerst_controleren';end if;
  if exists(select 1 from epp_signup_disciplines d join epp_signups s on s.id=d.signup_id where s.match_id=old.id and d.slot_id is not null) then
    if tg_op='DELETE' then raise exception 'wedstrijd_heeft_boekingen';end if;
    if exists(select 1 from epp_signup_disciplines d join epp_signups s on s.id=d.signup_id where s.match_id=old.id and not(d.discipline=any(new.offered_disciplines))) then raise exception 'geboekte_wedstrijd_behouden';end if;
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
commit;
