begin;

do $$
declare aid uuid;uid uuid;sid uuid;mid uuid;cfg jsonb;slot uuid;rejected boolean;
begin
  insert into app_accounts(club_code,username,display_name,role,is_admin,is_platform_admin)values('eppnationaal','multi-admin-'||gen_random_uuid(),'Multiday Test Admin','trainer',true,true)returning id into aid;
  insert into app_accounts(club_code,username,display_name,role)values('gast','multi-member-'||gen_random_uuid(),'Multiday Test Shooter','schutter')returning id into uid;
  insert into platform_users(id,auth_provider_id)values(uid,'test:'||uid);
  insert into shooters(display_name,linked_user_id)values('Multiday Test Shooter',uid)returning id into sid;
  insert into memberships(shooter_id,club_id)select sid,id from clubs where code='gast';
  insert into epp_matches(club_id,organizer,match_dates,offered_disciplines)values('gast','Two Day Test',array['2032-05-29','2032-05-28']::date[],array['pistool','optiek'])returning id into mid;
  assert (select match_date='2032-05-28' and match_dates=array['2032-05-28','2032-05-29']::date[] from epp_matches where id=mid),'canonical first date and sorted days';
  cfg:='{"first":"09:00","last":"10:05","duration":30,"changeover":0,"capacity":1,"gap":0,"opens":"2020-01-01T00:00:00Z","closes":"2032-05-27T00:00:00Z","published":true,"breaks":[],"overrides":[]}';
  perform epp_planner_configure(aid,mid,cfg,0);
  assert (select owner_club='gast' from epp_match_planners where match_id=mid),'owner preserved when head configures';
  assert (select count(*)=6 from epp_match_slots where match_id=mid),'three slots on each day';
  assert (select max((starts_at at time zone 'Europe/Amsterdam')::time)='10:00'::time from epp_match_slots where match_id=mid),'last matching start is before requested 10:05';
  assert (select count(distinct (starts_at at time zone 'Europe/Amsterdam')::date)=2 from epp_match_slots where match_id=mid),'both days available';
  select id into slot from epp_match_slots where match_id=mid and (starts_at at time zone 'Europe/Amsterdam')::date='2032-05-29' order by starts_at limit 1;
  perform epp_planner_book(aid,mid,sid,jsonb_build_array(jsonb_build_object('discipline','pistool','slotId',slot)),0,'Test hoofdbeheer toewijzing');
  rejected:=false;begin perform epp_planner_configure(uid,mid,cfg,1);exception when others then if sqlerrm='geen_beheerrechten' then rejected:=true;else raise;end if;end;
  assert rejected,'member cannot manage another club';
  perform epp_planner_configure(aid,mid,cfg,1);
  assert exists(select 1 from epp_signup_disciplines where slot_id=slot),'second-day booking preserved';
  rejected:=false;begin update epp_matches set match_dates=array['2032-05-28']::date[] where id=mid;exception when others then if sqlerrm='planner_datum_eerst_controleren'then rejected:=true;else raise;end if;end;
  assert rejected,'removing a booked day blocked';
  rejected:=false;begin perform epp_planner_configure(aid,mid,cfg||'{"first":"09:30"}',2);exception when others then if sqlerrm='geboekte_tijdsloten_behouden'then rejected:=true;else raise;end if;end;
  assert rejected,'booking cannot be displaced';
  update epp_matches set match_dates=array['2032-05-28','2032-05-29','2032-05-30']::date[] where id=mid;
  perform epp_planner_configure(aid,mid,cfg,2);
  assert (select count(*)=9 from epp_match_slots where match_id=mid),'third day can be added without moving bookings';
  assert exists(select 1 from epp_signup_disciplines where slot_id=slot),'booking id survives added day';
end $$;
rollback;
