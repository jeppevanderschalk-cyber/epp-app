begin;
do $$
declare admin uuid;head uuid;outsider uuid;one uuid;two uuid;separate uuid;gid uuid:=gen_random_uuid();denied boolean;audits bigint;
begin
 insert into app_accounts(club_code,username,display_name,role,is_admin) values('svbb','archive.admin.'||gen_random_uuid(),'Archive Admin','trainer',true) returning id into admin;
 insert into app_accounts(club_code,username,display_name,role,is_admin,is_platform_admin) values('eppnationaal','archive.head.'||gen_random_uuid(),'Archive Head','trainer',true,true) returning id into head;
 insert into app_accounts(club_code,username,display_name,role,is_admin) values('gast','archive.other.'||gen_random_uuid(),'Archive Other','trainer',true) returning id into outsider;
 insert into epp_matches(club_id,organizer,match_date,event_group_id) values('svbb','Archive Group Test','2035-01-01',gid) returning id into one;
 insert into epp_matches(club_id,organizer,match_date,event_group_id) values('mercurius75','Archive Group Test','2035-01-01',gid) returning id into two;
 insert into epp_matches(club_id,organizer,match_date) values('gast','Archive Group Test','2035-01-01') returning id into separate;
 denied:=false;begin perform epp_archive_match(outsider,one);exception when others then if sqlerrm='geen_beheerrechten' then denied:=true;else raise;end if;end;
 assert denied,'foreign administrator cannot archive unrelated event';
 perform epp_archive_match(admin,one);
 assert (select bool_and(archived_at is not null) from epp_matches where event_group_id=gid),'local administrator archives all copies';
 assert (select archived_at is null from epp_matches where id=separate),'same name/date alone does not link events';
 select count(*) into audits from epp_planner_audit where match_id in (one,two) and action='archive';
 assert audits=2,'each copy has an audit';
 perform epp_archive_match(admin,one);
 assert audits=(select count(*) from epp_planner_audit where match_id in (one,two) and action='archive'),'repeated archiving is idempotent';
 perform epp_archive_match(head,separate);
 assert (select archived_at is not null from epp_matches where id=separate),'head can archive foreign event';
 assert exists(select 1 from epp_matches where id=one) and exists(select 1 from epp_matches where id=two),'archive preserves records';
 assert not has_function_privilege('anon','epp_archive_match(uuid,uuid)','execute'),'anonymous archive denied';
end $$;
select 'PASS global archive: local/head rights, all copies, isolation, audit and idempotency' as result;
rollback;
