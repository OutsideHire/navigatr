-- 20261030000002_purge_portal_audit_log.sql
--
-- Partner Portal audit fixes (NFR-PORT-06, Q18). The portal activity log is
-- kept for 2 years. A daily job deletes older rows. Pure SQL, called by pg_cron
-- directly.

create or replace function public.purge_portal_audit_log(p_now timestamptz)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_n   integer;
begin
  -- One run at a time.
  perform pg_advisory_xact_lock(hashtextextended('purge_portal_audit_log', 0));

  delete from portal_audit_log
   where created_at < v_now - interval '2 years';
  get diagnostics v_n = row_count;

  return v_n;
end $$;

revoke execute on function public.purge_portal_audit_log(timestamptz) from public, anon, authenticated;
grant  execute on function public.purge_portal_audit_log(timestamptz) to service_role;

-- Daily at 06:25 UTC, five minutes after purge-form-submissions. Idempotent.
create extension if not exists pg_cron;

select cron.unschedule('purge-portal-audit-log')
where exists (select 1 from cron.job where jobname = 'purge-portal-audit-log');

select cron.schedule(
  'purge-portal-audit-log',
  '25 6 * * *',
  $$ select public.purge_portal_audit_log(now()) $$
);
