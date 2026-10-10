begin;
-- Extend existing planner functions to the platform administrator without changing ownership.
do $$
declare definition text; expected text;
begin
  definition:=pg_get_functiondef('public.epp_planner_configure(uuid,uuid,jsonb,integer)'::regprocedure);
  expected:='where id=p_match and club_id=a.club_code for update';
  if position(expected in definition)=0 then raise exception 'Unexpected planner configure scope';end if;
  definition:=replace(definition,expected,'where id=p_match and (club_id=a.club_code or a.is_platform_admin) for update');
  expected:='values(p_match,a.club_code,p_config';
  if position(expected in definition)=0 then raise exception 'Unexpected planner owner assignment';end if;
  execute replace(definition,expected,'values(p_match,m.club_id,p_config');
  definition:=pg_get_functiondef('public.epp_planner_book(uuid,uuid,uuid,jsonb,integer,text)'::regprocedure);
  expected:='managing:=a.role=''trainer'' and a.is_admin and a.club_code=p.owner_club;';
  if position(expected in definition)=0 then raise exception 'Unexpected planner booking scope';end if;
  execute replace(definition,expected,'managing:=a.role=''trainer'' and a.is_admin and (a.club_code=p.owner_club or a.is_platform_admin);');
end $$;
commit;
