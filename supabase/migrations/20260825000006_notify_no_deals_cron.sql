-- Daily schedule for the no-deals activation heads-up (notify_no_deals).
-- pg_cron triggers the Edge function via pg_net once a day. Auth is the shared
-- CRON_SECRET (Vault `cron_secret`, bootstrapped by 20260812000004); the URL
-- comes from a per-environment Vault secret `notify_no_deals_fn_url` that an
-- operator creates at apply time, so staging never posts to prod and no secret
-- is stored in this migration.
--
-- The URL secret is intentionally NOT created here: it differs per environment
-- (prod https://api.getnavigatr.io/functions/v1/notify_no_deals; staging the
-- project ref host). cron.schedule only registers the job; the URL is resolved
-- when the job fires, so a `supabase db reset` from zero applies cleanly even
-- before the secret exists. Until an operator creates it, the job posts to a
-- null URL (no-op) and nothing is sent, which is the desired dark-until-setup
-- rollout.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('notify-no-deals-daily')
where exists (select 1 from cron.job where jobname = 'notify-no-deals-daily');

select cron.schedule(
  'notify-no-deals-daily',
  '0 16 * * *',  -- 16:00 UTC daily (US morning: 9am PT / 12pm ET)
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_no_deals_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);
