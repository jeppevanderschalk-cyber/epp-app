begin;
-- Preserve historical account IDs, but do not reserve a deleted account's login name.
create function public.epp_archive_removed_login() returns trigger language plpgsql set search_path=public as $$
begin
  if new.deleted_at is not null then
    new.username:='removed.'||replace(new.id::text,'-','');
  end if;
  return new;
end $$;
revoke all on function public.epp_archive_removed_login() from public,anon,authenticated;
create trigger epp_archive_removed_login before update of deleted_at,username on public.app_accounts
for each row execute function public.epp_archive_removed_login();
update public.app_accounts set username='removed.'||replace(id::text,'-','')
where deleted_at is not null and not active and username not in ('kijker','hoofdbeheer');
commit;
