begin;
create function public.epp_scoring_identity_guard()returns trigger language plpgsql set search_path=public as $$
begin
  if (new.organizer,new.match_date,new.club_id)is distinct from(old.organizer,old.match_date,old.club_id)
    and exists(select 1 from epp_scoring_matches where organizer=old.organizer and match_date=old.match_date)
    then raise exception 'wedstrijd_invoer_vast';end if;
  return new;
end $$;
create trigger epp_scoring_identity_guard before update of organizer,match_date,club_id on epp_matches for each row execute function epp_scoring_identity_guard();
create function public.epp_scoring_planner_guard()returns trigger language plpgsql set search_path=public as $$
begin
  if new.published and exists(select 1 from epp_matches m join epp_scoring_matches s on s.organizer=m.organizer and s.match_date=m.match_date where m.id=new.match_id and (s.match_id<>new.match_id or s.owner_club<>new.owner_club))then raise exception 'wedstrijd_planner_vast';end if;
  return new;
end $$;
create trigger epp_scoring_planner_guard before insert or update on epp_match_planners for each row execute function epp_scoring_planner_guard();
commit;
