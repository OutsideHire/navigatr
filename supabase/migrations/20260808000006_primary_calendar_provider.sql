-- 20260808000006_primary_calendar_provider.sql
-- A rep's chosen PRIMARY calendar for navigatr write-back. Null = auto
-- (keep existing mirror, else Google-first). Only meaningful when the rep has
-- more than one provider connected; the push resolver honors it when the named
-- provider is still active, else falls back to the auto rule.
alter table profiles
  add column if not exists primary_calendar_provider text
  check (primary_calendar_provider in ('google','microsoft'));
comment on column profiles.primary_calendar_provider is
  'Rep-chosen calendar for navigatr write-back (google|microsoft). Null = auto (existing mirror, else Google-first).';
