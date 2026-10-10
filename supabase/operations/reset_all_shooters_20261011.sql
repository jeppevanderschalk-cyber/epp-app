-- Explicitly requested by the owner: remove every user except hoofdbeheer.
-- Rehearsal succeeded with rollback before this one-time committed reset.
begin;
lock table app_accounts,app_sessions,shooters,results,training_entities,epp_signups,epp_teams in share row exclusive mode;
create temporary table reset_keep_head on commit drop as
select id from app_accounts where username='hoofdbeheer' and active and is_platform_admin and is_admin and role='trainer';
do $$ begin
  if (select count(*) from reset_keep_head)<>1 then raise exception 'hoofdbeheer_niet_uniek';end if;
end $$;
create temporary table reset_before on commit drop as
select (select count(*) from app_accounts) accounts,(select count(*) from shooters) shooters,
 (select count(*) from results) results,(select count(*) from epp_signups) signups,
 (select count(*) from epp_matches) matches,(select count(*) from epp_match_slots) slots,
 (select count(*) from clubs) clubs;
delete from app_sessions;
delete from epp_score_leases;
delete from epp_match_scorers;
delete from result_audit;
delete from results;
delete from qualification_audit;
delete from shooter_qualifications;
delete from epp_team_audit;
delete from epp_team_members;
delete from epp_teams;
delete from epp_signup_disciplines;
delete from epp_signups;
delete from training_audit;
delete from training_entities;
delete from training_shooter_aliases;
delete from epp_sync;
delete from epp_access_audit;
delete from epp_planner_audit;
delete from epp_scoring_audit;
delete from memberships;
delete from shooters;
delete from event_permissions where user_id not in(select id from reset_keep_head);
delete from club_roles where user_id not in(select id from reset_keep_head);
update epp_match_planners set updated_by=(select id from reset_keep_head);
delete from app_accounts where id not in(select id from reset_keep_head);
delete from platform_users where id not in(select id from reset_keep_head);
delete from trainer_credentials;
-- Old internal snapshots contain the deleted personal data too.
delete from platform_backups;
select epp_capture_backup();
do $$ begin
  if (select count(*) from app_accounts)<>1 or exists(select 1 from shooters) or exists(select 1 from results) or exists(select 1 from epp_signups) then raise exception 'reset_onvolledig';end if;
  if (select count(*) from epp_matches)<>(select matches from reset_before)
    or (select count(*) from epp_match_slots)<>(select slots from reset_before)
    or (select count(*) from clubs)<>(select clubs from reset_before) then raise exception 'wedstrijdinstellingen_veranderd';end if;
end $$;
select *,true as reset_completed from reset_before;
commit;
