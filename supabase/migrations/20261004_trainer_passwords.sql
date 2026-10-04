-- Central trainer credentials. Only server functions may read or change these.
create table if not exists public.trainer_credentials (
  club_code text primary key,
  password_hash text not null,
  password_salt text not null,
  iterations integer not null check (iterations >= 600000),
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  password_changed_at timestamptz not null default now()
);
alter table public.trainer_credentials enable row level security;
revoke all on public.trainer_credentials from public, anon, authenticated;
grant select, insert, update on public.trainer_credentials to service_role;

insert into public.trainer_credentials (club_code, password_hash, password_salt, iterations)
values ('mercurius75', '873474d18dcfbbf3d350bb083829000f5cc39c1f554a4fb5212e1dfc371ea9f5', 'b42291dff8f9692b8a732628e3499f4d47bbe10d0f7dea90', 600000)
on conflict (club_code) do nothing;

create or replace function public.epp_record_failed_trainer_login(p_club text)
returns void language sql set search_path = public as $$
  update public.trainer_credentials
  set failed_attempts = case when locked_until <= now() then 1 else failed_attempts + 1 end,
      locked_until = case
        when locked_until <= now() then null
        when failed_attempts + 1 >= 5 then now() + interval '15 minutes'
        else locked_until end
  where club_code = p_club;
$$;
revoke all on function public.epp_record_failed_trainer_login(text) from public, anon, authenticated;
grant execute on function public.epp_record_failed_trainer_login(text) to service_role;
