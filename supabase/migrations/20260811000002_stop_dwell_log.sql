-- 20260811000002_stop_dwell_log.sql
--
-- Real per-stop dwell logging (Path v2.2 Ticket B 4.3.2). The 15/30-minute
-- dwell defaults in the driving sequence are estimates; this table records the
-- MEASURED elapsed time between a rep marking arrival ("I'm here") and closing
-- out the stop (logging the outcome), so those estimates can later be replaced
-- with measured per-rep averages. One row per closed-out stop. Invisible to the
-- rep and best-effort at the write site: a failure here never disrupts the run.
--
-- `stop_type` is normalized to the two dwell buckets the estimates use:
-- "appointment" (a scheduled meeting) and "discovery" (a drop-in / nearby /
-- owed visit), so appointments and drop-ins accumulate separately.
--
-- Owner-scoped RLS keyed on auth.uid() (mirrors path_preferences): a rep can
-- insert and read only their own rows.

create table stop_dwell_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  stop_type     text not null check (stop_type in ('appointment', 'discovery')),
  deal_id       uuid references deals(id) on delete set null,
  arrived_at    timestamptz not null,
  closed_at     timestamptz not null,
  dwell_minutes numeric not null,
  created_at    timestamptz not null default now()
);

create index stop_dwell_log_user_type_idx on stop_dwell_log (user_id, stop_type);

alter table stop_dwell_log enable row level security;

create policy stop_dwell_log_select on stop_dwell_log for select using (user_id = auth.uid());
create policy stop_dwell_log_insert on stop_dwell_log for insert with check (user_id = auth.uid());
