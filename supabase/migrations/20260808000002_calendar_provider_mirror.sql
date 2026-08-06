-- Outlook push-out parity: record which calendar owns each mirrored event.
--
-- The three push-out sync functions (sync_appointment / sync_followup /
-- sync_path) each store one provider event id on a row. To push to Outlook as
-- well as Google without duplicate events, we need to know which provider owns
-- an existing mirror so we keep pushing there (and don't orphan it). These
-- nullable columns record that. Every existing mirror can only be Google today,
-- so we backfill accordingly.

alter table scheduled_appointments add column if not exists calendar_provider text;
alter table deals               add column if not exists followup_calendar_provider text;
alter table paths               add column if not exists path_calendar_provider text;

update scheduled_appointments set calendar_provider = 'google'
  where calendar_event_id is not null and calendar_provider is null;
update deals set followup_calendar_provider = 'google'
  where followup_calendar_event_id is not null and followup_calendar_provider is null;
update paths set path_calendar_provider = 'google'
  where path_calendar_event_id is not null and path_calendar_provider is null;

comment on column scheduled_appointments.calendar_provider is 'Which calendar owns the mirrored event (google|microsoft); null when unsynced.';
comment on column deals.followup_calendar_provider is 'Which calendar owns the follow-up mirror (google|microsoft); null when unsynced.';
comment on column paths.path_calendar_provider is 'Which calendar owns the path-block mirror (google|microsoft); null when unsynced.';
