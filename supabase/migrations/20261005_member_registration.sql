begin;
alter table public.app_accounts add column if not exists first_name text;
alter table public.app_accounts add column if not exists last_name text;
create or replace function public.epp_self_register_member(p_actor uuid,p_username text,p_first text,p_last text,p_salt text,p_hash text)
returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare a app_accounts; account_id uuid; shooter_id uuid; cid uuid; full_name text;
begin
  select * into a from app_accounts where id=p_actor and active for update;
  if a.id is null or a.role<>'schutter' or a.username<>'kijker' then raise exception 'registratie_niet_toegestaan'; end if;
  if length(trim(p_first)) not between 1 and 70 or length(trim(p_last)) not between 1 and 70
    or p_username !~ '^lid\.[a-f0-9]{40}$' or p_salt !~ '^[a-f0-9]{48}$' or p_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'ongeldige_accountgegevens'; end if;
  if (select count(*) from app_accounts where club_code=a.club_code and username like 'lid.%' and created_at>now()-interval '1 day')>=100
  then raise exception 'registratielimiet_bereikt'; end if;
  if exists(select 1 from app_accounts where club_code=a.club_code and username=p_username)then raise exception 'naam_al_geregistreerd'; end if;
  select id into strict cid from clubs where code=a.club_code;
  full_name:=trim(p_first)||' '||trim(p_last);
  insert into app_accounts(club_code,username,display_name,first_name,last_name,role,is_admin,password_salt,password_hash)
  values(a.club_code,p_username,full_name,trim(p_first),trim(p_last),'schutter',false,p_salt,p_hash) returning id into account_id;
  insert into platform_users(id,auth_provider_id)values(account_id,'epp-account:'||account_id);
  insert into shooters(display_name,linked_user_id)values(full_name,account_id) returning id into shooter_id;
  insert into memberships(shooter_id,club_id)values(shooter_id,cid);
  insert into training_entities(club_code,kind,entity_id,data,updated_by)
  values(a.club_code,'shooter',shooter_id::text,jsonb_build_object('id',shooter_id,'naam',full_name),account_id);
  insert into training_audit(club_code,kind,entity_id,actor_id,after_data)
  values(a.club_code,'shooter',shooter_id::text,account_id,jsonb_build_object('id',shooter_id,'naam',full_name));
  return account_id;
end $$;
revoke all on function public.epp_self_register_member(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.epp_self_register_member(uuid,text,text,text,text,text) to service_role;
commit;
