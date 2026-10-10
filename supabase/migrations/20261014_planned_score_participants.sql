begin;
create function public.epp_match_participants(p_actor uuid,p_match uuid,p_discipline text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a app_accounts;planned boolean;
begin
  select * into a from app_accounts where id=p_actor and active and role='trainer';
  if a.id is null or not exists(select 1 from epp_matches where id=p_match and club_id=a.club_code) then raise exception 'geen_schrijfrechten';end if;
  planned:=exists(select 1 from epp_match_planners where match_id=p_match);
  return jsonb_build_object('planned',planned,'shooters',coalesce((select jsonb_agg(jsonb_build_object('id',sh.id,'display_name',sh.display_name,'public_id',sh.public_id,'club',coalesce(c.naam,'Gast'))) from epp_signups s join epp_signup_disciplines d on d.signup_id=s.id join shooters sh on sh.id=s.shooter_id left join app_accounts ac on ac.id=sh.linked_user_id left join clubs c on c.code=ac.club_code where s.match_id=p_match and d.discipline=p_discipline and d.slot_id is not null),'[]'));
end $$;
revoke all on function public.epp_match_participants(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.epp_match_participants(uuid,uuid,text) to service_role;

create or replace function public.epp_confirm_result(p_actor uuid,p_club uuid,p_round uuid,p_shooter uuid,p_division uuid,p_counts jsonb,p_key text,p_expected integer default 0,p_reason text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare old results;saved results;gross integer;final integer;h5 integer;h4 integer;h3 integer;h2 integer;miss integer;pen integer;represented uuid;planned_match uuid;discipline_code text;
begin
  if not exists(select 1 from app_accounts a join clubs c on c.code=a.club_code where a.id=p_actor and c.id=p_club and a.active and a.role='trainer') then raise exception 'geen_schrijfrechten';end if;
  if not exists(select 1 from rounds r join events e on e.id=r.event_id where r.id=p_round and e.organizer_club_id=p_club and e.type='wedstrijd') then raise exception 'ongeldige_ronde';end if;
  select e.registration_match_id into planned_match from rounds r join events e on e.id=r.event_id join epp_match_planners p on p.match_id=e.registration_match_id where r.id=p_round;
  select case naam when 'EPP pistool' then 'pistool' when 'Open' then 'optiek' else 'pcc' end into discipline_code from divisions where id=p_division;
  perform pg_advisory_xact_lock(hashtextextended(p_round::text||p_shooter::text,0));
  select * into old from results where round_id=p_round and shooter_id=p_shooter and division_id=p_division for update;
  if planned_match is not null then
    if old.id is null and not exists(select 1 from epp_signups s join epp_signup_disciplines d on d.signup_id=s.id where s.match_id=planned_match and s.shooter_id=p_shooter and d.discipline=discipline_code and d.slot_id is not null) then raise exception 'schutter_niet_ingeschreven';end if;
    select c.id into represented from shooters sh join app_accounts ac on ac.id=sh.linked_user_id join clubs c on c.code=ac.club_code where sh.id=p_shooter;
    represented:=coalesce(old.represented_club_id,represented,p_club);
  else
    if not exists(select 1 from memberships where shooter_id=p_shooter and club_id=p_club) then raise exception 'schutter_niet_van_vereniging';end if;
    represented:=p_club;
  end if;
  select * into saved from results where idempotency_key=p_key;
  if saved.id is not null then
    if saved.round_id<>p_round or saved.shooter_id<>p_shooter then raise exception 'ongeldige_herhaling';end if;
    return to_jsonb(saved);
  end if;
  h5:=(p_counts->>'hits5')::integer;h4:=(p_counts->>'hits4')::integer;h3:=(p_counts->>'hits3')::integer;h2:=(p_counts->>'hits2')::integer;miss:=(p_counts->>'misses')::integer;pen:=(p_counts->>'penaltyPoints')::integer;
  if h5 is null or h4 is null or h3 is null or h2 is null or miss is null or pen is null or least(h5,h4,h3,h2,miss,pen)<0 or h5+h4+h3+h2+miss<>50 then raise exception 'exact_50_schoten_verplicht';end if;
  gross:=h5*5+h4*4+h3*3+h2*2;final:=gross-pen;
  if final not between 0 and 250 then raise exception 'eindscore_buiten_bereik';end if;
  if coalesce(old.revision,0)<>p_expected then raise exception 'score_conflict';end if;
  if old.id is not null and length(trim(p_reason))<3 then raise exception 'correctiereden_verplicht';end if;
  insert into results(round_id,shooter_id,division_id,represented_club_id,entry_mode,hits5,hits4,hits3,hits2,misses,gross_score,penalty_points,final_score,status,revision,idempotency_key,created_by,confirmed_by,confirmed_at)
  values(p_round,p_shooter,p_division,represented,'counted',h5,h4,h3,h2,miss,gross,pen,final,'confirmed',coalesce(old.revision,0)+1,p_key,p_actor,p_actor,now())
  on conflict(round_id,shooter_id,division_id) do update set entry_mode='counted',status='confirmed',hits5=h5,hits4=h4,hits3=h3,hits2=h2,misses=miss,gross_score=gross,penalty_points=pen,final_score=final,revision=excluded.revision,idempotency_key=p_key,confirmed_by=p_actor,confirmed_at=now() returning * into saved;
  insert into result_audit(result_id,actor_id,action,before,after,reason) values(saved.id,p_actor,case when old.id is null then 'confirmed' else 'corrected' end,to_jsonb(old),to_jsonb(saved),nullif(trim(p_reason),''));
  return to_jsonb(saved);
end $$;
commit;
