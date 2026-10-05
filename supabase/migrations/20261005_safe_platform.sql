begin;
insert into public.clubs(code,naam) values('svbb','SVBB'),('mercurius75','SV Mercurius ''75'),('eppnationaal','EPP Nationaal'),('gast','Gast') on conflict do nothing;
create table if not exists public.app_accounts (
  id uuid primary key default gen_random_uuid(),
  club_code text not null,
  username text not null,
  display_name text not null,
  role text not null check(role in ('trainer','schutter')),
  is_admin boolean not null default false,
  active boolean not null default true,
  legacy boolean not null default false,
  password_salt text,
  password_hash text,
  iterations integer not null default 600000,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  unique(club_code,username)
);
create table if not exists public.app_sessions (
  token_hash text primary key,
  account_id uuid not null references public.app_accounts(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
insert into public.app_accounts(club_code,username,display_name,role,is_admin,legacy)
select code,'beheer','Migratiebeheer '||label,'trainer',true,true
from (values ('svbb','SVBB'),('mercurius75','SV Mercurius ''75'),('eppnationaal','EPP Nationaal'),('gast','Gast')) c(code,label)
on conflict do nothing;
insert into public.app_accounts(club_code,username,display_name,role,legacy)
select code,'kijker','Meekijkers '||code,'schutter',true from (values ('svbb'),('eppnationaal')) c(code)
on conflict do nothing;

create table if not exists public.training_entities (
  club_code text not null,
  kind text not null check(kind in ('shooter','round','shot','meta','parcoursBest','stageBest','legacyScore','archive')),
  entity_id text not null,
  data jsonb,
  revision bigint not null default 1,
  updated_by uuid references public.app_accounts(id),
  updated_at timestamptz not null default now(),
  primary key(club_code,kind,entity_id)
);
create table if not exists public.training_audit (
  id bigint generated always as identity primary key,
  club_code text not null,kind text not null,entity_id text not null,
  actor_id uuid references public.app_accounts(id),before_data jsonb,after_data jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.platform_backups (
  id uuid primary key default gen_random_uuid(),
  snapshot jsonb not null,
  checksum text not null,
  created_at timestamptz not null default now()
);
alter table public.epp_signups add column if not exists shooter_id uuid references public.shooters(id);
alter table public.events add column if not exists registration_match_id uuid references public.epp_matches(id);
create unique index if not exists epp_event_match on public.events(registration_match_id) where registration_match_id is not null;
create unique index if not exists epp_signup_identity on public.epp_signups(match_id,shooter_id) where shooter_id is not null;

-- Keep legacy data untouched, but migrate each training item independently.
do $$
declare r record; s jsonb; item record; stage record; p jsonb; v_code text; cid uuid;
begin
  for r in select * from public.epp_sync where id in ('epp-app','epp-app-mercurius75','epp-app-nationaal','epp-app-gast') loop
    v_code:=case r.id when 'epp-app' then 'svbb' when 'epp-app-mercurius75' then 'mercurius75' when 'epp-app-nationaal' then 'eppnationaal' else 'gast' end;
    p:=r.payload;
    select id into cid from public.clubs where clubs.code=v_code;
    for s in select value from jsonb_array_elements(coalesce(p->'shooters','[]')) loop
      insert into public.shooters(id,display_name) values((s->>'id')::uuid,s->>'naam') on conflict(id) do nothing;
      insert into public.memberships(shooter_id,club_id) values((s->>'id')::uuid,cid) on conflict do nothing;
      insert into public.training_entities values(v_code,'shooter',s->>'id',s,1,null,now()) on conflict do nothing;
    end loop;
    for s in select value from jsonb_array_elements(coalesce(p#>'{currentTraining,rounds}','[]')) loop
      insert into public.training_entities values(v_code,'round',s->>'id',s,1,null,now()) on conflict do nothing;
    end loop;
    for s in select value from jsonb_array_elements(coalesce(p->'cameraShots','[]')) loop
      insert into public.training_entities values(v_code,'shot',s->>'id',s,1,null,now()) on conflict do nothing;
    end loop;
    insert into public.training_entities values(v_code,'meta','currentTraining',(p->'currentTraining')-'rounds'-'updatedAt',1,null,now()) on conflict do nothing;
    insert into public.training_entities values(v_code,'meta','stageShots',p->'stageShots',1,null,now()) on conflict do nothing;
    for item in select * from jsonb_each(coalesce(p->'bestParcours','{}')) loop
      insert into public.training_entities values(v_code,'parcoursBest',item.key,item.value,1,null,now()) on conflict do nothing;
    end loop;
    for stage in select * from jsonb_each(coalesce(p->'bestStageAverages','{}')) loop
      for item in select * from jsonb_each(stage.value) loop
        insert into public.training_entities values(v_code,'stageBest',stage.key||':'||item.key,item.value,1,null,now()) on conflict do nothing;
      end loop;
    end loop;
    for item in select * from jsonb_each(coalesce(p->'scores','{}')) loop
      insert into public.training_entities values(v_code,'legacyScore',item.key,item.value,1,null,now()) on conflict do nothing;
    end loop;
  end loop;
end $$;

-- Link existing registrations only when the name uniquely identifies a club member.
with candidates as (
  select reg.id,array_agg(distinct s.id) as ids
  from epp_signups reg join epp_matches m on m.id=reg.match_id
  join clubs c on c.code=m.club_id join memberships member on member.club_id=c.id
  join shooters s on s.id=member.shooter_id
  where reg.shooter_id is null and lower(trim(s.display_name))=lower(trim(reg.shooter_name))
  group by reg.id
)
update epp_signups reg set shooter_id=candidates.ids[1]
from candidates where reg.id=candidates.id and cardinality(candidates.ids)=1;
alter table epp_signups drop constraint if exists epp_signups_match_id_shooter_name_key;

create or replace function public.epp_training_apply(p_club text,p_actor uuid,p_ops jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare op jsonb; old public.training_entities; expected jsonb; wanted jsonb; cid uuid;
begin
  if not exists(select 1 from app_accounts where id=p_actor and club_code=p_club and active and role='trainer') then raise exception 'geen_schrijfrechten'; end if;
  perform pg_advisory_xact_lock(hashtextextended('training:'||p_club,0));
  if jsonb_typeof(p_ops)<>'array' or jsonb_array_length(p_ops)>5000 then raise exception 'ongeldige_bewerking'; end if;
  select id into cid from clubs where code=p_club;
  for op in select value from jsonb_array_elements(p_ops) loop
    expected:=nullif(op->'expected','null'); wanted:=nullif(op->'value','null');
    select * into old from training_entities where club_code=p_club and kind=op->>'kind' and entity_id=op->>'id' for update;
    if old.data is not distinct from wanted then continue; end if;
    if old.data is distinct from expected then raise exception 'opslag_conflict:%:%',op->>'kind',op->>'id'; end if;
    if op->>'kind'='shooter' and wanted is not null then
      if not exists(select 1 from shooters where id=(op->>'id')::uuid) then
        insert into shooters(id,display_name) values((op->>'id')::uuid,wanted->>'naam');
      elsif not exists(select 1 from memberships where shooter_id=(op->>'id')::uuid and club_id=cid) then
        raise exception 'schutter_niet_van_vereniging';
      end if;
      insert into memberships(shooter_id,club_id) values((op->>'id')::uuid,cid) on conflict do nothing;
    end if;
    insert into training_audit(club_code,kind,entity_id,actor_id,before_data,after_data) values(p_club,op->>'kind',op->>'id',p_actor,old.data,wanted);
    insert into training_entities(club_code,kind,entity_id,data,updated_by)
    values(p_club,op->>'kind',op->>'id',wanted,p_actor)
    on conflict(club_code,kind,entity_id) do update set data=excluded.data,revision=training_entities.revision+1,updated_by=p_actor,updated_at=now();
  end loop;
  return jsonb_build_object('ok',true,'entities',(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',entity_id,'data',data)),'[]') from training_entities where club_code=p_club));
end $$;

create or replace function public.epp_capture_backup() returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare snap jsonb; bid uuid;
begin
  snap:=jsonb_build_object('training_entities',(select coalesce(jsonb_agg(t),'[]') from training_entities t),'shooters',(select coalesce(jsonb_agg(t),'[]') from shooters t),'memberships',(select coalesce(jsonb_agg(t),'[]') from memberships t),'results',(select coalesce(jsonb_agg(t),'[]') from results t),'result_audit',(select coalesce(jsonb_agg(t),'[]') from result_audit t),'events',(select coalesce(jsonb_agg(t),'[]') from events t),'rounds',(select coalesce(jsonb_agg(t),'[]') from rounds t),'epp_matches',(select coalesce(jsonb_agg(t),'[]') from epp_matches t),'epp_signups',(select coalesce(jsonb_agg(t),'[]') from epp_signups t),'epp_signup_disciplines',(select coalesce(jsonb_agg(t),'[]') from epp_signup_disciplines t));
  snap:=snap||jsonb_build_object('clubs',(select coalesce(jsonb_agg(t),'[]') from clubs t),'seasons',(select coalesce(jsonb_agg(t),'[]') from seasons t),'divisions',(select coalesce(jsonb_agg(t),'[]') from divisions t),'rule_profiles',(select coalesce(jsonb_agg(t),'[]') from rule_profiles t),'platform_users',(select coalesce(jsonb_agg(t),'[]') from platform_users t),'club_roles',(select coalesce(jsonb_agg(t),'[]') from club_roles t),'event_permissions',(select coalesce(jsonb_agg(t),'[]') from event_permissions t),'app_accounts',(select coalesce(jsonb_agg(t),'[]') from app_accounts t),'training_audit',(select coalesce(jsonb_agg(t),'[]') from training_audit t),'epp_sync',(select coalesce(jsonb_agg(t),'[]') from epp_sync t),'trainer_credentials',(select coalesce(jsonb_agg(t),'[]') from trainer_credentials t));
  delete from app_sessions where expires_at<now();
  insert into platform_backups(snapshot,checksum) values(snap,encode(digest(snap::text,'sha256'),'hex')) returning id into bid;
  delete from platform_backups where created_at<now()-interval '90 days';
  return bid;
end $$;

create or replace function public.epp_signup_save(p_actor uuid,p_club text,p_match uuid,p_shooter uuid,p_disciplines jsonb,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m epp_matches; a app_accounts; sid uuid; name text; d jsonb; cid uuid;
begin
  select * into a from app_accounts where id=p_actor and club_code=p_club and active;
  if a.id is null then raise exception 'geen_toegang'; end if;
  select * into m from epp_matches where id=p_match and club_id=p_club for update;
  if m.id is null then raise exception 'wedstrijd_niet_gevonden'; end if;
  if m.deadline is not null and (now() at time zone 'Europe/Amsterdam')::date>m.deadline then raise exception 'deadline_verstreken'; end if;
  select id into cid from clubs where code=p_club;
  select display_name into name from shooters where id=p_shooter and exists(select 1 from memberships where shooter_id=p_shooter and club_id=cid);
  if name is null then raise exception 'schutter_niet_van_vereniging'; end if;
  if a.role='schutter' and not exists(select 1 from shooters where id=p_shooter and linked_user_id=p_actor) then raise exception 'alleen_eigen_inschrijving'; end if;
  if p_delete then
    delete from epp_signups where match_id=p_match and shooter_id=p_shooter;
  else
    if jsonb_typeof(p_disciplines)<>'array' or jsonb_array_length(p_disciplines) not between 1 and 3 then raise exception 'minimaal_een_discipline'; end if;
    for d in select value from jsonb_array_elements(p_disciplines) loop
      if not(d->>'discipline'=any(m.offered_disciplines)) or d->>'time_block' not in ('ochtend','middag','geen_voorkeur') or (nullif(d->>'specific_time','') is not null and d->>'specific_time' !~ '^(09|1[0-6]):(00|30)$') then raise exception 'ongeldige_discipline_invoer'; end if;
    end loop;
    insert into epp_signups(match_id,shooter_id,shooter_name) values(p_match,p_shooter,name)
    on conflict(match_id,shooter_id) where shooter_id is not null do update set updated_at=now(),shooter_name=excluded.shooter_name returning id into sid;
    delete from epp_signup_disciplines where signup_id=sid;
    insert into epp_signup_disciplines(signup_id,discipline,time_block,specific_time)
    select sid,x->>'discipline',x->>'time_block',nullif(x->>'specific_time','') from jsonb_array_elements(p_disciplines) x;
  end if;
  if m.mail_status='verstuurd' then update epp_matches set mail_status='gewijzigd' where id=m.id; end if;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.epp_confirm_result(p_actor uuid,p_club uuid,p_round uuid,p_shooter uuid,p_division uuid,p_counts jsonb,p_key text,p_expected integer default 0,p_reason text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare old results; saved results; gross integer; final integer; h5 integer;h4 integer;h3 integer;h2 integer;miss integer;pen integer;
begin
  if not exists(select 1 from app_accounts a join clubs c on c.code=a.club_code where a.id=p_actor and c.id=p_club and a.active and a.role='trainer') then raise exception 'geen_schrijfrechten'; end if;
  if not exists(select 1 from rounds r join events e on e.id=r.event_id where r.id=p_round and e.organizer_club_id=p_club and e.type='wedstrijd') then raise exception 'ongeldige_ronde'; end if;
  if not exists(select 1 from memberships where shooter_id=p_shooter and club_id=p_club) then raise exception 'schutter_niet_van_vereniging'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_round::text||p_shooter::text,0));
  select * into saved from results where idempotency_key=p_key;
  if saved.id is not null then
    if saved.round_id<>p_round or saved.shooter_id<>p_shooter or saved.represented_club_id<>p_club then raise exception 'ongeldige_herhaling'; end if;
    return to_jsonb(saved);
  end if;
  h5:=(p_counts->>'hits5')::integer;h4:=(p_counts->>'hits4')::integer;h3:=(p_counts->>'hits3')::integer;h2:=(p_counts->>'hits2')::integer;miss:=(p_counts->>'misses')::integer;pen:=(p_counts->>'penaltyPoints')::integer;
  if h5 is null or h4 is null or h3 is null or h2 is null or miss is null or pen is null or least(h5,h4,h3,h2,miss,pen)<0 or h5+h4+h3+h2+miss<>50 then raise exception 'exact_50_schoten_verplicht'; end if;
  gross:=h5*5+h4*4+h3*3+h2*2;final:=gross-pen;
  if final not between 0 and 250 then raise exception 'eindscore_buiten_bereik'; end if;
  select * into old from results where round_id=p_round and shooter_id=p_shooter and division_id=p_division for update;
  if coalesce(old.revision,0)<>p_expected then raise exception 'score_conflict'; end if;
  if old.id is not null and length(trim(p_reason))<3 then raise exception 'correctiereden_verplicht'; end if;
  insert into results(round_id,shooter_id,division_id,represented_club_id,entry_mode,hits5,hits4,hits3,hits2,misses,gross_score,penalty_points,final_score,status,revision,idempotency_key,created_by,confirmed_by,confirmed_at)
  values(p_round,p_shooter,p_division,p_club,'counted',h5,h4,h3,h2,miss,gross,pen,final,'confirmed',coalesce(old.revision,0)+1,p_key,p_actor,p_actor,now())
  on conflict(round_id,shooter_id,division_id) do update set entry_mode='counted',status='confirmed',hits5=h5,hits4=h4,hits3=h3,hits2=h2,misses=miss,gross_score=gross,penalty_points=pen,final_score=final,revision=excluded.revision,idempotency_key=p_key,confirmed_by=p_actor,confirmed_at=now() returning * into saved;
  insert into result_audit(result_id,actor_id,action,before,after,reason) values(saved.id,p_actor,case when old.id is null then 'confirmed' else 'corrected' end,to_jsonb(old),to_jsonb(saved),nullif(trim(p_reason),''));
  return to_jsonb(saved);
end $$;

alter table app_accounts enable row level security;
alter table app_sessions enable row level security;
alter table training_entities enable row level security;
alter table training_audit enable row level security;
alter table platform_backups enable row level security;
revoke all on app_accounts,app_sessions,training_entities,training_audit,platform_backups from anon,authenticated;
grant all on app_accounts,app_sessions,training_entities,training_audit,platform_backups to service_role;
grant usage,select on sequence training_audit_id_seq to service_role;
revoke all on function epp_training_apply(text,uuid,jsonb),epp_capture_backup(),epp_signup_save(uuid,text,uuid,uuid,jsonb,boolean),epp_confirm_result(uuid,uuid,uuid,uuid,uuid,jsonb,text,integer,text) from public,anon,authenticated;
grant execute on function epp_training_apply(text,uuid,jsonb),epp_capture_backup(),epp_signup_save(uuid,text,uuid,uuid,jsonb,boolean),epp_confirm_result(uuid,uuid,uuid,uuid,uuid,jsonb,text,integer,text) to service_role;
insert into platform_users(id,auth_provider_id) select id,'epp-account:'||id from app_accounts on conflict do nothing;
create or replace function public.epp_account_failure(p_id uuid) returns void language sql security definer set search_path=public as $$
  update app_accounts set failed_attempts=failed_attempts+1,locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else locked_until end where id=p_id;
$$;
create or replace function public.epp_create_account(p_actor uuid,p_username text,p_name text,p_role text,p_admin boolean,p_salt text,p_hash text,p_shooter uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare a app_accounts; new_id uuid; cid uuid;
begin
  select * into a from app_accounts where id=p_actor and active and is_admin and role='trainer';
  if a.id is null then raise exception 'geen_beheerrechten'; end if;
  select id into cid from clubs where code=a.club_code;
  if p_role='schutter' and not exists(select 1 from memberships m join shooters s on s.id=m.shooter_id where m.club_id=cid and s.id=p_shooter and s.linked_user_id is null) then raise exception 'selecteer_ongekoppelde_schutter'; end if;
  insert into app_accounts(club_code,username,display_name,role,is_admin,password_salt,password_hash) values(a.club_code,p_username,p_name,p_role,p_role='trainer' and p_admin,p_salt,p_hash) returning id into new_id;
  insert into platform_users(id,auth_provider_id) values(new_id,'epp-account:'||new_id);
  if p_role='schutter' then update shooters set linked_user_id=new_id where id=p_shooter and linked_user_id is null; if not found then raise exception 'schutter_al_gekoppeld'; end if; end if;
  return new_id;
end $$;
revoke all on function epp_account_failure(uuid),epp_create_account(uuid,text,text,text,boolean,text,text,uuid) from public,anon,authenticated;
grant execute on function epp_account_failure(uuid),epp_create_account(uuid,text,text,text,boolean,text,text,uuid) to service_role;
select epp_capture_backup();
create or replace function public.epp_change_account_password(p_actor uuid,p_old_hash text,p_salt text,p_hash text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update app_accounts set password_salt=p_salt,password_hash=p_hash
  where id=p_actor and active and password_hash=p_old_hash;
  if not found then raise exception 'wachtwoord_al_gewijzigd'; end if;
  delete from app_sessions where account_id=p_actor;
end $$;
create or replace function public.epp_register_shooter(p_actor uuid,p_id uuid,p_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a app_accounts; cid uuid; s shooters;
begin
  select * into a from app_accounts where id=p_actor and active and role='trainer';
  if a.id is null then raise exception 'geen_schrijfrechten'; end if;
  select id into cid from clubs where code=a.club_code;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into s from shooters where id=p_id;
  if s.id is not null then
    if not exists(select 1 from memberships where shooter_id=p_id and club_id=cid) then raise exception 'schutter_niet_van_vereniging'; end if;
    return to_jsonb(s);
  end if;
  if length(trim(p_name)) not between 2 and 100 then raise exception 'schutter_naam_verplicht'; end if;
  insert into shooters(id,display_name) values(p_id,trim(p_name)) returning * into s;
  insert into memberships(shooter_id,club_id) values(p_id,cid);
  insert into training_entities(club_code,kind,entity_id,data,updated_by)
  values(a.club_code,'shooter',p_id::text,jsonb_build_object('id',p_id,'naam',s.display_name),p_actor);
  insert into training_audit(club_code,kind,entity_id,actor_id,after_data)
  values(a.club_code,'shooter',p_id::text,p_actor,jsonb_build_object('id',p_id,'naam',s.display_name));
  return to_jsonb(s);
end $$;
revoke all on function epp_change_account_password(uuid,text,text,text),epp_register_shooter(uuid,uuid,text) from public,anon,authenticated;
grant execute on function epp_change_account_password(uuid,text,text,text),epp_register_shooter(uuid,uuid,text) to service_role;
create or replace function public.epp_restore_training(p_actor uuid,p_backup uuid,p_expected timestamptz)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare a app_accounts; b platform_backups; item jsonb; before_row training_entities; stamp timestamptz;
begin
  select * into a from app_accounts where id=p_actor and active and is_admin and role='trainer';
  if a.id is null then raise exception 'geen_beheerrechten'; end if;
  perform pg_advisory_xact_lock(hashtextextended('training:'||a.club_code,0));
  select max(updated_at) into stamp from training_entities where club_code=a.club_code;
  if stamp is distinct from p_expected then raise exception 'herstel_conflict'; end if;
  select * into b from platform_backups where id=p_backup;
  if b.id is null or encode(digest(b.snapshot::text,'sha256'),'hex')<>b.checksum then raise exception 'backup_ongeldig'; end if;
  perform epp_capture_backup();
  for before_row in select * from training_entities where club_code=a.club_code loop
    insert into training_audit(club_code,kind,entity_id,actor_id,before_data,after_data)
    values(a.club_code,before_row.kind,before_row.entity_id,p_actor,before_row.data,null);
  end loop;
  update training_entities set data=null,revision=revision+1,updated_at=now(),updated_by=p_actor where club_code=a.club_code;
  for item in select value from jsonb_array_elements(b.snapshot->'training_entities') where value->>'club_code'=a.club_code loop
    insert into training_entities(club_code,kind,entity_id,data,updated_by)
    values(a.club_code,item->>'kind',item->>'entity_id',nullif(item->'data','null'),p_actor)
    on conflict(club_code,kind,entity_id) do update set data=excluded.data,revision=training_entities.revision+1,updated_at=now(),updated_by=p_actor;
    insert into training_audit(club_code,kind,entity_id,actor_id,after_data)
    values(a.club_code,item->>'kind',item->>'entity_id',p_actor,nullif(item->'data','null'));
  end loop;
end $$;
revoke all on function epp_restore_training(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function epp_restore_training(uuid,uuid,timestamptz) to service_role;
create or replace function public.epp_disable_account(p_actor uuid,p_target uuid)
returns void language plpgsql security definer set search_path=public as $$
declare a app_accounts; target app_accounts;
begin
  select * into a from app_accounts where id=p_actor;
  perform pg_advisory_xact_lock(hashtextextended('accounts:'||a.club_code,0));
  select * into a from app_accounts where id=p_actor and active and is_admin and role='trainer';
  if a.id is null then raise exception 'geen_beheerrechten'; end if;
  if p_actor=p_target then raise exception 'eigen_account_niet_blokkeren'; end if;
  select * into target from app_accounts where id=p_target and club_code=a.club_code;
  if target.id is null then raise exception 'account_niet_gevonden'; end if;
  update app_accounts set active=false where id=p_target;
  update platform_users set actief=false where id=p_target;
  delete from app_sessions where account_id=p_target;
end $$;
revoke all on function epp_disable_account(uuid,uuid) from public,anon,authenticated;
grant execute on function epp_disable_account(uuid,uuid) to service_role;
commit;
