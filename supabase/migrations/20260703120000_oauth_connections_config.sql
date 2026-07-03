-- Slice 1 of calendar-aware Path: remember which of a rep's connected calendars
-- are marked "personal" (never read for Path). Stored per oauth_connections row
-- as { "personalCalendarIds": ["cal-id-1", ...] }. No path/path_stops changes —
-- calendar waypoints are an ephemeral planning overlay in this slice.
alter table public.oauth_connections
  add column if not exists config jsonb not null default '{}'::jsonb;
