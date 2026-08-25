-- 20260825000002_cron_health.sql
--
-- Scheduled-job health, OUTCOME-based. The email-capture poll failed silently
-- for days (a platform-gateway 401 the whole time) because cron.job_run_details
-- reported "succeeded" for the SQL that enqueues the call, while the downstream
-- HTTP response was never inspected. The lesson: monitor whether each job's
-- OUTPUT is fresh, not whether the scheduler fired.
--
-- This RPC reports, for the CALLER'S ORG (admin-only, operational), the
-- freshness of the outputs of the frequent scheduled jobs a beta relies on:
--   - persistence_company_snapshot (nightly Persistence Index)
--   - coverage_snapshot            (nightly coverage rollup)
--   - email_connection             (the 2-minute Sent-mail poll; last_poll_at
--                                   advances every run, so a stale value means
--                                   the poll is not running)
-- The client turns these raw facts into per-job ok / stale / idle labels
-- (features/admin/lib/cronHealth.ts). SECURITY DEFINER so it can read across the
-- org's rows, but it returns {} to non-admins (caller_is_admin) and only ever
-- reads the caller's own org (user_org_id). Reads app tables only -- no
-- cron.*/net.* internals -- so it needs no special grants and can't break.

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
      )
    )
  end
$$;

grant execute on function public.cron_health() to authenticated;
