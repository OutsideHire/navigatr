-- 20260727000012_persistence_snapshot_insufficient_data.sql
-- Below the follow-up volume floor the composite is not comparable to a full
-- 0-100 score (addendum 4.3, R-01). Flag those rows so the trend line breaks and
-- the value is not plotted next to full scores.
alter table persistence_index_snapshot
  add column if not exists insufficient_data boolean not null default false;
