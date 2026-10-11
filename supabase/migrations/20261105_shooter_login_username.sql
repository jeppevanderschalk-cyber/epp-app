begin;
alter table public.app_accounts add column login_username text;
alter table public.app_accounts add constraint epp_login_username_format check (
  login_username is null or (role='schutter' and username<>'kijker' and login_username ~ '^[a-z0-9._-]{3,30}$'
  and login_username !~ '^(lid\.|removed\.)' and login_username not in ('kijker','beheer','hoofdbeheer','trainer')));
create unique index epp_unique_login_username on public.app_accounts(club_code,login_username)
where deleted_at is null and login_username is not null;
create function public.epp_guard_login_username() returns trigger language plpgsql set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('login-namespace:'||new.club_code,0));
  if new.deleted_at is null and exists (
    select 1 from app_accounts a where a.id<>new.id and a.club_code=new.club_code and a.deleted_at is null
    and (a.username=new.login_username or a.login_username=new.username)
  ) then raise exception 'gebruikersnaam_bestaat';end if;
  return new;
end $$;
revoke all on function public.epp_guard_login_username() from public,anon,authenticated;
create trigger epp_guard_login_username before insert or update of username,login_username,club_code,deleted_at on public.app_accounts
for each row execute function public.epp_guard_login_username();
create function public.epp_register_public_member_username(p_club text,p_username text,p_first text,p_last text,p_email text,p_salt text,p_hash text,p_login_username text)
returns uuid language plpgsql security definer set search_path=public as $$
declare aid uuid;
begin
  aid:=epp_register_public_pending_member(p_club,p_username,p_first,p_last,p_email,p_salt,p_hash);
  update app_accounts set login_username=p_login_username where id=aid;
  return aid;
exception when unique_violation then
  if exists(select 1 from app_accounts where club_code=p_club and login_username=p_login_username and deleted_at is null) then
    raise exception 'gebruikersnaam_bestaat';
  end if;
  raise;
end $$;
revoke all on function public.epp_register_public_member_username(text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.epp_register_public_member_username(text,text,text,text,text,text,text,text) to service_role;
commit;
