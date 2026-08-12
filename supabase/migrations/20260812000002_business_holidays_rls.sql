-- Security fix: business_holidays was created (20260716000003) without RLS.
--
-- It is the only one of the 32 tables in this migration set that never gets
-- `enable row level security`. Since the repo contains no table-level GRANT or
-- REVOKE and no `alter default privileges`, every table relies on Supabase's
-- stock default grant to anon/authenticated with RLS as the only gate. With RLS
-- off, business_holidays is therefore readable AND writable through PostgREST
-- by any caller holding the public anon key that ships in the browser bundle:
--
--   DELETE /rest/v1/business_holidays?holiday_date=gte.2024-01-01
--
-- The table is global, not tenant-scoped (org_id is reserved for future
-- per-tenant calendars; every seeded row has org_id = null), and
-- business_days_between() reads the org_id-is-null rows for every org. So an
-- unauthorized write silently skews time_to_win_business_days /
-- time_to_lost_business_days, and the median "business days to close" figure on
-- the Activity-To-Win report, for EVERY tenant. Those columns are snapshotted
-- once by the on-close triggers rather than recomputed on read, so tampering
-- corrupts deals closed after the tamper rather than rewriting history, but the
-- damage is permanent per row and invisible.
--
-- Read access leaks nothing (a US federal holiday list is not confidential);
-- this is an integrity and access-control fix, not a confidentiality one.
--
-- Fix: RLS on, authenticated may read the calendar that applies to them, and
-- there are NO write policies. Calendar maintenance stays service-role /
-- migration only. This mirrors the exclusion_seed posture set in
-- 20260531000001 ("authenticated read so an admin UI can show the list later;
-- writes are service-role / admin-RPC only").
--
-- Safe for the metric: business_days_between is SECURITY INVOKER, but its only
-- callers are the deal_snapshot_on_won / deal_snapshot_on_lost triggers, which
-- are SECURITY DEFINER owned by postgres. A table owner bypasses RLS, so the
-- snapshot path is unaffected. Verified against supabase/tests/
-- business_days_holidays.sql and business_days_parity.sql, which call the
-- function over a service-role connection.
--
-- Idempotent / safe to re-run.

alter table business_holidays enable row level security;

-- Belt and braces, same two-layer approach as the profiles lockdown: strip the
-- default write privileges outright, then re-grant read only. RLS alone would
-- be sufficient, but this keeps the table denied even if a future migration
-- disables RLS.
revoke all on business_holidays from anon;
revoke all on business_holidays from authenticated;
grant select on business_holidays to authenticated;

drop policy if exists business_holidays_select on business_holidays;

-- Global rows (org_id is null) apply to everyone; a future per-tenant calendar
-- row is visible only to its own org.
create policy business_holidays_select on business_holidays for select
  to authenticated
  using (org_id is null or org_id = public.user_org_id());

comment on table business_holidays is
  'Global US federal holiday calendar consumed by business_days_between. '
  'Read-only to authenticated; writes are service-role / migration only (no '
  'write policies, privileges revoked). See 20260730000002_business_holidays_rls.sql.';
