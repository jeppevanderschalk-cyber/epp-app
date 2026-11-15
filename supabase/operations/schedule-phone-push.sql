-- Requires EPP_PUSH_WORKER_SECRET to match the Vault secret named below.
-- This worker handles browser push only; no email service is involved.
create extension if not exists pg_net with schema extensions;
select cron.schedule('epp-phone-push','* * * * *',$job$
 select net.http_post(
  url := 'https://nnsozxjkltcnexqpnwia.supabase.co/functions/v1/epp-push',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='epp_push_worker_secret')),
  body := '{"action":"worker"}'::jsonb,
  timeout_milliseconds := 100000
 );
$job$);
