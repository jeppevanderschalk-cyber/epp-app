begin;
alter table public.results
  add column rapid_counts jsonb,
  add column rapid_score integer check (rapid_score between 0 and 50),
  add column rapid_time_ms integer check (rapid_time_ms > 0),
  add column total_time_ms integer check (total_time_ms > 0),
  add column measured_total_time_ms integer check (measured_total_time_ms > 0),
  add column penalty_time_ms integer check (penalty_time_ms >= 0),
  add column penalty_reason text,
  add column scoring_version text;

-- A correction from an older client must not retain stale tiebreak data.
create function public.epp_clear_stale_timing() returns trigger language plpgsql set search_path=public as $$
begin
  if new.revision<>old.revision and old.scoring_version='EPP_TIEBREAK_V2' then
    new.rapid_counts:=null;new.rapid_score:=null;new.rapid_time_ms:=null;
    new.total_time_ms:=null;new.measured_total_time_ms:=null;
    new.penalty_time_ms:=null;new.penalty_reason:=null;new.scoring_version:=null;
  end if;
  return new;
end $$;
create trigger epp_clear_stale_timing before update on public.results for each row execute function public.epp_clear_stale_timing();

-- Additive V2 endpoint: existing clients and historical results remain supported.
create function public.epp_confirm_timed_result(p_actor uuid,p_club uuid,p_round uuid,p_shooter uuid,p_division uuid,p_counts jsonb,p_key text,p_expected integer default 0,p_reason text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved results; old results; existing boolean; rapid jsonb; k text; n integer; shots integer:=0; points integer:=0;
  rt integer; tt integer; pt integer; why text; division_name text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_round::text||p_shooter::text,0));
  select exists(select 1 from results where idempotency_key=p_key) into existing;
  select * into old from results where round_id=p_round and shooter_id=p_shooter and division_id=p_division;
  select naam into division_name from divisions where id=p_division;
  if division_name is null or division_name not in ('EPP pistool','Open') then raise exception 'ongeldige_discipline'; end if;
  if division_name='Open' and not exists(
    select 1 from rounds r join events e on e.id=r.event_id join epp_matches m on m.id=e.registration_match_id
    where r.id=p_round and 'optiek'=any(m.offered_disciplines)
  ) then raise exception 'open_niet_aangeboden'; end if;
  if existing then
    if (select division_id from results where idempotency_key=p_key)<>p_division then raise exception 'ongeldige_herhaling'; end if;
    return epp_confirm_result(p_actor,p_club,p_round,p_shooter,p_division,p_counts,p_key,p_expected,p_reason);
  end if;
  rapid:=p_counts->'rapid';
  if jsonb_typeof(rapid) is distinct from 'object' then raise exception 'snelvuurtelling_verplicht'; end if;
  foreach k in array array['hits5','hits4','hits3','hits2','misses'] loop
    if coalesce(rapid->>k,'') !~ '^\d+$' then raise exception 'ongeldige_snelvuurtelling'; end if;
    n:=(rapid->>k)::integer;
    if n<0 or n>10 or n>(p_counts->>k)::integer then raise exception 'ongeldige_snelvuurtelling'; end if;
    shots:=shots+n;
    points:=points+n*case k when 'hits5' then 5 when 'hits4' then 4 when 'hits3' then 3 when 'hits2' then 2 else 0 end;
  end loop;
  if shots<>10 then raise exception 'exact_10_snelvuurschoten_verplicht'; end if;
  rt:=(p_counts->>'rapidTimeMs')::integer; tt:=(p_counts->>'totalTimeMs')::integer;pt:=coalesce((p_counts->>'penaltyTimeMs')::integer,0);
  why:=trim(coalesce(p_counts->>'penaltyReason',''));
  if rt is null or tt is null or rt<=0 or tt<rt or pt<0 then raise exception 'ongeldige_tijden'; end if;
  if ((p_counts->>'penaltyPoints')::integer>0 or pt>0) and length(why)<3 then raise exception 'strafreden_verplicht'; end if;
  perform epp_confirm_result(p_actor,p_club,p_round,p_shooter,p_division,p_counts,p_key,p_expected,p_reason);
  update results set rapid_counts=rapid,rapid_score=points,rapid_time_ms=rt,measured_total_time_ms=tt,
    total_time_ms=tt+pt,penalty_time_ms=pt,penalty_reason=nullif(why,''),scoring_version='EPP_TIEBREAK_V2'
  where idempotency_key=p_key returning * into saved;
  update result_audit set before=case when old.id is null then null else to_jsonb(old) end,after=to_jsonb(saved)
  where result_id=saved.id and (after->>'revision')::integer=saved.revision;
  return to_jsonb(saved);
end $$;
revoke all on function public.epp_confirm_timed_result(uuid,uuid,uuid,uuid,uuid,jsonb,text,integer,text) from public,anon,authenticated;
grant execute on function public.epp_confirm_timed_result(uuid,uuid,uuid,uuid,uuid,jsonb,text,integer,text) to service_role;
commit;
