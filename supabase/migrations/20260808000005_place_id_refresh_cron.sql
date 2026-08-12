-- 20260808000005_place_id_refresh_cron.sql
-- Monthly Google Place ID refresh (Add-Deal-via-Places, slice F). pg_cron
-- triggers the refresh_place_ids Edge function via pg_net once a month. That
-- function re-fetches each deal's place_id with a FREE id-only Place Details
-- call so our stored place_id stays compliant with Google's 12-month caching
-- window. Auth + URL come from Supabase Vault (secrets 'place_refresh_fn_url'
-- and 'place_refresh_service_role_key', created by an operator at apply time);
-- no secret is stored in this migration.
--
-- Monthly is plenty: the refresh window is 12 months, so a monthly sweep keeps
-- every place_id well inside it. Safe to schedule before live Places is on —
-- under PLACES_MOCK the function is a no-op refresh (returns the same id).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any prior job of this name so re-applying doesn't error.
select cron.unschedule('place-id-refresh-monthly')
where exists (select 1 from cron.job where jobname = 'place-id-refresh-monthly');

select cron.schedule(
  'place-id-refresh-monthly',
  '0 8 1 * *',  -- 08:00 UTC on the 1st of each month
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'place_refresh_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'place_refresh_service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
