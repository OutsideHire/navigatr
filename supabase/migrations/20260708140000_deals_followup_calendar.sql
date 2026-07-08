-- Calendar sync M2: the deal's current follow-up (deals.next_followup_at) is
-- mirrored to an all-day Google Calendar event. These columns hold the pointer +
-- sync state, written by the sync_followup Edge function (service role). One
-- follow-up per deal, so this lives on the deal (no new table).
alter table deals
  add column if not exists followup_calendar_event_id    text,
  add column if not exists followup_calendar_sync_status  text check (followup_calendar_sync_status in ('pending','synced','error')),
  add column if not exists followup_calendar_error        text;
