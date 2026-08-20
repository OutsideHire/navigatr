-- 20260820000002_path_prefs_start_of_day.sql
--
-- Per-rep start-of-day (Workday Window Fix v1.4 Ticket 3a), the sibling of
-- end_of_day_minutes. Minutes from LOCAL midnight (e.g. 8*60 = 480 = 8:00 AM);
-- null = fall back to the global DEFAULT_START_OF_DAY_MINUTES constant in code.
-- Resolved in the rep's stored timezone, same as end_of_day_minutes. Slots into
-- the existing owner-scoped path_preferences table; RLS is inherited unchanged.

alter table path_preferences
  add column if not exists start_of_day_minutes integer;
