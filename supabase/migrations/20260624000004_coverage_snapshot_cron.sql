-- Nightly Activity Logging Coverage snapshot schedule (SP1). pg_cron triggers
-- the compute_coverage_snapshots Edge function via pg_net once a day. Auth +
-- URL come from Supabase Vault (secrets 'coverage_fn_url' and
-- 'coverage_service_role_key' are created by an operator at apply time) — no
-- secret is stored in this migration.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any prior job of this name so re-applying (local reset,
-- replay) doesn't error on the duplicate jobname.
select cron.unschedule('coverage-snapshots-nightly')
where exists (select 1 from cron.job where jobname = 'coverage-snapshots-nightly');

select cron.schedule(
  'coverage-snapshots-nightly',
  '15 7 * * *',  -- 07:15 UTC daily (after low-traffic hours; adjust per ops)
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'coverage_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'coverage_service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
