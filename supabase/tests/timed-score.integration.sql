do $$
declare actor uuid; viewer uuid; cid uuid; sid uuid:=gen_random_uuid(); mid uuid; ev uuid; rnd uuid; div uuid; open_div uuid; season uuid; rule uuid; result jsonb; payload jsonb;
begin
  select id into actor from app_accounts where club_code='svbb' and username='beheer' and active;
  select id into viewer from app_accounts where club_code='svbb' and username='kijker';
  select id into cid from clubs where code='svbb';
  if actor is null then raise exception 'Test trainer missing'; end if;
  perform epp_register_shooter(actor,sid,'Timed score rollback test');
  insert into epp_matches(club_id,organizer,match_date,offered_disciplines) values('svbb','Timed rollback test',current_date+40,array['pistool','optiek']) returning id into mid;
  insert into divisions(naam) values('EPP pistool') on conflict(naam) do nothing;
  insert into divisions(naam) values('Open') on conflict(naam) do nothing;
  select id into div from divisions where naam='EPP pistool';select id into open_div from divisions where naam='Open';
  insert into seasons(naam,start_date,end_date) values('Timed rollback test',current_date,current_date+365) returning id into season;
  insert into rule_profiles(version) values('Timed rollback test') returning id into rule;
  insert into events(organizer_club_id,season_id,naam,type,rule_profile_id,registration_match_id,ranking_eligible) values(cid,season,'Timed rollback test','wedstrijd',rule,mid,true) returning id into ev;
  insert into rounds(event_id,label) values(ev,'Ronde 1') returning id into rnd;
  payload:='{"hits5":40,"hits4":10,"hits3":0,"hits2":0,"misses":0,"penaltyPoints":5,"rapid":{"hits5":8,"hits4":2,"hits3":0,"hits2":0,"misses":0},"rapidTimeMs":12400,"totalTimeMs":280000,"penaltyTimeMs":10000,"penaltyReason":"Ongeldige storing"}';
  result:=epp_confirm_timed_result(actor,cid,rnd,sid,div,payload,'timed-integration',0,'');
  if result->>'final_score'<>'235' or result->>'rapid_score'<>'48' or result->>'total_time_ms'<>'290000' then raise exception 'FAIL timed calculation'; end if;
  perform epp_confirm_timed_result(actor,cid,rnd,sid,div,payload,'timed-integration',0,'');
  if (select count(*) from result_audit where result_id=(result->>'id')::uuid)<>1 then raise exception 'FAIL retry audit'; end if;
  if (select after->>'rapid_time_ms' from result_audit where result_id=(result->>'id')::uuid)<>'12400' then raise exception 'FAIL timing audit'; end if;
  begin
    perform epp_confirm_timed_result(viewer,cid,rnd,sid,div,payload,'timed-viewer',0,'');raise exception 'FAIL viewer';
  exception when others then if sqlerrm<>'geen_schrijfrechten' then raise; end if; end;
  begin
    perform epp_confirm_timed_result(actor,cid,rnd,sid,div,jsonb_set(payload,'{rapid,hits5}','7'),'timed-invalid',1,'Correctie');raise exception 'FAIL count';
  exception when others then if sqlerrm<>'exact_10_snelvuurschoten_verplicht' then raise; end if; end;
  begin
    perform epp_confirm_timed_result(actor,cid,rnd,sid,div,payload,'timed-stale',0,'Correctie');raise exception 'FAIL stale';
  exception when others then if sqlerrm<>'score_conflict' then raise; end if; end;
  result:=epp_confirm_timed_result(actor,cid,rnd,sid,div,jsonb_set(payload,'{rapidTimeMs}','13000'),'timed-correction',1,'Tijdcorrectie');
  if result->>'revision'<>'2' then raise exception 'FAIL correction revision'; end if;
  if (select before->>'rapid_time_ms' from result_audit where result_id=(result->>'id')::uuid and after->>'revision'='2')<>'12400' then raise exception 'FAIL before audit'; end if;
  perform epp_confirm_timed_result(actor,cid,rnd,sid,open_div,payload,'timed-open',0,'');
  if (select count(*) from results where round_id=rnd and shooter_id=sid)<>2 then raise exception 'FAIL division isolation'; end if;
  update epp_matches set offered_disciplines=array['pistool'] where id=mid;
  begin
    perform epp_confirm_timed_result(actor,cid,rnd,sid,open_div,payload,'timed-open-not-offered',1,'Correctie');raise exception 'FAIL open';
  exception when others then if sqlerrm<>'open_niet_aangeboden' then raise; end if; end;
  if has_function_privilege('anon','epp_confirm_timed_result(uuid,uuid,uuid,uuid,uuid,jsonb,text,integer,text)','EXECUTE') then raise exception 'FAIL anon'; end if;
  result:=epp_confirm_result(actor,cid,rnd,sid,div,payload,'timed-legacy-correction',2,'Legacy correction');
  if result->>'rapid_score' is not null or result->>'total_time_ms' is not null then raise exception 'FAIL stale legacy times'; end if;
end $$;
select 'PASS timed scoring, retry, correction audit, viewer denial, Open isolation, offered discipline validation' as test;
