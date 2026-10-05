begin;
do $$
declare actor uuid; viewer uuid; cid uuid; sid uuid:=gen_random_uuid(); v_match uuid; ev uuid; rnd uuid; division uuid; season uuid; rule uuid; result jsonb; bid uuid; stamp timestamptz;
begin
  select id into actor from app_accounts where club_code='svbb' and username='beheer';
  select id into viewer from app_accounts where club_code='svbb' and username='kijker';
  select id into cid from clubs where code='svbb';
  perform epp_register_shooter(actor,sid,'Integration test');
  if (select count(*) from memberships where shooter_id=sid and club_id=cid)<>1 then raise exception 'FAIL identity'; end if;
  perform epp_register_shooter(actor,sid,'Integration test');
  if (select count(*) from shooters where id=sid)<>1 then raise exception 'FAIL identity retry'; end if;
  perform epp_training_apply('svbb',actor,'[{"kind":"round","id":"test-round","expected":null,"value":{"score":200}}]');
  perform epp_training_apply('svbb',actor,'[{"kind":"round","id":"test-round","expected":null,"value":{"score":200}}]');
  if (select revision from training_entities where entity_id='test-round')<>1 then raise exception 'FAIL retry revision'; end if;
  begin
    perform epp_training_apply('svbb',actor,'[{"kind":"round","id":"independent","expected":null,"value":{"score":220}},{"kind":"round","id":"test-round","expected":null,"value":{"score":240}}]');
    raise exception 'FAIL expected conflict';
  exception when others then if sqlerrm not like 'opslag_conflict:%' then raise; end if; end;
  if exists(select 1 from training_entities where entity_id='independent') then raise exception 'FAIL partial write'; end if;
  begin
    perform epp_training_apply('svbb',viewer,'[]');raise exception 'FAIL viewer write';
  exception when others then if sqlerrm<>'geen_schrijfrechten' then raise; end if; end;
  begin
    perform epp_training_apply('mercurius75',actor,'[]');raise exception 'FAIL foreign club write';
  exception when others then if sqlerrm<>'geen_schrijfrechten' then raise; end if; end;
  if has_table_privilege('anon','training_entities','INSERT') or has_function_privilege('anon','epp_training_apply(text,uuid,jsonb)','EXECUTE') then raise exception 'FAIL anonymous permission'; end if;
  insert into epp_matches(club_id,organizer,match_date,deadline,offered_disciplines)
  values('svbb','Integration',current_date+40,current_date+30,array['pistool']) returning id into v_match;
  perform epp_signup_save(actor,'svbb',v_match,sid,'[{"discipline":"pistool","time_block":"ochtend","specific_time":"09:00"}]');
  begin
    perform epp_signup_save(actor,'svbb',v_match,sid,'[{"discipline":"pistool","time_block":"middag"},{"discipline":"pistool","time_block":"middag"}]');
    raise exception 'FAIL duplicate discipline accepted';
  exception when unique_violation then null; end;
  if (select specific_time from epp_signup_disciplines d join epp_signups s on s.id=d.signup_id where s.match_id=v_match and s.shooter_id=sid)<>'09:00' then raise exception 'FAIL signup rollback'; end if;
  insert into divisions(naam) values('Integration') returning id into division;
  insert into seasons(naam,start_date,end_date) values('Integration',current_date,current_date+365) returning id into season;
  insert into rule_profiles(version) values('Integration') returning id into rule;
  insert into events(organizer_club_id,season_id,naam,type,rule_profile_id,registration_match_id,ranking_eligible)
  values(cid,season,'Integration','wedstrijd',rule,v_match,true) returning id into ev;
  insert into rounds(event_id,label) values(ev,'Ronde 1') returning id into rnd;
  result:=epp_confirm_result(actor,cid,rnd,sid,division,'{"hits5":40,"hits4":10,"hits3":0,"hits2":0,"misses":0,"penaltyPoints":0}','integration-key',0,'');
  if result->>'final_score'<>'240' then raise exception 'FAIL score calculation'; end if;
  perform epp_confirm_result(actor,cid,rnd,sid,division,'{"hits5":40,"hits4":10,"hits3":0,"hits2":0,"misses":0,"penaltyPoints":0}','integration-key',0,'');
  if (select count(*) from result_audit where result_id=(result->>'id')::uuid)<>1 then raise exception 'FAIL double audit'; end if;
  begin
    perform epp_confirm_result(actor,cid,rnd,sid,division,'{"hits5":30,"hits4":20,"hits3":0,"hits2":0,"misses":0,"penaltyPoints":0}','integration-correction',0,'Correction');
    raise exception 'FAIL stale correction accepted';
  exception when others then if sqlerrm<>'score_conflict' then raise; end if; end;
  result:=epp_confirm_result(actor,cid,rnd,sid,division,'{"hits5":30,"hits4":20,"hits3":0,"hits2":0,"misses":0,"penaltyPoints":0}','integration-correction',1,'Correction');
  if result->>'revision'<>'2' or result->>'final_score'<>'230' then raise exception 'FAIL correction'; end if;
  if (select count(*) from result_audit where result_id=(result->>'id')::uuid)<>2 then raise exception 'FAIL correction audit'; end if;
  bid:=epp_capture_backup();
  perform epp_training_apply('svbb',actor,'[{"kind":"round","id":"test-round","expected":{"score":200},"value":{"score":210}}]');
  select max(updated_at) into stamp from training_entities where club_code='svbb';
  perform epp_restore_training(actor,bid,stamp);
  if (select data->>'score' from training_entities where club_code='svbb' and entity_id='test-round')<>'200' then raise exception 'FAIL backup restore'; end if;
  begin
    perform epp_restore_training(viewer,bid,stamp);raise exception 'FAIL viewer restore';
  exception when others then if sqlerrm<>'geen_beheerrechten' then raise; end if; end;
  begin
    perform epp_restore_training(actor,bid,stamp-interval '1 day');raise exception 'FAIL stale restore';
  exception when others then if sqlerrm<>'herstel_conflict' then raise; end if; end;
  raise notice 'PASS checksum-verified training restore, restore authorization and restore conflict';
  raise notice 'PASS identity retry, conflict rollback, viewer isolation, club isolation, anon denial, signup rollback, counted result, retry audit, correction revision';
end $$;
rollback;
