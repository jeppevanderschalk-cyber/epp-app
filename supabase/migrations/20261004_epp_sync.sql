-- Preserve the existing training storage contract during the database migration.
create table if not exists public.epp_sync (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function public.epp_sync_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists epp_sync_updated_at on public.epp_sync;
create trigger epp_sync_updated_at before update on public.epp_sync
for each row execute function public.epp_sync_set_updated_at();

alter table public.epp_sync enable row level security;
grant select, insert, update on public.epp_sync to anon;
grant all on public.epp_sync to service_role;
drop policy if exists "EPP sync lezen" on public.epp_sync;
create policy "EPP sync lezen" on public.epp_sync for select to anon using (id = 'epp-app' or id like 'epp-app-%');
drop policy if exists "EPP sync schrijven" on public.epp_sync;
create policy "EPP sync schrijven" on public.epp_sync for insert to anon with check (id = 'epp-app' or id like 'epp-app-%');
drop policy if exists "EPP sync bijwerken" on public.epp_sync;
create policy "EPP sync bijwerken" on public.epp_sync for update to anon
using (id = 'epp-app' or id like 'epp-app-%') with check (id = 'epp-app' or id like 'epp-app-%');
