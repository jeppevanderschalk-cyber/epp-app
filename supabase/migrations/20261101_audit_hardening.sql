begin;
alter table app_accounts add column email text;
alter table app_accounts add column membership_approved boolean not null default true;
create unique index epp_unique_member_email on app_accounts(lower(email)) where deleted_at is null and email is not null;
create function epp_pending_privilege_guard() returns trigger language plpgsql set search_path=public as $$
begin
  if not new.membership_approved and (new.is_admin or new.is_platform_admin or new.role='trainer') then raise exception 'vereniging_goedkeuring_nodig';end if;return new;
end $$;
create trigger epp_pending_privilege_guard before insert or update on app_accounts for each row execute function epp_pending_privilege_guard();
drop trigger epp_personal_account_identity on app_accounts;
drop index epp_one_named_personal_account;

create function public.epp_register_pending_member(p_actor uuid,p_club text,p_username text,p_first text,p_last text,p_email text,p_salt text,p_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare aid uuid;sid uuid;cid uuid;
begin
  if not exists(select 1 from app_accounts where id=p_actor and active and username='kijker' and role='schutter') then raise exception 'registratie_niet_toegestaan';end if;
  select id into cid from clubs where code=p_club and actief and code not in ('gast','eppnationaal');
  if cid is null then raise exception 'vereniging_verplicht';end if;
  if length(trim(p_first)) not between 1 and 70 or length(trim(p_last)) not between 1 and 70 or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_username !~ '^lid\.[a-f0-9]{40}$' or p_salt !~ '^[a-f0-9]{48}$' or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'ongeldige_accountgegevens';end if;
  perform pg_advisory_xact_lock(hashtextextended('register:'||p_club,0));
  if (select count(*) from app_accounts where club_code=p_club and username like 'lid.%' and created_at>now()-interval '1 day')>=100 then raise exception 'registratielimiet_bereikt';end if;
  if exists(select 1 from app_accounts where lower(email)=lower(p_email) and deleted_at is null) then raise exception 'email_al_geregistreerd';end if;
  insert into app_accounts(club_code,username,display_name,first_name,last_name,email,membership_approved,role,is_admin,password_salt,password_hash)
  values(p_club,p_username,trim(p_first)||' '||trim(p_last),trim(p_first),trim(p_last),lower(p_email),false,'schutter',false,p_salt,p_hash) returning id into aid;
  insert into platform_users(id,auth_provider_id) values(aid,'epp-account:'||aid);
  insert into shooters(display_name,linked_user_id,home_club_id) values(trim(p_first)||' '||trim(p_last),aid,cid) returning id into sid;
  insert into memberships(shooter_id,club_id) values(sid,cid);
  return aid;
end $$;
create function public.epp_approve_member(p_actor uuid,p_target uuid) returns void language plpgsql security definer set search_path=public as $$
declare a app_accounts;t app_accounts;s shooters;
begin
  select * into a from app_accounts where id=p_actor and active and is_admin and role='trainer' and not must_change_password;
  select * into t from app_accounts where id=p_target and active and deleted_at is null for update;
  if a.id is null or t.id is null or (a.club_code<>t.club_code and not a.is_platform_admin) then raise exception 'geen_beheerrechten';end if;
  if t.username not like 'lid.%' or t.is_platform_admin then raise exception 'persoonlijk_account_verplicht';end if;
  if t.membership_approved then return;end if;
  update app_accounts set membership_approved=true where id=t.id;
  select * into s from shooters where linked_user_id=t.id;
  insert into training_entities(club_code,kind,entity_id,data,updated_by) values(t.club_code,'shooter',s.id::text,jsonb_build_object('id',s.id,'naam',s.display_name),a.id) on conflict do nothing;
  insert into epp_access_audit(actor_id,target_id,before_data,after_data) values(a.id,t.id,jsonb_build_object('membership_approved',false),jsonb_build_object('membership_approved',true));
end $$;
revoke all on function epp_register_pending_member(uuid,text,text,text,text,text,text,text),epp_approve_member(uuid,uuid) from public,anon,authenticated;
grant execute on function epp_register_pending_member(uuid,text,text,text,text,text,text,text),epp_approve_member(uuid,uuid) to service_role;
-- Close the former self-registration routes: only the pending-account flow is exposed.
revoke execute on function epp_self_register_member(uuid,text,text,text,text,text),epp_register_member_at_club(uuid,text,text,text,text,text,text) from service_role;

alter table epp_matches add column archived_at timestamptz;
create function public.epp_archive_match(p_actor uuid,p_match uuid) returns void language plpgsql security definer set search_path=public as $$
declare m epp_matches;a app_accounts;
begin
  select * into a from app_accounts where id=p_actor and active and is_admin and role='trainer' and not must_change_password;
  select * into m from epp_matches where id=p_match for update;
  if a.id is null or m.id is null or (a.club_code<>m.club_id and not a.is_platform_admin) then raise exception 'geen_beheerrechten';end if;
  if m.archived_at is not null then return;end if;
  update epp_matches set archived_at=now() where id=m.id;
  insert into epp_planner_audit(match_id,actor_id,action,reason) values(m.id,a.id,'archive','Wedstrijd gearchiveerd; deelnemers en scores behouden');
end $$;
revoke all on function epp_archive_match(uuid,uuid) from public,anon,authenticated;
grant execute on function epp_archive_match(uuid,uuid) to service_role;
do $$
declare fname text;definition text;guard text:=E'\nbegin\n  perform 1 from epp_matches where id=p_match for share;\n  if exists(select 1 from epp_matches where id=p_match and archived_at is not null) then raise exception ''wedstrijd_gearchiveerd'';end if;\n';
begin
  foreach fname in array array['epp_scoring_prepare(uuid,uuid)','epp_planner_book(uuid,uuid,uuid,jsonb,integer,text)','epp_planner_configure(uuid,uuid,jsonb,integer)'] loop
    definition:=pg_get_functiondef(('public.'||fname)::regprocedure);
    if position(E'\nbegin\n' in definition)=0 then raise exception 'onverwachte_functie:%',fname;end if;
    execute replace(definition,E'\nbegin\n',guard);
  end loop;
end $$;

-- A single write path for official scores; preserve the internal validator for its caller.
alter function epp_confirm_result(uuid,uuid,uuid,uuid,uuid,jsonb,text,integer,text) rename to epp_confirm_result_internal;
create function epp_confirm_result(p_actor uuid,p_club uuid,p_round uuid,p_shooter uuid,p_division uuid,p_counts jsonb,p_key text,p_expected integer default 0,p_reason text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from rounds r join events e on e.id=r.event_id join epp_scoring_matches sm on sm.match_id=e.registration_match_id where r.id=p_round) then raise exception 'centrale_scoreinvoer_verplicht';end if;
  return epp_confirm_result_internal(p_actor,p_club,p_round,p_shooter,p_division,p_counts,p_key,p_expected,p_reason);
end $$;
revoke all on function epp_confirm_result_internal(uuid,uuid,uuid,uuid,uuid,jsonb,text,integer,text),epp_confirm_result(uuid,uuid,uuid,uuid,uuid,jsonb,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function epp_confirm_result(uuid,uuid,uuid,uuid,uuid,jsonb,text,integer,text) to service_role;
commit;
