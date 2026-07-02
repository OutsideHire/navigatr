-- 20260702120000_paths_started_at.sql
--
-- Path auto-start & resume-in-place. Adds a single nullable marker to paths:
-- `started_at` = the moment the rep actually began running the route (Create a
-- Path stamps it now(); Plan a Path leaves it null until the rep starts). Combined
-- with the existing per-stop statuses, it derives three lifecycle states without a
-- stored current-stop pointer:
--   started_at IS NULL                         -> Planned (Entry / Upcoming)
--   started_at set + >=1 pending stop          -> In progress (Run @ first pending)
--   started_at set + no pending stops remain   -> Completed (Summary)
--
-- Nullable, no default, no backfill: legacy paths (created before this migration)
-- keep started_at NULL and are treated as Planned, so no path is spuriously
-- resumed mid-run after deploy.

alter table public.paths add column started_at timestamptz;
