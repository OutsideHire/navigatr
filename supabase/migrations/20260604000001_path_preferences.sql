-- 20260604000001_path_preferences.sql
--
-- Per-rep Path preferences. v1 holds the default industry set (category →
-- selected sub-type/primary_type keys) that auto-applies to every new path.
-- Owner-scoped RLS keyed on auth.uid(). Extensible: future default_radius_m /
-- default_max_stops columns slot in. One row per rep.

create table path_preferences (
  user_id            uuid primary key references profiles(id) on delete cascade,
  default_industries jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);

alter table path_preferences enable row level security;

create policy path_preferences_select on path_preferences for select using (user_id = auth.uid());
create policy path_preferences_insert on path_preferences for insert with check (user_id = auth.uid());
create policy path_preferences_update on path_preferences for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy path_preferences_delete on path_preferences for delete using (user_id = auth.uid());
