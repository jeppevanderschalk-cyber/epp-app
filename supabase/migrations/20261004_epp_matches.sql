-- Match registration storage used by epp-admin and epp-signup.
create table if not exists public.epp_matches (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  organizer text not null,
  location text,
  match_date date,
  deadline date,
  organizer_email text,
  offered_disciplines text[] not null default array['pistool','optiek','pcc'],
  notes text,
  mail_status text not null default 'niet_verstuurd',
  mail_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.epp_signups (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.epp_matches(id) on delete cascade,
  shooter_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, shooter_name)
);
create table if not exists public.epp_signup_disciplines (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references public.epp_signups(id) on delete cascade,
  discipline text not null check (discipline in ('pistool','optiek','pcc')),
  time_block text not null check (time_block in ('ochtend','middag','geen_voorkeur')),
  specific_time text,
  unique (signup_id, discipline)
);
alter table public.epp_matches enable row level security;
alter table public.epp_signups enable row level security;
alter table public.epp_signup_disciplines enable row level security;
revoke all on public.epp_matches, public.epp_signups, public.epp_signup_disciplines from anon, authenticated;
grant all on public.epp_matches, public.epp_signups, public.epp_signup_disciplines to service_role;
