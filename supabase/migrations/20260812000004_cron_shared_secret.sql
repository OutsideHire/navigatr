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
-- BOOTSTRAP: on any environment that has no `cron_secret` yet (a fresh local
-- reset, CI, a new staging project) this generates a random one so the migration
-- set stays reproducible from zero. Production already has its real value and is
-- left untouched, since the branch only runs when the secret is absent.
--
-- An auto-generated secret is fail-closed, not a backdoor: nobody knows it, and
-- the schedulers cannot authenticate until an operator sets the matching
-- CRON_SECRET Edge Function secret to the same value. Until then the functions
-- return 503 "cron credential not configured", which is distinguishable in the
-- logs from a genuinely unauthorized caller.
--
-- An earlier version raised an exception instead. That was correct for
-- production safety and wrong for reproducibility: it made `supabase db reset`
-- fail on every machine that had never been bootstrapped, which defeats the
-- point of the migration set describing the database. Caught by running the
-- build from zero for the first time, 2026-08-12.
--
-- Per-environment bootstrap (set the function secret to match) is documented in
-- docs/superpowers/specs/2026-08-06-environments-design.md section 8.2.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Shared secret the nightly snapshot schedulers send. Auto-generated on first apply; an operator must set the matching CRON_SECRET Edge Function secret before the jobs can authenticate.'
    );
    raise notice 'cron_secret did not exist and was generated. Set the matching CRON_SECRET Edge Function secret.';
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
