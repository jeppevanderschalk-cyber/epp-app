begin;
do $$
declare head uuid;admin uuid;scorer uuid;mid uuid;othermid uuid;ctx jsonb;rejected boolean;cfg jsonb;
begin
  insert into app_accounts(club_code,username,display_name,role,is_admin,is_platform_admin)values('svbb','head-test-'||gen_random_uuid(),'Head Scorer Test','trainer',true,true)returning id into head;
  insert into app_accounts(club_code,username,display_name,role,is_admin)values('gast','admin-test-'||gen_random_uuid(),'Organizer Scorer Test','trainer',true)returning id into admin;
  insert into app_accounts(club_code,username,display_name,role)values('svbb','lid.'||replace(gen_random_uuid()::text,'-',''),'Head Delegate Test','schutter')returning id into scorer;
  insert into epp_matches(club_id,organizer,match_date,offered_disciplines)values('gast','Head Scorer Integration','2032-11-14',array['pistool'])returning id into mid;
  insert into epp_matches(club_id,organizer,match_date,offered_disciplines)values('gast','Head Unpublished Integration','2032-11-15',array['pistool'])returning id into othermid;
  cfg:='{"first":"09:00","last":"10:00","duration":30,"changeover":0,"capacity":10,"gap":0,"opens":"2020-01-01T00:00:00Z","closes":"2032-11-13T00:00:00Z","published":true,"breaks":[],"overrides":[]}';
  perform epp_planner_configure(admin,mid,cfg,0);
  rejected:=false;begin perform epp_scoring_prepare(head,othermid);exception when others then if sqlerrm='publiceer_eerst_wedstrijdplanner'then rejected:=true;else raise;end if;end;assert rejected,'head cannot bypass published planner';
  ctx:=epp_scoring_prepare(head,mid);
  assert ctx->>'managing'='true','head manages foreign organizer';
  assert (select owner_club='gast' from epp_scoring_matches where match_id=mid),'organizer ownership preserved';
  assert (select e.organizer_club_id=c.id from events e join clubs c on c.code='gast' where e.registration_match_id=mid),'event ownership preserved';
  perform epp_scoring_control(head,mid,'scorer',scorer,true,1);
  assert epp_scoring_allowed(scorer,mid),'delegate can score';
  assert not epp_scoring_allowed(scorer,mid,true),'delegate cannot manage';
  assert not exists(select 1 from app_accounts where id=scorer and (is_admin or role='trainer')),'no admin promotion';
  rejected:=false;begin perform epp_scoring_control(head,mid,'scorer',scorer,false,1);exception when others then if sqlerrm='wedstrijd_conflict'then rejected:=true;else raise;end if;end;assert rejected,'stale rights rejected';
  perform epp_scoring_control(head,mid,'scorer',scorer,false,2);
  assert not epp_scoring_allowed(scorer,mid),'revocation works';
  perform epp_scoring_control(head,mid,'close',null,true,3);
  rejected:=false;begin perform epp_scoring_control(head,mid,'scorer',scorer,true,4);exception when others then if sqlerrm='uitslag_definitief'then rejected:=true;else raise;end if;end;assert rejected,'closed match blocks new grant';
  update app_accounts set active=false where id=head;
  assert not epp_scoring_allowed(head,mid,true),'inactive head denied';
end $$;
rollback;
