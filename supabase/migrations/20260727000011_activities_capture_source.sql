-- 20260727000011_activities_capture_source.sql
-- Every activity carries how it was captured (addendum 4.5). All current rows are
-- manual. Later separates new automatic-email visibility from prior under-logging.
alter table activities add column if not exists capture_source text not null default 'manual';
alter table activities drop constraint if exists activities_capture_source_check;
alter table activities add constraint activities_capture_source_check
  check (capture_source in ('manual','automatic'));
