-- 20260603000001_path_v3_tables.sql
--
-- Path v3: server-backed dated paths. One path per (rep, working day); each has
-- ordered stops. Replaces the local-only usePathQueue. Owner-scoped RLS keyed on
-- auth.uid() (no org pivot — a path is personal to the rep). path_stops snapshots
-- the business display fields at add-time so a path renders without re-reading the
-- volatile prospects TTL cache.

create table paths (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  path_date     date not null,
  origin_label  text,
  origin_lat    double precision,
  origin_lng    double precision,
  status        text not null default 'planned' check (status in ('planned', 'completed')),
  created_at    timestamptz not null default now(),
  unique (user_id, path_date)
);

create table path_stops (
  id            uuid primary key default gen_random_uuid(),
  path_id       uuid not null references paths(id) on delete cascade,
  -- prospect_id: NOT NULL + default RESTRICT is safe because `prospects` is
  -- upsert-only (on conflict place_id) — nothing hard-deletes prospect rows, so
  -- RESTRICT never fires. The snapshot columns below already decouple display
  -- from the prospects row (no join/RLS at render, survives field updates, and
  -- carries stops not in the current browse window). If a prospect-purge job is
  -- ever added, switch this FK to `on delete set null` and make the column
  -- nullable in a follow-up migration.
  prospect_id   uuid not null references prospects(id),
  name          text not null,
  address       text,
  lat           double precision not null,
  lng           double precision not null,
  category      text not null,
  primary_type  text,
  position      integer not null,
  status        text not null default 'pending' check (status in ('pending', 'visited', 'skipped')),
  disposition   text,
  deal_created  boolean not null default false,
  added_at      timestamptz not null default now(),
  unique (path_id, prospect_id)
);

create index paths_user_date_idx     on paths (user_id, path_date desc);
-- Non-unique on purpose: reorderStops rewrites positions one row at a time, so
-- positions are transiently duplicated mid-reorder. Order is advisory; the index
-- serves the per-path ordered fetch. (A unique constraint would need DEFERRABLE.)
create index path_stops_path_pos_idx on path_stops (path_id, position);

alter table paths enable row level security;
alter table path_stops enable row level security;

create policy paths_select on paths for select using (user_id = auth.uid());
create policy paths_insert on paths for insert with check (user_id = auth.uid());
create policy paths_update on paths for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy paths_delete on paths for delete using (user_id = auth.uid());

create policy path_stops_select on path_stops for select
  using (exists (select 1 from paths p where p.id = path_stops.path_id and p.user_id = auth.uid()));
create policy path_stops_insert on path_stops for insert
  with check (exists (select 1 from paths p where p.id = path_stops.path_id and p.user_id = auth.uid()));
create policy path_stops_update on path_stops for update
  using (exists (select 1 from paths p where p.id = path_stops.path_id and p.user_id = auth.uid()))
  with check (exists (select 1 from paths p where p.id = path_stops.path_id and p.user_id = auth.uid()));
create policy path_stops_delete on path_stops for delete
  using (exists (select 1 from paths p where p.id = path_stops.path_id and p.user_id = auth.uid()));
