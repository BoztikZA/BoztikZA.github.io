-- ============================================================================
-- BOZTIK DELIVER — cleanup-expired-deliveries scheduler
--
-- Runs the cleanup Edge Function every 30 minutes so an expired delivery's
-- Storage files are reclaimed soon after expiry (rather than once a day).
--
-- Requires (apply from the Dashboard "Integrations -> Cron -> SQL" or the SQL
-- Editor, as a privileged operator):
--   1. pg_cron  enabled  (Supabase Cron Postgres Module).
--   2. pg_net   enabled  (needed for net.http_post). e.g.:
--        create extension if not exists pg_net;
--   3. Two Supabase Vault secrets (so NO key is hardcoded in this file):
--        select vault.create_secret('<anon key>',   'SUPABASE_ANON_KEY');
--        select vault.create_secret('<CLEANUP_SECRET>', 'CLEANUP_SECRET');
--      * SUPABASE_ANON_KEY is the same public anon key already shipped in
--        deliver/js/config.js (it is public, but Vault keeps this file clean).
--      * CLEANUP_SECRET MUST match the value set on the function with
--        `supabase secrets set CLEANUP_SECRET=...`.
--
-- Idempotent: cron.schedule with the same job name overwrites the previous
-- definition, so re-running is safe. Monitor runs via:
--   select * from cron.job_run_details order by start_time desc;
-- ============================================================================

select cron.schedule(
  'cleanup-expired-deliveries',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://hwcxxotgtqchcriascti.supabase.co/functions/v1/cleanup-expired-deliveries',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY'),
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY'), ''),
      'x-cleanup-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'CLEANUP_SECRET'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  ) as request_id;
  $$
);