-- Switch place-id-refresh-monthly from sending the service-role key to the
-- dedicated cron_secret, matching 20260812000004 for the two snapshot jobs.
--
-- WHY: refresh_place_ids had no caller check at all. It verified the HTTP method
-- and that Places was configured, then built a service-role client and updated
-- place_id / place_synced_at across every org. Platform verify_jwt is not an
-- authorization boundary (the public anon key in the browser bundle satisfies
-- it), so any holder of that key could trigger an all-tenant refresh and burn
-- Google Places quota. Same defect the 2026-07-30 security review found on the
-- two snapshot functions; this one was written on 2026-08-08, after that review.
--
-- The guard is added in the function itself; this migration makes the scheduler
-- send the credential the guard now expects. Comparing against a
-- platform-managed key (as the first version of the snapshot guard did) breaks
-- silently on any rotation or key-format migration, and a full-access,
-- RLS-bypassing credential should not be used to answer "is this the scheduler?".

-- BOOTSTRAP: on an environment with no cron_secret yet (fresh local reset, CI, a
-- new staging project) generate one so the migration set stays reproducible from
-- zero. Production already has its real value and is untouched, since this only
-- runs when the secret is absent. An auto-generated secret is fail-closed, not a
-- backdoor: nobody knows it, and the scheduler cannot authenticate until an
-- operator sets the matching CRON_SECRET Edge Function secret.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Shared secret the cron schedulers send. Auto-generated on first apply; an operator must set the matching CRON_SECRET Edge Function secret before the jobs can authenticate.'
    );
    raise notice 'cron_secret did not exist and was generated. Set the matching CRON_SECRET Edge Function secret.';
  end if;
end;
$$;

select cron.unschedule('place-id-refresh-monthly')
where exists (select 1 from cron.job where jobname = 'place-id-refresh-monthly');

select cron.schedule(
  'place-id-refresh-monthly',
  '0 8 1 * *',  -- 08:00 UTC on the 1st, unchanged
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'place_refresh_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- `place_refresh_service_role_key` is deliberately left in place rather than
-- dropped: nothing reads it after this migration, but removing a credential in
-- the same change that repoints the scheduler would leave no way back if the new
-- secret is misconfigured. Delete it once a run has succeeded on the new
-- credential.
