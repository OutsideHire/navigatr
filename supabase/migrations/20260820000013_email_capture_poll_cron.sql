-- 20260820000013_email_capture_poll_cron.sql
--
-- Automatic Email Activity Capture (Phase 1): schedule the Sent Items poll.
-- pg_cron triggers the capture_sent_email Edge function via pg_net every few
-- minutes. The function itself is gated on the EMAIL_CAPTURE_ENABLED edge
-- secret, so scheduling this is SAFE while the feature is dark: until the flag
-- is "1" the function returns early, and it only ever processes reps who have
-- an email_connection row (created when a rep connects Outlook with capture
-- on). Nobody's mail is read until both are true.
--
-- Auth reuses the shared `cron_secret` Vault entry (same one the nightly
-- snapshot schedulers send; see 20260812000004). The function URL is read from
-- the `capture_email_fn_url` Vault entry, which an operator creates per
-- environment at apply time (exactly like coverage_fn_url / persistence_fn_url),
-- so this migration hardcodes no environment URL and staging never posts to
-- production. Until that Vault entry exists the job simply has nothing to call.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any prior job of this name so re-applying (local reset,
-- replay) doesn't error on the duplicate jobname.
select cron.unschedule('email-capture-poll')
where exists (select 1 from cron.job where jobname = 'email-capture-poll');

select cron.schedule(
  'email-capture-poll',
  '*/2 * * * *',  -- every 2 minutes (beta cadence; adjust per ops)
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'capture_email_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);
