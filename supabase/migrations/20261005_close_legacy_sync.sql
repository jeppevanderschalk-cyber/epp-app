-- Apply last, after the new frontend and authenticated endpoints are verified.
begin;
select public.epp_capture_backup();
revoke all on public.epp_sync from anon,authenticated;
grant all on public.epp_sync to service_role;
drop policy if exists "EPP sync lezen" on public.epp_sync;
drop policy if exists "EPP sync schrijven" on public.epp_sync;
drop policy if exists "EPP sync bijwerken" on public.epp_sync;
commit;
