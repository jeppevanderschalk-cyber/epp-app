begin;
-- Add club representation without granting organizer privileges or bypassing booking guards.
do $$
declare definition text; expected text;
begin
  definition:=pg_get_functiondef('public.epp_planner_book(uuid,uuid,uuid,jsonb,integer,text)'::regprocedure);
  expected:='if not managing and s.linked_user_id is distinct from a.id then raise exception ''alleen_eigen_inschrijving'';end if;';
  if position(expected in definition)=0 then raise exception 'Unexpected planner booking authorization';end if;
  definition:=replace(definition,expected,$replacement$
  if not managing and s.linked_user_id is distinct from a.id and not (
    a.role='trainer' and a.is_admin and a.membership_approved and a.deleted_at is null
    and exists(select 1 from memberships membership join clubs club on club.id=membership.club_id
      where membership.shooter_id=p_shooter and club.code=a.club_code)
  ) then raise exception 'alleen_eigen_inschrijving';end if;
  if not managing and s.linked_user_id is distinct from a.id and length(trim(coalesce(p_reason,'')))<3 then raise exception 'wijzigingsreden_verplicht';end if;
  $replacement$);
  execute definition;
end $$;
commit;
