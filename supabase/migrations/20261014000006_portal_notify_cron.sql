-- 20261014000006_portal_notify_cron.sql
--
-- Partner Portal Phase 1C: run portal_notify every 2 minutes. Same wiring as
-- 20260820000013 (email capture poll) and 20260825000006 (notify_no_deals):
-- pg_cron triggers the Edge function via pg_net; auth is the shared
-- CRON_SECRET (Vault `cron_secret`, bootstrapped by 20260812000004); the URL
-- comes from a per-environment Vault secret `portal_notify_fn_url` that an
-- operator creates at apply time, so staging never posts to production and no
-- URL or secret is stored here. Until that secret exists the job posts to a
-- null URL and nothing is sent (dark until set up).
--
-- Also: cron_health (20260825000002) reports outcome freshness per job for the
-- admin card. It gains portal_email for the caller's org: emails still waiting,
-- the oldest of them, and sends and failures over the last 7 days.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('portal-notify')
where exists (select 1 from cron.job where jobname = 'portal-notify');

select cron.schedule(
  'portal-notify',
  '*/2 * * * *',  -- every 2 minutes: partner emails go out promptly, nudges land within 2 minutes of end of day
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'portal_notify_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);

create or replace function public.cron_health()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when not public.caller_is_admin() then '{}'::jsonb
    else jsonb_build_object(
      'persistence', (
        select jsonb_build_object('latest_date', max(snapshot_date), 'rows', count(*))
        from persistence_company_snapshot where org_id = public.user_org_id()
      ),
      'coverage', (
        select jsonb_build_object('latest_date', max(snapshot_date), 'rows', count(*))
        from coverage_snapshot where org_id = public.user_org_id()
      ),
      'email_capture', (
        select jsonb_build_object(
          'connections', count(*),
          'freshest_poll_at', max(last_poll_at),
          'unhealthy', count(*) filter (where health <> 'ok')
        )
        from email_connection where org_id = public.user_org_id()
      ),
      'portal_email', (
        select jsonb_build_object(
          'pending', count(*) filter (where sent_at is null and dropped_at is null and failed_at is null),
          'oldest_pending_at', min(created_at) filter (where sent_at is null and dropped_at is null and failed_at is null),
          'failed_7d', count(*) filter (where failed_at > now() - interval '7 days'),
          'sent_7d', count(*) filter (where sent_at > now() - interval '7 days')
        )
        from portal_email_outbox where org_id = public.user_org_id()
      )
    )
  end
$$;

grant execute on function public.cron_health() to authenticated;
