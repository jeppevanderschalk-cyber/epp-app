-- Landelijk EPP-scoreplatform v1
-- Eerste release: EPP pistool, 50 schoten, totaalscore 0..250.

create extension if not exists pgcrypto;

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  naam text not null,
  actief boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_users (
  id uuid primary key default gen_random_uuid(),
  auth_provider_id text unique,
  actief boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.club_roles (
  user_id uuid references public.platform_users(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete cascade,
  role text not null check (role in ('landelijk_beheer','verenigingsbeheerder','wedstrijdleider','scorer','schutter')),
  created_at timestamptz not null default now(),
  primary key (user_id, club_id, role)
);

create table if not exists public.shooters (
  id uuid primary key default gen_random_uuid(),
  public_id text unique not null default ('EPP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  display_name text not null,
  linked_user_id uuid references public.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  shooter_id uuid not null references public.shooters(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete restrict,
  valid_from date not null default current_date,
  valid_until date,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from),
  unique (shooter_id, club_id, valid_from)
);

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  naam text unique not null,
  start_date date not null,
  end_date date not null,
  ranking_version text not null default 'BEST_SCORE_V1',
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.divisions (
  id uuid primary key default gen_random_uuid(),
  naam text unique not null,
  actief boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.rule_profiles (
  id uuid primary key default gen_random_uuid(),
  version text unique not null,
  shot_count integer not null default 50 check (shot_count = 50),
  max_score integer not null default 250 check (max_score = 250),
  zone_values jsonb not null default '[5,4,3,2,0]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_club_id uuid not null references public.clubs(id) on delete restrict,
  season_id uuid not null references public.seasons(id) on delete restrict,
  naam text not null,
  type text not null check (type in ('wedstrijd','training')),
  local_date date not null default current_date,
  rule_profile_id uuid not null references public.rule_profiles(id) on delete restrict,
  ranking_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organizer_club_id, naam)
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  label text not null default 'Ronde 1',
  created_at timestamptz not null default now(),
  unique (event_id, label)
);

create table if not exists public.event_permissions (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.platform_users(id) on delete cascade,
  role text not null check (role in ('wedstrijdleider','scorer','viewer')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id, role)
);

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete restrict,
  shooter_id uuid not null references public.shooters(id) on delete restrict,
  division_id uuid not null references public.divisions(id) on delete restrict,
  represented_club_id uuid not null references public.clubs(id) on delete restrict,
  entry_mode text not null check (entry_mode in ('counted','total')),
  hits5 integer,
  hits4 integer,
  hits3 integer,
  hits2 integer,
  misses integer,
  gross_score integer,
  penalty_points integer,
  final_score integer,
  status text not null default 'draft' check (status in ('draft','confirmed','dq','withdrawn')),
  revision integer not null default 1,
  idempotency_key text,
  created_by uuid references public.platform_users(id),
  confirmed_by uuid references public.platform_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (round_id, shooter_id, division_id),
  unique (idempotency_key),
  check (final_score is null or (final_score between 0 and 250)),
  check (
    (entry_mode = 'total' and hits5 is null and hits4 is null and hits3 is null and hits2 is null and misses is null and gross_score is null and penalty_points is null)
    or
    (entry_mode = 'counted')
  )
);

create table if not exists public.result_audit (
  id uuid primary key default gen_random_uuid(),
  result_id uuid references public.results(id) on delete set null,
  actor_id uuid references public.platform_users(id),
  action text not null,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create or replace function public.platform_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists shooters_updated_at on public.shooters;
create trigger shooters_updated_at before update on public.shooters
for each row execute function public.platform_set_updated_at();

drop trigger if exists results_updated_at on public.results;
create trigger results_updated_at before update on public.results
for each row execute function public.platform_set_updated_at();

alter table public.clubs enable row level security;
alter table public.platform_users enable row level security;
alter table public.club_roles enable row level security;
alter table public.shooters enable row level security;
alter table public.memberships enable row level security;
alter table public.seasons enable row level security;
alter table public.divisions enable row level security;
alter table public.rule_profiles enable row level security;
alter table public.events enable row level security;
alter table public.rounds enable row level security;
alter table public.event_permissions enable row level security;
alter table public.results enable row level security;
alter table public.result_audit enable row level security;

-- Directe tabeltoegang blijft dicht; de app gebruikt Edge Functions met servervalidatie.
