-- Enable only after the application migration has passed the production checks.
begin;
create extension if not exists pg_cron;
select cron.schedule('epp-daily-snapshot','17 2 * * *','select public.epp_capture_backup();');
commit;
