-- 20260811000001_path_prefs_end_of_day.sql
--
-- Per-rep end-of-day override for Path capacity (v2.2 Ticket B, default 2).
-- Minutes from local midnight (e.g. 17*60 = 1020 = 5:00 PM); null = fall back to
-- the global DEFAULT_END_OF_DAY_MINUTES constant in code. Slots into the existing
-- owner-scoped path_preferences table; RLS is inherited unchanged. B-T2 reads
-- this column; this migration only adds it.

alter table path_preferences
  add column if not exists end_of_day_minutes integer;
