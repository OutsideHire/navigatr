-- Plan a Path — Schedule (SP3): future-dated planned paths gain an optional
-- human name and an in-app reminder timestamp. Both additive + nullable; no RLS
-- or status changes (a future-dated planned path already IS an "upcoming path").
alter table paths add column if not exists name text;
alter table paths add column if not exists reminder_at timestamptz;
