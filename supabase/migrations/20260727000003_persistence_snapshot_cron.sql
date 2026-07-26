-- 20260727000003_persistence_snapshot_cron.sql
-- Nightly Persistence Index snapshot schedule (SP-B). pg_cron triggers the
-- compute_persistence_snapshots Edge function via pg_net once a day. Auth +
-- URL come from Supabase Vault (secrets 'persistence_fn_url' and
-- 'persistence_service_role_key' are created by an operator at apply time),
-- no secret is stored in this migration.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any prior job of this name so re-applying (local reset,
-- replay) doesn't error on the duplicate jobname.
select cron.unschedule('persistence-snapshots-nightly')
where exists (select 1 from cron.job where jobname = 'persistence-snapshots-nightly');

select cron.schedule(
  'persistence-snapshots-nightly',
  '30 7 * * *',  -- 07:30 UTC daily (after low traffic hours, adjust per ops)
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'persistence_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'persistence_service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
