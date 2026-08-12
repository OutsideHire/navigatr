-- Switch both nightly snapshot schedulers from sending the service-role key to
-- sending a dedicated CRON_SECRET.
--
-- WHY: 20260730000003 (in fc8aa87) added a guard to compute_coverage_snapshots
-- and compute_persistence_snapshots that compared the bearer against
-- SUPABASE_SERVICE_ROLE_KEY. Deployed 2026-08-12 07:21 UTC, it began rejecting
-- the schedulers' own requests with 401. The Vault copy is a valid original
-- service_role JWT for this project, but it is not byte-identical to what
-- Supabase now injects into that variable (new-format `sb_secret_*` keys
-- coexist with the legacy JWTs).
--
-- Comparing against a platform-managed value means any key rotation or format
-- migration silently stops the nightly jobs, and "silently" is the problem: a
-- skipped snapshot surfaces as a dashboard that quietly stops updating, not as
-- an error. It also meant the cron job definitions carried a full-access,
-- RLS-bypassing credential purely to answer "is this the scheduler?".
--
-- PREREQUISITE, must exist before this migration is applied:
--   1. Vault secret `cron_secret` created with a value you generate.
--   2. The identical value set as the CRON_SECRET Edge Function secret.
-- If either is missing the jobs will 401 (or the functions will return 503,
-- "cron credential not configured", which is the fail-closed branch and is
-- distinguishable in the logs from a genuinely unauthorized caller).

-- Fail fast rather than silently rescheduling jobs that cannot authenticate.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    raise exception
      'vault secret `cron_secret` does not exist. Create it before applying this migration; see the header.';
  end if;
end;
$$;

select cron.unschedule('coverage-snapshots-nightly')
where exists (select 1 from cron.job where jobname = 'coverage-snapshots-nightly');

select cron.schedule(
  'coverage-snapshots-nightly',
  '15 7 * * *',  -- 07:15 UTC daily, unchanged
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'coverage_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

select cron.unschedule('persistence-snapshots-nightly')
where exists (select 1 from cron.job where jobname = 'persistence-snapshots-nightly');

select cron.schedule(
  'persistence-snapshots-nightly',
  '30 7 * * *',  -- 07:30 UTC daily, unchanged
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'persistence_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- `coverage_service_role_key` and `persistence_service_role_key` are deliberately
-- left in place rather than dropped here: nothing reads them after this
-- migration, but removing a credential in the same change that repoints the
-- schedulers would leave no way back if the new secret is misconfigured. Delete
-- them once a nightly run has succeeded on the new credential.
