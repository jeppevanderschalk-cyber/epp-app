begin;
create table public.epp_training_journal (
 id uuid primary key default gen_random_uuid(),
 club_code text not null references public.clubs(code),
 shooter_id uuid not null references public.shooters(id),
 training_id text not null check(length(training_id) between 1 and 150),
 author_id uuid not null references public.app_accounts(id),
 author_name text not null,
 visibility text not null check(visibility in ('private','trainer')),
 content text not null check(length(content) between 1 and 4000),
 created_at timestamptz not null default now()
);
create index epp_training_journal_lookup on public.epp_training_journal(club_code,shooter_id,training_id,created_at);
alter table public.epp_training_journal enable row level security;
revoke all on public.epp_training_journal from public,anon,authenticated;
grant all on public.epp_training_journal to service_role;
commit;
