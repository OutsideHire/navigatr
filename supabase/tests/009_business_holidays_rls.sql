-- Regression tests for migration 20260730000002_business_holidays_rls.
--
-- Run with a service-role connection, AFTER applying the migration:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/009_business_holidays_rls.sql
--
-- Self-cleans via the wrapping transaction's rollback.
--
-- These fail BEFORE the migration and pass after. The vulnerability:
-- business_holidays was the only table in the schema created without RLS, and
-- with no table-level GRANT/REVOKE anywhere the stock Supabase default grant
-- left it readable AND writable through PostgREST by anon/authenticated:
--
--   DELETE /rest/v1/business_holidays?holiday_date=gte.2024-01-01
--
-- Because the table is global (org_id null = applies to everyone) and
-- business_days_between() reads it for every org, that silently skewed
-- time_to_win_business_days / time_to_lost_business_days and the median
-- "business days to close" figure on the Activity-To-Win report for all tenants.

begin;

-- ───────────────────────────────────────────────────────────────────
-- Case 1: RLS is enabled
-- ───────────────────────────────────────────────────────────────────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.business_holidays'::regclass) then
    raise exception 'case1: RLS is not enabled on business_holidays';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 2: read granted, writes revoked, anon has nothing
-- ───────────────────────────────────────────────────────────────────
-- has_table_privilege rather than inspecting the REVOKE, so any residual grant
-- by another route is caught too.
do $$
begin
  if not has_table_privilege('authenticated', 'business_holidays', 'SELECT') then
    raise exception 'case2: authenticated cannot SELECT business_holidays';
  end if;
  if has_table_privilege('authenticated', 'business_holidays', 'INSERT') then
    raise exception 'case2: authenticated still holds INSERT';
  end if;
  if has_table_privilege('authenticated', 'business_holidays', 'UPDATE') then
    raise exception 'case2: authenticated still holds UPDATE';
  end if;
  if has_table_privilege('authenticated', 'business_holidays', 'DELETE') then
    raise exception 'case2: authenticated still holds DELETE';
  end if;
  if has_table_privilege('anon', 'business_holidays', 'SELECT')
     or has_table_privilege('anon', 'business_holidays', 'INSERT')
     or has_table_privilege('anon', 'business_holidays', 'DELETE') then
    raise exception 'case2: anon still holds privileges on business_holidays';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 3: there are no write policies (the second, independent layer)
-- ───────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'business_holidays'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  if n <> 0 then
    raise exception 'case3: expected 0 write policies on business_holidays, found %', n;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Cases 4-6: the client roles cannot mutate the calendar
-- ───────────────────────────────────────────────────────────────────
-- Each asserts the stored row count, so it passes whichever layer blocks (the
-- revoked privilege raises insufficient_privilege; a missing policy under RLS
-- would instead affect zero rows) and fails loudly if the write lands.
do $$
declare before_count int; after_count int;
begin
  select count(*) into before_count from business_holidays;

  set local role authenticated;

  -- Case 4: the destructive one from the finding.
  begin
    delete from business_holidays where holiday_date >= '2024-01-01';
  exception when insufficient_privilege then
    null;  -- expected
  end;

  -- Case 5: inflating the calendar skews the metric the other way.
  begin
    insert into business_holidays (holiday_date, label) values ('2026-08-03', 'fake');
  exception when insufficient_privilege then
    null;  -- expected
  end;

  -- Case 6: relabelling / moving an existing holiday.
  begin
    update business_holidays set holiday_date = '2026-08-04' where holiday_date = '2026-12-25';
  exception when insufficient_privilege then
    null;  -- expected
  end;

  reset role;

  select count(*) into after_count from business_holidays;
  if after_count <> before_count then
    raise exception 'cases4-6: calendar was mutated, % rows before, % after',
      before_count, after_count;
  end if;
  if not exists (select 1 from business_holidays where holiday_date = '2026-12-25') then
    raise exception 'cases4-6: Christmas 2026 was moved or removed';
  end if;
  if exists (select 1 from business_holidays where label = 'fake') then
    raise exception 'cases4-6: a fake holiday was inserted';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 7: the metric still excludes holidays under RLS
-- ───────────────────────────────────────────────────────────────────
-- This is the regression that matters. business_days_between is SECURITY
-- INVOKER, so running it as `authenticated` reads business_holidays THROUGH the
-- new policy. The policy's `org_id is null` branch must keep the global calendar
-- visible; if it did not, holidays would stop being excluded and the metric
-- would silently inflate. Note this is the harder direction: the real callers
-- (deal_snapshot_on_won / deal_snapshot_on_lost) are SECURITY DEFINER owned by
-- postgres, and a table owner bypasses RLS, so they cannot break.
--
-- Thanksgiving Thu 2026-11-26 is a global holiday, so [Nov 25, Nov 27) is
-- Wed only = 1. Without the holiday exclusion it would be 2.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  select business_days_between('2026-11-25', '2026-11-27') into n;
  reset role;

  if n <> 1 then
    raise exception 'case7: expected 1 business day (Thanksgiving excluded), got %. '
                    'RLS is hiding the global calendar from business_days_between.', n;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 8: authenticated can still read the global calendar directly
-- ───────────────────────────────────────────────────────────────────
-- Keeps the door open for the admin UI the exclusion_seed precedent anticipates.
do $$
declare n int;
begin
  set local role authenticated;
  select count(*) into n from business_holidays where org_id is null;
  reset role;

  if n = 0 then
    raise exception 'case8: authenticated sees 0 global holidays, policy is too tight';
  end if;
end $$;

rollback;
