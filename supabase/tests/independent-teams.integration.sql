begin;
do $$
#variable_conflict use_variable
declare head_id uuid;member_id uuid;stranger uuid;admin_id uuid;g uuid;g2 uuid;pending uuid;people uuid[]:='{}';s uuid;i integer;c1 uuid;c2 uuid;m uuid;m2 uuid;ev uuid;ev2 uuid;rd uuid;rd2 uuid;season uuid;rule uuid;div uuid;v jsonb;team uuid;rejected boolean;old_revision integer;bid uuid;
begin
 select id into c1 from clubs where code='gast';select id into c2 from clubs where code='svbb';
 insert into app_accounts(club_code,username,display_name,role,is_admin,is_platform_admin,membership_approved) values('eppnationaal','group-test-'||gen_random_uuid(),'Group Test Head','trainer',true,true,true) returning id into head_id;
 insert into app_accounts(club_code,username,display_name,role,membership_approved) values('gast','group-test-'||gen_random_uuid(),'Group Test Member','schutter',true) returning id into member_id;
 insert into app_accounts(club_code,username,display_name,role,membership_approved) values('gast','group-test-'||gen_random_uuid(),'Group Test Stranger','schutter',true) returning id into stranger;
 insert into app_accounts(club_code,username,display_name,role,is_admin,membership_approved) values('gast','group-test-'||gen_random_uuid(),'Group Test Club Admin','trainer',true,true) returning id into admin_id;
 insert into platform_users(id,auth_provider_id) values(member_id,'test:'||member_id);
 for i in 1..7 loop
  insert into shooters(display_name,linked_user_id) values('Independent Test '||i,case when i=1 then member_id end) returning id into s;people:=array_append(people,s);
  insert into memberships(shooter_id,club_id,valid_from) values(s,case when i%2=1 then c1 else c2 end,'2020-01-01');
 end loop;
 insert into epp_team_groups(name) values('Dreamteam Test '||gen_random_uuid()) returning id into g;
 for i in 1..6 loop insert into epp_team_group_members(group_id,name,shooter_id) values(g,'Independent Test '||i,people[i]);end loop;
 insert into epp_team_groups(name) values('Other Independent Test '||gen_random_uuid()) returning id into g2;
 insert into epp_team_group_members(group_id,name) values(g2,'Pending Test') returning id into pending;
 assert epp_can_manage_team_group(head_id,g),'head manages group';assert epp_can_manage_team_group(member_id,g),'team member manages group';
 assert not epp_can_manage_team_group(stranger,g),'stranger denied';assert not epp_can_manage_team_group(admin_id,g),'unrelated club admin denied';
 v:=epp_team_groups_context(member_id);assert exists(select 1 from jsonb_array_elements(v) x where x->>'id'=g::text and (x->>'canManage')::boolean and jsonb_array_length(x->'members')=6),'six person pool';
 rejected:=false;begin perform epp_team_group_link(member_id,g2,pending,people[7],1);exception when others then if sqlerrm='geen_beheerrechten' then rejected:=true;else raise;end if;end;assert rejected,'only head links profiles';
 rejected:=false;begin perform epp_team_group_link(head_id,g2,pending,people[7],0);exception when others then if sqlerrm='team_conflict' then rejected:=true;else raise;end if;end;assert rejected,'link revisions checked';
 perform epp_team_group_link(head_id,g2,pending,people[7],1);
 assert (select shooter_id=people[7] from epp_team_group_members where id=pending),'pending name linked';assert (select revision=2 from epp_team_groups where id=g2),'group revision incremented';
 insert into epp_matches(club_id,organizer,match_date,offered_disciplines) values('gast','Independent Match '||g,'2035-11-14',array['pistool','optiek']) returning id into m;
 insert into epp_matches(club_id,organizer,match_date,offered_disciplines) values('svbb','Independent Other Match '||g,'2035-12-14',array['pistool']) returning id into m2;
 rejected:=false;begin perform epp_team_group_lineup_save(stranger,g,m,'pistool',people[1:4],0);exception when others then if sqlerrm='geen_beheerrechten' then rejected:=true;else raise;end if;end;assert rejected,'stranger cannot select lineup';
 rejected:=false;begin perform epp_team_group_lineup_save(head_id,g,m,'pistool',people[1:6],0);exception when others then if sqlerrm='vier_unieke_schutters_verplicht' then rejected:=true;else raise;end if;end;assert rejected,'six cannot all score';
 rejected:=false;begin perform epp_team_group_lineup_save(head_id,g,m,'pistool',array[people[1],people[1],people[2],people[3]],0);exception when others then if sqlerrm='vier_unieke_schutters_verplicht' then rejected:=true;else raise;end if;end;assert rejected,'duplicate shooter denied';
 rejected:=false;begin perform epp_team_group_lineup_save(head_id,g,m,'pistool',people[4:7],0);exception when others then if sqlerrm='schutter_niet_in_teamgroep' then rejected:=true;else raise;end if;end;assert rejected,'outsider denied';
 perform epp_team_group_lineup_save(member_id,g,m,'pistool',people[1:4],0);
 select id into team from epp_teams where group_id=g and match_id=epp_team_match(m) and discipline='pistool';
 assert (select club_id is null and group_id=g from epp_teams where id=team),'group has no club owner';
 assert (select count(*)=4 from epp_team_members where team_id=team),'four active and two reserve';
 rejected:=false;begin perform epp_team_save(admin_id,m,'pistool',team,1,people[1:4],1);exception when others then if sqlerrm='geen_beheerrechten' then rejected:=true;else raise;end if;end;assert rejected,'legacy club API cannot hijack group team';
 rejected:=false;begin perform epp_team_group_lineup_save(member_id,g,m,'pistool',people[1:4],0);exception when others then if sqlerrm='team_conflict' then rejected:=true;else raise;end if;end;assert rejected,'lineup revision enforced';
 -- A reserve may replace a selected shooter before scores are confirmed.
 perform epp_team_group_lineup_save(member_id,g,m,'pistool',array[people[1],people[2],people[3],people[5]],1);
 perform epp_team_group_lineup_save(member_id,g,m,'pistool',people[1:4],2);
 -- The same people can represent this independent group in the other discipline.
 perform epp_team_group_lineup_save(member_id,g,m,'optiek',people[3:6],0);
 -- Another team in the same match and discipline cannot count the same shooter.
 for i in 1..4 loop insert into epp_team_group_members(group_id,name,shooter_id) values(g2,'Second group '||i,people[i]);end loop;
 rejected:=false;begin perform epp_team_group_lineup_save(head_id,g2,m,'pistool',people[1:4],0);exception when others then if sqlerrm='schutter_al_in_team' then rejected:=true;else raise;end if;end;assert rejected,'one team per shooter and discipline';
 insert into seasons(naam,start_date,end_date) values('Independent Test '||g,'2035-01-01','2035-12-31') returning id into season;
 insert into rule_profiles(version) values('Independent Test '||g) returning id into rule;
 insert into divisions(naam) values('EPP pistool') on conflict(naam) do nothing;select id into div from divisions where naam='EPP pistool';
 insert into events(organizer_club_id,season_id,naam,type,local_date,rule_profile_id,ranking_eligible,registration_match_id) values(c1,season,'Independent Test '||g,'wedstrijd','2035-11-14',rule,true,m) returning id into ev;
 insert into rounds(event_id) values(ev) returning id into rd;
 for i in 1..3 loop insert into results(round_id,shooter_id,division_id,represented_club_id,entry_mode,final_score,status) values(rd,people[i],div,case when i%2=1 then c1 else c2 end,'total',250-i*10,'confirmed');end loop;
 v:=epp_team_context(member_id,m,'pistool');assert exists(select 1 from jsonb_array_elements(v->'teams') t where t->>'id'=team::text and (t->>'completed')::integer=3 and t->>'position' is null),'incomplete teams unranked';
 for i in 4..6 loop insert into results(round_id,shooter_id,division_id,represented_club_id,entry_mode,final_score,status) values(rd,people[i],div,case when i%2=1 then c1 else c2 end,'total',case when i=4 then 210 else 250 end,'confirmed');end loop;
 insert into events(organizer_club_id,season_id,naam,type,local_date,rule_profile_id,ranking_eligible,registration_match_id) values(c2,season,'Other Independent Test '||g,'wedstrijd','2035-12-14',rule,true,m2) returning id into ev2;
 insert into rounds(event_id) values(ev2) returning id into rd2;
 insert into results(round_id,shooter_id,division_id,represented_club_id,entry_mode,final_score,status) values(rd2,people[1],div,c1,'total',250,'confirmed');
 v:=epp_team_context(member_id,m,'pistool');
 assert exists(select 1 from jsonb_array_elements(v->'teams') t where t->>'id'=team::text and (t->>'completed')::integer=4 and (t->>'score')::integer=900 and (t->>'position')::integer=1 and t->>'teamName' like 'Dreamteam Test %' and (t->>'locked')::boolean),'only selected four, across clubs, same match, ranked by correct total';
 assert (select count(distinct r.represented_club_id)=2 from results r where round_id=rd),'individual club representation retained';
 rejected:=false;begin perform epp_team_group_lineup_save(member_id,g,m,'pistool',people[3:6],3);exception when others then if sqlerrm='team_vast_na_score' then rejected:=true;else raise;end if;end;assert rejected,'cannot replace shooters after confirmed score';
 rejected:=false;begin perform epp_team_group_lineup_save(head_id,g,m,'pistool','{}',3,true);exception when others then if sqlerrm='team_vast_na_score' then rejected:=true;else raise;end if;end;assert rejected,'cannot delete scored team';
 perform epp_team_group_lineup_save(member_id,g,m,'optiek','{}',1,true);
 assert not exists(select 1 from epp_teams where group_id=g and discipline='optiek'),'unscored lineup removable';
 update epp_matches set archived_at=now() where id=m2;
 rejected:=false;begin perform epp_team_group_lineup_save(head_id,g,m2,'pistool',people[1:4],0);exception when others then if sqlerrm='ongeldige_wedstrijd_of_discipline' then rejected:=true;else raise;end if;end;assert rejected,'archived match denied';
 assert not has_function_privilege('anon','epp_team_group_lineup_save(uuid,uuid,uuid,text,uuid[],integer,boolean)','EXECUTE'),'anonymous RPC denied';
 assert not has_function_privilege('authenticated','epp_team_group_link(uuid,uuid,uuid,uuid,integer)','EXECUTE'),'direct authenticated RPC denied';
 bid:=epp_capture_backup();assert (select snapshot?'epp_team_groups' and snapshot?'epp_team_group_members' and snapshot?'epp_team_group_audit' from platform_backups where id=bid),'group data included in backup';
end $$;
rollback;
