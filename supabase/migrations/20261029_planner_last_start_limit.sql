-- generate_series already treats the requested last start as an inclusive limit.
-- Remove only the extra exact-alignment rejection; retain all booking guards.
begin;
do $$
declare definition text;guard text := 'if (last_min-first_min)%(duration+changeover)<>0 then raise exception ''laatste_ronde_sluit_niet_aan'';end if;';
begin
  definition:=pg_get_functiondef('public.epp_planner_configure(uuid,uuid,jsonb,integer)'::regprocedure);
  if position(guard in definition)=0 then raise exception 'Expected planner validation not found';end if;
  definition:=replace(definition,guard,'-- The last start is an upper limit, not an exact interval boundary.');
  execute definition;
end $$;
commit;
