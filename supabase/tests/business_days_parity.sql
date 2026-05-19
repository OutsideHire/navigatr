-- Parity test for add_business_days + disposition_business_days.
--
-- These functions ship in migration 003_activities_followup.sql (Day 2 of
-- the build plan). This script is written ahead of time so it can be run
-- the moment 003 lands.
--
-- The expected outputs below are computed against apps/app/src/lib/
-- followUpScheduling.ts (the source of truth). Specifically:
--   * 10 dispositions, with businessDays = {1,3,7,3,null,30,15,null,null,null}
--   * addBusinessDays from date-fns: skips Sat/Sun, no holiday calendar.
--
-- Anchored at Wednesday 2026-05-20 to exercise the weekend-skip:
--   Wed 2026-05-20 + 1bd  = Thu 2026-05-21
--   Wed 2026-05-20 + 3bd  = Mon 2026-05-25 (skip Sat 23 + Sun 24)
--   Wed 2026-05-20 + 7bd  = Fri 2026-05-29
--   Wed 2026-05-20 + 15bd = Wed 2026-06-10
--   Wed 2026-05-20 + 30bd = Wed 2026-07-01
--
-- Run with:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/business_days_parity.sql

begin;

do $$
declare anchor date := date '2026-05-20'; -- Wednesday
begin
  if add_business_days(anchor, 1)  <> date '2026-05-21' then raise exception 'add_business_days(1)  parity failed: %', add_business_days(anchor, 1);  end if;
  if add_business_days(anchor, 3)  <> date '2026-05-25' then raise exception 'add_business_days(3)  parity failed: %', add_business_days(anchor, 3);  end if;
  if add_business_days(anchor, 7)  <> date '2026-05-29' then raise exception 'add_business_days(7)  parity failed: %', add_business_days(anchor, 7);  end if;
  if add_business_days(anchor, 15) <> date '2026-06-10' then raise exception 'add_business_days(15) parity failed: %', add_business_days(anchor, 15); end if;
  if add_business_days(anchor, 30) <> date '2026-07-01' then raise exception 'add_business_days(30) parity failed: %', add_business_days(anchor, 30); end if;

  -- Edge: 0 returns the anchor itself, weekend or not.
  if add_business_days(date '2026-05-23', 0) <> date '2026-05-23' then raise exception 'add_business_days(0) parity failed'; end if;

  -- Edge: starting on Friday + 1 lands on Monday.
  if add_business_days(date '2026-05-22', 1) <> date '2026-05-25' then raise exception 'Fri+1 parity failed: %', add_business_days(date '2026-05-22', 1); end if;
end $$;

-- Disposition offsets must mirror followUpScheduling.ts exactly.
do $$
begin
  if disposition_business_days('statement_secured')   <> 1    then raise exception 'statement_secured';   end if;
  if disposition_business_days('positive_engagement') <> 3    then raise exception 'positive_engagement'; end if;
  if disposition_business_days('connected_with_dm')   <> 7    then raise exception 'connected_with_dm';   end if;
  if disposition_business_days('dm_unavailable')      <> 3    then raise exception 'dm_unavailable';      end if;
  if disposition_business_days('followup_requested')  is not null then raise exception 'followup_requested should be null'; end if;
  if disposition_business_days('future_potential')    <> 30   then raise exception 'future_potential';    end if;
  if disposition_business_days('low_probability')     <> 15   then raise exception 'low_probability';     end if;
  if disposition_business_days('not_interested')      is not null then raise exception 'not_interested should be null'; end if;
  if disposition_business_days('wrong_number')        is not null then raise exception 'wrong_number should be null';   end if;
  if disposition_business_days('closed_lost')         is not null then raise exception 'closed_lost should be null';    end if;
end $$;

\echo 'BUSINESS-DAYS PARITY TESTS PASSED'

rollback;
