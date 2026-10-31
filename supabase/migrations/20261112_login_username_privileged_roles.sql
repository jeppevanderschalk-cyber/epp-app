begin;
alter table public.app_accounts drop constraint epp_login_username_format;
alter table public.app_accounts add constraint epp_login_username_format check (
  login_username is null or (role in ('schutter','trainer') and username<>'kijker' and login_username ~ '^[a-z0-9._-]{3,30}$'
  and login_username !~ '^(lid\.|removed\.)' and login_username not in ('kijker','beheer','hoofdbeheer','trainer')));
commit;
