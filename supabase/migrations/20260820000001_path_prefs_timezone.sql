-- 20260820000001_path_prefs_timezone.sql
--
-- Per-rep IANA timezone (Workday Window Fix v1.4 Ticket 2). Stores the rep's
-- clock zone (e.g. 'America/Chicago') so day boundaries (Path window, overdue
-- lists, Follow-Up Discipline scoring) resolve in the rep's local day instead
-- of UTC. Captured from the device at sign-in; editable in Path settings; null
-- until captured. Slots into the existing owner-scoped path_preferences table
-- (user_id PK), so RLS is inherited unchanged. Store an IANA identifier ONLY,
-- never an offset or abbreviation, so daylight-saving rules are carried
-- correctly (America/Phoenix and Pacific/Honolulu do not observe DST at all).

alter table path_preferences
  add column if not exists timezone text;
