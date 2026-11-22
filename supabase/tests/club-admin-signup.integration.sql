begin;
do $$
#variable_conflict use_variable
declare admin_id uuid;owner_id uuid;trainer_id uuid;member_id uuid;s1 uuid;s2 uuid;s3 uuid;mid uuid;slot1 uuid;choices jsonb;rejected boolean;
begin
  insert into app_accounts(club_code,username,display_name,role,is_admin,membership_approved) values('gast','signup-test-'||gen_random_uuid(),'Test Admin','trainer',true,true) returning id into admin_id;
  insert into app_accounts(club_code,username,display_name,role,is_admin,membership_approved) values('svbb','signup-test-'||gen_random_uuid(),'Test Owner','trainer',true,true) returning id into owner_id;
  insert into app_accounts(club_code,username,display_name,role,is_admin,membership_approved) values('gast','signup-test-'||gen_random_uuid(),'Test Trainer','trainer',false,true) returning id into trainer_id;
  insert into app_accounts(club_code,username,display_name,role,is_admin,membership_approved) values('gast','signup-test-'||gen_random_uuid(),'Test Member','schutter',false,true) returning id into member_id;
  insert into shooters(display_name) values('Club Signup Test 1') returning id into s1;
  insert into shooters(display_name) values('Club Signup Test 2') returning id into s2;
  insert into shooters(display_name) values('Club Signup Test 3') returning id into s3;
  insert into memberships(shooter_id,club_id) select s1,id from clubs where code='gast';
  insert into memberships(shooter_id,club_id) select s2,id from clubs where code='svbb';
  insert into memberships(shooter_id,club_id) select s3,id from clubs where code='gast';
  insert into epp_matches(club_id,organizer,match_date,match_dates,offered_disciplines) values('svbb','Club Signup Transaction Test','2035-11-14',array['2035-11-14'::date],array['pistool']) returning id into mid;
  perform epp_planner_configure(owner_id,mid,'{"first":"09:00","last":"09:30","duration":30,"changeover":0,"capacity":1,"gap":0,"opens":"2020-01-01T00:00","closes":"2035-11-13T23:00","published":true,"breaks":[],"overrides":[]}',0);
  select id into slot1 from epp_match_slots where match_id=mid order by starts_at limit 1;
  choices:=jsonb_build_array(jsonb_build_object('discipline','pistool','slotId',slot1));
  perform epp_planner_book(admin_id,mid,s1,choices,0,'Inschrijving door verenigingsbeheerder');
  assert exists(select 1 from epp_signups where match_id=mid and shooter_id=s1 and planner_revision=1),'Club admin registers own member at another organizer';
  rejected:=false;begin perform epp_planner_book(admin_id,mid,s2,choices,0,'Test');exception when others then if sqlerrm='alleen_eigen_inschrijving' then rejected:=true;else raise;end if;end;assert rejected,'Other club member denied';
  rejected:=false;begin perform epp_planner_book(trainer_id,mid,s1,'[]',1,'Test');exception when others then if sqlerrm='alleen_eigen_inschrijving' then rejected:=true;else raise;end if;end;assert rejected,'Trainer without admin denied';
  rejected:=false;begin perform epp_planner_book(member_id,mid,s1,'[]',1,'Test');exception when others then if sqlerrm='alleen_eigen_inschrijving' then rejected:=true;else raise;end if;end;assert rejected,'Regular member denied';
  rejected:=false;begin perform epp_planner_book(admin_id,mid,s1,'[]',1,'');exception when others then if sqlerrm='wijzigingsreden_verplicht' then rejected:=true;else raise;end if;end;assert rejected,'Audit reason required';
  rejected:=false;begin perform epp_planner_book(admin_id,mid,s3,choices,0,'Test');exception when others then if sqlerrm='tijdslot_vol' then rejected:=true;else raise;end if;end;assert rejected,'Capacity enforced';
  update epp_match_planners set opens_at='2035-11-01' where match_id=mid;
  rejected:=false;begin perform epp_planner_book(admin_id,mid,s1,'[]',1,'Test');exception when others then if sqlerrm='inschrijving_gesloten' then rejected:=true;else raise;end if;end;assert rejected,'Registration window enforced';
  update epp_match_planners set opens_at='2020-01-01' where match_id=mid;
  perform epp_planner_book(admin_id,mid,s1,'[]',1,'Afmelden door beheerder');
  assert not exists(select 1 from epp_signup_disciplines d join epp_signups s on s.id=d.signup_id where s.match_id=mid),'Club admin cancellation works';
  assert (select count(*)=2 from epp_planner_audit where match_id=mid and actor_id=admin_id and action in('book','cancel')),'Both changes audited';
end $$;

rollback;
