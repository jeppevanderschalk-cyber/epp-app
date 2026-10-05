begin;
select pg_advisory_xact_lock(hashtextextended('training:svbb',0));
lock table public.app_accounts,public.app_sessions,public.training_entities,public.epp_signups,public.results,public.memberships,public.shooters in share row exclusive mode;
-- Explicitly requested by the owner: reset SVBB only, including scores/signups.
select public.epp_capture_backup();
create temporary table reset_svbb_ids on commit drop as
select distinct s.id from shooters s where
exists(select 1 from memberships m join clubs c on c.id=m.club_id where m.shooter_id=s.id and c.code='svbb')
or exists(select 1 from training_entities t where t.club_code='svbb' and t.kind='shooter' and t.entity_id=s.id::text);

delete from epp_signups where match_id in(select id from epp_matches where club_id='svbb');
delete from results where represented_club_id=(select id from clubs where code='svbb');
insert into training_audit(club_code,kind,entity_id,before_data,after_data)
select club_code,kind,entity_id,data,null from training_entities where club_code='svbb' and kind<>'meta' and data is not null;
update training_entities set data=null,revision=revision+1,updated_at=now() where club_code='svbb' and kind<>'meta';
insert into training_entities(club_code,kind,entity_id,data) values
('svbb','meta','currentTraining',jsonb_build_object('id',gen_random_uuid(),'mode','parcours','stage','s1','startedAt',floor(extract(epoch from now())*1000))),
('svbb','meta','tombstones',jsonb_build_object('resetAt',floor(extract(epoch from now())*1000)))
on conflict(club_code,kind,entity_id)do update set data=excluded.data,revision=training_entities.revision+1,updated_at=now();
delete from memberships where club_id=(select id from clubs where code='svbb') and shooter_id in(select id from reset_svbb_ids);
update app_accounts set active=false where club_code='svbb' and role='schutter' and username<>'kijker';
-- Revoke only the disabled SVBB personal accounts; preserve shared/admin access.
delete from app_sessions where account_id in(select id from app_accounts where club_code='svbb' and role='schutter' and username<>'kijker' and not active);
delete from shooters s where s.id in(select id from reset_svbb_ids)
and not exists(select 1 from memberships m where m.shooter_id=s.id)
and not exists(select 1 from results r where r.shooter_id=s.id)
and not exists(select 1 from epp_signups r where r.shooter_id=s.id);
commit;
