begin;
-- Existing matches continue to use the planner. Email registrations are handled externally.
alter table public.epp_matches add column if not exists registration_mode text not null default 'planner';
alter table public.epp_matches add constraint epp_matches_registration_mode_check check (registration_mode in ('planner','email'));
alter table public.epp_matches add constraint epp_matches_email_registration_check check (registration_mode <> 'email' or (organizer_email is not null and organizer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));

commit;
