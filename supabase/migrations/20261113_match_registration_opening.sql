begin;
alter table public.epp_matches add column registration_opens_on date;
-- The match date is authoritative when explicitly set; existing planners stay unchanged.
do $$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.epp_planner_configure(uuid,uuid,jsonb,integer)'::regprocedure);
 needle:='  cl:=case when p_config';
 if position(needle in definition)=0 then raise exception 'Unexpected planner configure definition';end if;
 execute replace(definition,needle,'  if m.registration_opens_on is not null then op:=m.registration_opens_on::timestamp at time zone ''Europe/Amsterdam'';end if;'||chr(10)||needle);
end $$;
create function public.epp_match_sync_registration_opening() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.registration_opens_on is distinct from old.registration_opens_on then
  update epp_match_planners set
   opens_at=case when new.registration_opens_on is null then now() else new.registration_opens_on::timestamp at time zone 'Europe/Amsterdam' end,
   config=jsonb_set(config,'{opens}',to_jsonb(case when new.registration_opens_on is null then now()::text else new.registration_opens_on::text||'T00:00' end)),
   revision=revision+1,updated_at=now()
  where match_id=new.id;
 end if;
 return new;
end $$;
revoke all on function public.epp_match_sync_registration_opening() from public,anon,authenticated;
create trigger epp_match_sync_registration_opening after update of registration_opens_on on public.epp_matches for each row execute function public.epp_match_sync_registration_opening();
commit;
