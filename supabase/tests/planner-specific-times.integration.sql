begin;
do $$
declare actor uuid;shooter uuid;competition uuid;first_slot uuid;new_slot uuid;signup uuid;rejected boolean;
begin
  insert into app_accounts(club_code,username,display_name,role,is_admin)
  values('gast','planner-minutes-'||gen_random_uuid(),'Planner Test','trainer',true) returning id into actor;
  insert into platform_users(id,auth_provider_id) values(actor,'test:'||actor);
  insert into shooters(display_name,linked_user_id) values('Planner Minute Test',actor) returning id into shooter;
  insert into memberships(shooter_id,club_id) select shooter,id from clubs where code='gast';
  insert into epp_matches(club_id,organizer,match_date,offered_disciplines)
  values('gast','Planner Minute Test','2030-11-14',array['pistool']) returning id into competition;
  perform epp_planner_configure(actor,competition,
    '{"first":"09:00","last":"16:00","duration":7,"changeover":3,"capacity":2,"gap":0,"opens":"2020-01-01T00:00:00Z","closes":"2030-11-13T00:00:00Z","published":true,"breaks":[],"overrides":[]}'::jsonb,0);
  select id into first_slot from epp_match_slots where match_id=competition and to_char(starts_at at time zone 'Europe/Amsterdam','HH24:MI')='09:00';
  select id into new_slot from epp_match_slots where match_id=competition and to_char(starts_at at time zone 'Europe/Amsterdam','HH24:MI')='15:50';
  perform epp_planner_book(actor,competition,shooter,jsonb_build_array(jsonb_build_object('discipline','pistool','slotId',first_slot)),0);
  perform epp_planner_book(actor,competition,shooter,jsonb_build_array(jsonb_build_object('discipline','pistool','slotId',new_slot)),1);
  assert not exists(select 1 from epp_signup_disciplines where slot_id=first_slot),'09:00 freed';
  assert (select count(*) from epp_signup_disciplines where slot_id=new_slot and specific_time='15:50')=1,'15:50 reserved';
  select id into signup from epp_signups where match_id=competition and shooter_id=shooter;
  rejected:=false;
  begin update epp_signup_disciplines set specific_time='25:70' where signup_id=signup;
  exception when check_violation then rejected:=true;end;
  assert rejected,'invalid clock times remain rejected';
  rejected:=false;
  begin update epp_signup_disciplines set slot_id=null,specific_time='15:50' where signup_id=signup;
  exception when check_violation then rejected:=true;end;
  assert rejected,'legacy preference-only restrictions preserved';
end $$;
rollback;
