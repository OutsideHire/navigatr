-- Calendar sync M3: a planned, not-yet-started path (Plan a Path) is mirrored to
-- an all-day Google Calendar block. These columns hold the pointer + sync state,
-- written by the sync_path Edge function (service role). One path per day, so
-- this lives on the paths row (no new table).
alter table paths
  add column if not exists path_calendar_event_id    text,
  add column if not exists path_calendar_sync_status  text check (path_calendar_sync_status in ('pending','synced','error')),
  add column if not exists path_calendar_error        text;
