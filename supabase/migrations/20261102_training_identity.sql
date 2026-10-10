begin;
create table training_shooter_aliases(club_code text not null references clubs(code),old_id text not null,new_id text not null,primary key(club_code,old_id));
alter table training_shooter_aliases enable row level security;
revoke all on training_shooter_aliases from anon,authenticated;
grant all on training_shooter_aliases to service_role;
-- These two IDs were verified as the same person; neither has score references.
do $$
declare old_id text:='d8456baa-68ee-451d-b49e-4b136eeca1fd';new_id text:='71732537-234b-4c41-b3a7-eae5f39d8b48';actor uuid;before_value jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('training:svbb',0));
  if not exists(select 1 from shooters s join app_accounts a on a.id=s.linked_user_id where s.id=new_id::uuid and a.active and a.display_name='Jeppe van der Schalk') then raise exception 'controle_actueel_account_mislukt';end if;
  if exists(select 1 from training_entities where club_code='svbb' and kind<>'shooter' and (data::text like '%'||old_id||'%' or entity_id like '%'||old_id||'%')) then raise exception 'scoreverwijzingen_eerst_samenvoegen';end if;
  select id into strict actor from app_accounts where active and is_platform_admin and username='hoofdbeheer';
  perform epp_capture_backup();
  select data into before_value from training_entities where club_code='svbb' and kind='shooter' and entity_id=old_id for update;
  if before_value is not null then
    insert into training_audit(club_code,kind,entity_id,actor_id,before_data,after_data) values('svbb','shooter',old_id,actor,before_value,null);
    update training_entities set data=null,revision=revision+1,updated_by=actor,updated_at=now() where club_code='svbb' and kind='shooter' and entity_id=old_id;
  end if;
  insert into training_shooter_aliases values('svbb',old_id,new_id);
end $$;
create function epp_training_identity_guard() returns trigger language plpgsql set search_path=public as $$
declare canonical text;
begin
  if new.data is null then return new;end if;
  if new.kind='shooter' then
    if exists(select 1 from training_shooter_aliases where club_code=new.club_code and old_id=new.entity_id) then raise exception 'schutter_samengevoegd';end if;
    perform pg_advisory_xact_lock(hashtextextended('training:'||new.club_code,0));
    if not exists(select 1 from shooters s join app_accounts a on a.id=s.linked_user_id where s.id=new.entity_id::uuid and a.active and a.membership_approved)
      and exists(select 1 from training_entities t where t.club_code=new.club_code and t.kind='shooter' and t.entity_id<>new.entity_id and t.data is not null and lower(trim(t.data->>'naam'))=lower(trim(new.data->>'naam'))) then raise exception 'schutter_al_in_training';end if;
  elsif new.kind in ('round','shot') then
    select new_id into canonical from training_shooter_aliases where club_code=new.club_code and old_id=new.data->>'sid';
    if canonical is not null then new.data:=jsonb_set(new.data,'{sid}',to_jsonb(canonical));end if;
  end if;
  return new;
end $$;
create trigger epp_training_identity_guard before insert or update of data on training_entities for each row execute function epp_training_identity_guard();
create function epp_backup_training_aliases() returns trigger language plpgsql set search_path=public,extensions as $$
begin
  new.snapshot:=new.snapshot||jsonb_build_object('training_shooter_aliases',(select coalesce(jsonb_agg(t),'[]') from training_shooter_aliases t));
  new.checksum:=encode(digest(new.snapshot::text,'sha256'),'hex');return new;
end $$;
create trigger epp_backup_training_aliases before insert on platform_backups for each row execute function epp_backup_training_aliases();
commit;
