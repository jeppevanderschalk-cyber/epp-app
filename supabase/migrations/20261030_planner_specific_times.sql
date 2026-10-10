begin;
alter table public.epp_signup_disciplines
  drop constraint epp_signup_disciplines_specific_time_check;
alter table public.epp_signup_disciplines
  add constraint epp_signup_disciplines_specific_time_check check (
    specific_time is null
    or (slot_id is not null and specific_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    or (slot_id is null and specific_time ~ '^(0[9]|1[0-6]):(00|30)$')
  );
commit;
