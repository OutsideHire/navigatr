-- Activity-to-Win: holiday-aware business days (PRD §3.3.A fast-follow).
-- "Business days to close/loss" previously skipped weekends only, counting US
-- federal holidays as work days and slightly inflating the metric. Add a
-- holiday calendar, teach business_days_between to skip it, and recompute the
-- stored snapshots. DB-only: the metric is snapshot-computed; the app just
-- displays the column, so no frontend change. Idempotent / safe to re-run.
--
-- Scope note: this changes ONLY the Activity-to-Win business_days_between.
-- Follow-up scheduling (add_business_days / followUpScheduling.ts) is a
-- separate concern and intentionally stays weekends-only.

-- ── 1. Holiday calendar (global US federal holidays, observed dates) ──
-- Observed = the weekday actually taken off (e.g. Sat Jul 4 → Fri Jul 3), so
-- excluding it removes the real non-working weekday. org_id is reserved for
-- future per-tenant calendars; null = applies to everyone.
create table if not exists business_holidays (
  holiday_date date primary key,
  label        text not null,
  org_id       uuid references organizations(id) on delete cascade
);

-- US federal holidays 2024-2030 (observed). Extend before 2031.
insert into business_holidays (holiday_date, label) values
  ('2024-01-01', 'New Year''s Day'),
  ('2024-01-15', 'Martin Luther King Jr. Day'),
  ('2024-02-19', 'Washington''s Birthday'),
  ('2024-05-27', 'Memorial Day'),
  ('2024-06-19', 'Juneteenth'),
  ('2024-07-04', 'Independence Day'),
  ('2024-09-02', 'Labor Day'),
  ('2024-10-14', 'Columbus Day'),
  ('2024-11-11', 'Veterans Day'),
  ('2024-11-28', 'Thanksgiving Day'),
  ('2024-12-25', 'Christmas Day'),
  ('2025-01-01', 'New Year''s Day'),
  ('2025-01-20', 'Martin Luther King Jr. Day'),
  ('2025-02-17', 'Washington''s Birthday'),
  ('2025-05-26', 'Memorial Day'),
  ('2025-06-19', 'Juneteenth'),
  ('2025-07-04', 'Independence Day'),
  ('2025-09-01', 'Labor Day'),
  ('2025-10-13', 'Columbus Day'),
  ('2025-11-11', 'Veterans Day'),
  ('2025-11-27', 'Thanksgiving Day'),
  ('2025-12-25', 'Christmas Day'),
  ('2026-01-01', 'New Year''s Day'),
  ('2026-01-19', 'Martin Luther King Jr. Day'),
  ('2026-02-16', 'Washington''s Birthday'),
  ('2026-05-25', 'Memorial Day'),
  ('2026-06-19', 'Juneteenth'),
  ('2026-07-03', 'Independence Day'),
  ('2026-09-07', 'Labor Day'),
  ('2026-10-12', 'Columbus Day'),
  ('2026-11-11', 'Veterans Day'),
  ('2026-11-26', 'Thanksgiving Day'),
  ('2026-12-25', 'Christmas Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-01-18', 'Martin Luther King Jr. Day'),
  ('2027-02-15', 'Washington''s Birthday'),
  ('2027-05-31', 'Memorial Day'),
  ('2027-06-18', 'Juneteenth'),
  ('2027-07-05', 'Independence Day'),
  ('2027-09-06', 'Labor Day'),
  ('2027-10-11', 'Columbus Day'),
  ('2027-11-11', 'Veterans Day'),
  ('2027-11-25', 'Thanksgiving Day'),
  ('2027-12-24', 'Christmas Day'),
  ('2027-12-31', 'New Year''s Day'),
  ('2028-01-17', 'Martin Luther King Jr. Day'),
  ('2028-02-21', 'Washington''s Birthday'),
  ('2028-05-29', 'Memorial Day'),
  ('2028-06-19', 'Juneteenth'),
  ('2028-07-04', 'Independence Day'),
  ('2028-09-04', 'Labor Day'),
  ('2028-10-09', 'Columbus Day'),
  ('2028-11-10', 'Veterans Day'),
  ('2028-11-23', 'Thanksgiving Day'),
  ('2028-12-25', 'Christmas Day'),
  ('2029-01-01', 'New Year''s Day'),
  ('2029-01-15', 'Martin Luther King Jr. Day'),
  ('2029-02-19', 'Washington''s Birthday'),
  ('2029-05-28', 'Memorial Day'),
  ('2029-06-19', 'Juneteenth'),
  ('2029-07-04', 'Independence Day'),
  ('2029-09-03', 'Labor Day'),
  ('2029-10-08', 'Columbus Day'),
  ('2029-11-12', 'Veterans Day'),
  ('2029-11-22', 'Thanksgiving Day'),
  ('2029-12-25', 'Christmas Day'),
  ('2030-01-01', 'New Year''s Day'),
  ('2030-01-21', 'Martin Luther King Jr. Day'),
  ('2030-02-18', 'Washington''s Birthday'),
  ('2030-05-27', 'Memorial Day'),
  ('2030-06-19', 'Juneteenth'),
  ('2030-07-04', 'Independence Day'),
  ('2030-09-02', 'Labor Day'),
  ('2030-10-14', 'Columbus Day'),
  ('2030-11-11', 'Veterans Day'),
  ('2030-11-28', 'Thanksgiving Day'),
  ('2030-12-25', 'Christmas Day')
on conflict (holiday_date) do nothing;

-- ── 2. business_days_between now also skips global holidays ──
-- Half-open [start, end) in days, Mon-Fri, minus any global business_holidays.
create or replace function business_days_between(a timestamptz, b timestamptz)
returns int language sql stable as $$   -- STABLE: reads TimeZone + business_holidays
  select coalesce(count(*)::int, 0)
  from generate_series(a::date, b::date - 1, interval '1 day') g
  where extract(isodow from g) < 6                                   -- Mon..Fri
    and g::date not in (select holiday_date from business_holidays   -- global cal
                        where org_id is null);
$$;

-- ── 3. Recompute stored business-day snapshots (calendar days unaffected) ──
-- Preserve updated_at sort (disable deals_set_updated_at around the backfill).
alter table deals disable trigger deals_set_updated_at;

update deals set
  time_to_win_business_days = business_days_between(first_activity_at, closed_won_at)
where closed_won_at is not null and first_activity_at is not null;

update deals set
  time_to_lost_business_days = business_days_between(first_activity_at, closed_lost_at)
where closed_lost_at is not null and first_activity_at is not null;

alter table deals enable trigger deals_set_updated_at;
