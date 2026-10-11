begin;
do $$
declare head uuid;local_admin uuid;member uuid;sid uuid;cid uuid;ops jsonb;denied boolean;
begin
 insert into app_accounts(club_code,username,display_name,role,is_admin,is_platform_admin) values('eppnationaal','dropdown.head.'||gen_random_uuid(),'Dropdown Head','trainer',true,true) returning id into head;
 insert into app_accounts(club_code,username,display_name,role,is_admin) values('gast','dropdown.admin.'||gen_random_uuid(),'Dropdown Admin','trainer',true) returning id into local_admin;
 insert into app_accounts(club_code,username,display_name,role,membership_approved) values('svbb','dropdown.member.'||gen_random_uuid(),'Dropdown Member','schutter',true) returning id into member;
 insert into platform_users(id) values(member);
 insert into shooters(display_name,linked_user_id) values('Dropdown Member',member) returning id into sid;
 select id into cid from clubs where code='svbb';
 insert into memberships(shooter_id,club_id) values(sid,cid);
 ops:=jsonb_build_array(jsonb_build_object('kind','shooter','id',sid,'value',jsonb_build_object('id',sid,'naam','Dropdown Member'),'expected',null));
 perform epp_training_apply('eppnationaal',head,ops);
 assert exists(select 1 from training_entities where club_code='eppnationaal' and entity_id=sid::text),'head adds registered foreign shooter';
 assert (select count(*) from memberships where shooter_id=sid)=1,'head training does not create false club membership';
 denied:=false;begin perform epp_training_apply('gast',local_admin,ops);exception when others then if sqlerrm='schutter_niet_van_vereniging' then denied:=true;else raise;end if;end;
 assert denied,'local trainer cannot add foreign shooter';
end $$;
select 'PASS head selects foreign registered shooter; local permissions and memberships preserved' as result;
rollback;
