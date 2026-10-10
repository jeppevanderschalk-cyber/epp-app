begin;
do $$
declare
  admin1 uuid;admin2 uuid;viewer uuid;c1 uuid;c2 uuid;m uuid;copy_match uuid;other_match uuid;
  t1 uuid:=gen_random_uuid();t2 uuid:=gen_random_uuid();t3 uuid:=gen_random_uuid();open_team uuid:=gen_random_uuid();
  people uuid[]:='{}';sid uuid;i integer;rejected boolean;v jsonb;season uuid;rule uuid;ev uuid;rd uuid;other_ev uuid;other_rd uuid;div uuid;open_div uuid;bid uuid;
begin
  select id into c1 from clubs where code='gast';select id into c2 from clubs where code='svbb';
  insert into app_accounts(club_code,username,display_name,role,is_admin)values('gast','teams-test-'||gen_random_uuid(),'Teams beheer 1','trainer',true) returning id into admin1;
  insert into app_accounts(club_code,username,display_name,role,is_admin)values('svbb','teams-test-'||gen_random_uuid(),'Teams beheer 2','trainer',true) returning id into admin2;
  insert into app_accounts(club_code,username,display_name,role)values('gast','teams-test-'||gen_random_uuid(),'Teams kijker','schutter') returning id into viewer;
  insert into epp_matches(club_id,organizer,match_date,offered_disciplines)values('gast','Teams test '||t1,'2030-11-14',array['pistool','optiek']) returning id into m;
  insert into epp_matches(club_id,organizer,match_date,offered_disciplines)select 'svbb',organizer,match_date,offered_disciplines from epp_matches where id=m returning id into copy_match;
  insert into epp_matches(club_id,organizer,match_date,offered_disciplines)values('gast','Teams other '||t1,'2030-12-14',array['pistool']) returning id into other_match;
  for i in 1..12 loop
    insert into shooters(display_name)values('Teams test schutter '||i) returning id into sid;people:=array_append(people,sid);
    insert into memberships(shooter_id,club_id,valid_from)values(sid,case when i<=8 then c1 else c2 end,'2020-01-01');
  end loop;
  rejected:=false;begin perform epp_team_save(viewer,m,'pistool',t1,1,people[1:4],0);exception when others then if sqlerrm='geen_beheerrechten' then rejected:=true;else raise;end if;end;assert rejected,'viewer cannot manage';
  rejected:=false;begin perform epp_team_save(admin1,m,'pistool',t1,1,people[1:3],0);exception when others then if sqlerrm='vier_unieke_schutters_verplicht' then rejected:=true;else raise;end if;end;assert rejected,'exactly four';
  rejected:=false;begin perform epp_team_save(admin1,m,'pistool',t1,1,array[people[1],people[1],people[2],people[3]],0);exception when others then if sqlerrm='vier_unieke_schutters_verplicht' then rejected:=true;else raise;end if;end;assert rejected,'unique four';
  rejected:=false;begin perform epp_team_save(admin1,m,'pistool',t1,1,people[9:12],0);exception when others then if sqlerrm='schutter_niet_van_vereniging' then rejected:=true;else raise;end if;end;assert rejected,'own members only';
  perform epp_team_save(admin1,m,'pistool',t1,1,people[1:4],0);
  perform epp_team_save(admin1,copy_match,'pistool',t2,2,people[5:8],0);
  perform epp_team_save(admin2,copy_match,'pistool',t3,1,people[9:12],0);
  perform epp_team_save(admin1,m,'optiek',open_team,1,people[1:4],0);
  assert (select count(distinct match_id) from epp_teams where id in(t1,t2,t3))=1,'match copies share scope';
  rejected:=false;begin perform epp_team_save(admin1,m,'pistool',gen_random_uuid(),3,people[1:4],0);exception when others then if sqlerrm='schutter_al_in_team' then rejected:=true;else raise;end if;end;assert rejected,'one team per shooter';
  rejected:=false;begin perform epp_team_save(admin2,m,'pistool',t1,1,people[9:12],1);exception when others then if sqlerrm='geen_beheerrechten' then rejected:=true;else raise;end if;end;assert rejected,'other club team protected';
  rejected:=false;begin perform epp_team_save(admin1,m,'pistool',t1,1,people[1:4],0);exception when others then if sqlerrm='team_conflict' then rejected:=true;else raise;end if;end;assert rejected,'revision protected';
  v:=epp_team_context(viewer,copy_match,'pistool');assert jsonb_array_length(v->'teams')=3;
  assert v->'teams'->0->>'position' is null,'no score no position';
  assert exists(select 1 from jsonb_array_elements(v->'shooters') s where s->>'id'=people[1]::text and s->'clubs'->0->>'code'='gast'),'association visible';
  insert into seasons(naam,start_date,end_date)values('Teams test '||t1,'2030-01-01','2030-12-31') returning id into season;
  insert into rule_profiles(version)values('Teams test '||t1) returning id into rule;
  insert into divisions(naam)values('EPP pistool'),('Open') on conflict(naam) do nothing;
  select id into div from divisions where naam='EPP pistool';select id into open_div from divisions where naam='Open';
  insert into events(organizer_club_id,season_id,naam,type,local_date,rule_profile_id,ranking_eligible,registration_match_id)values(c1,season,'Teams test '||t1,'wedstrijd','2030-11-14',rule,true,copy_match) returning id into ev;
  insert into rounds(event_id)values(ev) returning id into rd;
  for i in 1..3 loop
    insert into results(round_id,shooter_id,division_id,represented_club_id,entry_mode,final_score,status)values(rd,people[i],div,c1,'total',250,'confirmed');
  end loop;
  v:=epp_team_context(viewer,m,'pistool');assert exists(select 1 from jsonb_array_elements(v->'teams') t where t->>'id'=t1::text and (t->>'completed')::integer=3 and t->>'position' is null),'incomplete not ranked';
  for i in 4..12 loop
    insert into results(round_id,shooter_id,division_id,represented_club_id,entry_mode,final_score,status)values(rd,people[i],div,case when i<=8 then c1 else c2 end,'total',case when i=4 then 250 else 240 end,'confirmed');
  end loop;
  insert into results(round_id,shooter_id,division_id,represented_club_id,entry_mode,final_score,status)values(rd,people[1],open_div,c1,'total',200,'confirmed');
  insert into events(organizer_club_id,season_id,naam,type,local_date,rule_profile_id,ranking_eligible,registration_match_id)values(c1,season,'Other test '||t1,'wedstrijd','2030-12-14',rule,true,other_match) returning id into other_ev;
  insert into rounds(event_id)values(other_ev) returning id into other_rd;
  insert into results(round_id,shooter_id,division_id,represented_club_id,entry_mode,final_score,status)values(other_rd,people[5],div,c1,'total',250,'confirmed');
  v:=epp_team_context(viewer,m,'pistool');
  assert (v->'teams'->0->>'score')::integer=1000 and (v->'teams'->0->>'position')::integer=1,'score sum';
  assert (v->'teams'->1->>'score')::integer=960 and (v->'teams'->1->>'position')::integer=2 and (v->'teams'->2->>'position')::integer=2,'ties shared rank; other match ignored';
  rejected:=false;begin perform epp_team_save(admin1,m,'pistool',t1,1,people[1:4],1);exception when others then if sqlerrm='team_vast_na_score' then rejected:=true;else raise;end if;end;assert rejected,'composition frozen after score';
  v:=epp_team_context(viewer,m,'optiek');assert jsonb_array_length(v->'teams')=1 and (v->'teams'->0->>'score')::integer=200,'discipline isolated';
  assert (select count(*) from epp_team_audit where team_id in(t1,t2,t3,open_team))=4,'audit';
  bid:=epp_capture_backup();assert (select snapshot?'epp_teams' and snapshot?'epp_team_members' and snapshot?'epp_team_audit' from platform_backups where id=bid),'backup';
end $$;
rollback;
