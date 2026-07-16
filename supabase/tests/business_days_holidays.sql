-- Spot-check for the Activity-to-Win holiday calendar
-- (migration 20260716000003). business_days_between is half-open [a, b) in
-- days, Mon-Fri, minus global US federal holidays. Run after the migration:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/business_days_holidays.sql

begin;

do $$
begin
  -- Thanksgiving Thu 2026-11-26 excluded → Wed only.
  if business_days_between('2026-11-25', '2026-11-27') <> 1 then
    raise exception 'Thanksgiving: expected 1, got %', business_days_between('2026-11-25', '2026-11-27');
  end if;

  -- Christmas Fri 2026-12-25 excluded → Thu only.
  if business_days_between('2026-12-24', '2026-12-26') <> 1 then
    raise exception 'Christmas: expected 1, got %', business_days_between('2026-12-24', '2026-12-26');
  end if;

  -- Independence Day observed Fri 2026-07-03 excluded → Thu only.
  if business_days_between('2026-07-02', '2026-07-04') <> 1 then
    raise exception 'Independence Day observed: expected 1, got %', business_days_between('2026-07-02', '2026-07-04');
  end if;

  -- MLK Mon 2026-01-19 excluded → Tue-Fri = 4.
  if business_days_between('2026-01-19', '2026-01-24') <> 4 then
    raise exception 'MLK week: expected 4, got %', business_days_between('2026-01-19', '2026-01-24');
  end if;

  -- Control: a holiday-free Mon-Fri week counts all 5.
  if business_days_between('2026-06-01', '2026-06-06') <> 5 then
    raise exception 'control week: expected 5, got %', business_days_between('2026-06-01', '2026-06-06');
  end if;
end $$;

\echo 'ACTIVITY-TO-WIN HOLIDAY CALENDAR TESTS PASSED'

rollback;
