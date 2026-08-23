-- 20260820000007_hier_bundle5_location_capture.sql
--
-- PRD Addendum 6.12.A, Bundle 5 (P1). Captures a location GEOSTAMP when a rep
-- logs an activity, with the consent + retention mechanics the PRD requires.
-- NO manager-facing location surface ships in beta (FR-HIER-38); this only
-- starts the capture so a deferred (P2) view launches against real data.
--
-- D-12: location is only an event geostamp on a logged activity. No timed or
-- background sampling (FR-HIER-35). Capture never blocks the save (FR-HIER-34,
-- enforced client-side: the activity writes first, the geostamp is best-effort).
--
-- This migration adds:
--   1. activity_locations   one geostamp row per activity (FR-HIER-33)
--   2. user_location_settings   the per-user "geostamp on my activities"
--        consent, one of the three independent settings in FR-HIER-32
--        (default ON / opt-out, per the PRD; user decision 2026-08-23)
--   3. location_capture_config   the retention window (FR-HIER-36), a config
--        value not a constant, defaulting to 90 days
--   4. purge_activity_location_coords()   nulls coords past the window, kept on
--        a daily pg_cron job; the merchant link, timestamp + status remain

-- ---------------------------------------------------------------------------
-- 1. activity_locations — one geostamp per activity (FR-HIER-33)
-- ---------------------------------------------------------------------------
create table if not exists activity_locations (
  id             uuid primary key default gen_random_uuid(),
  -- One geostamp per activity; cascade so it dies with the activity.
  activity_id    uuid not null unique references activities(id) on delete cascade,
  org_id         uuid not null references organizations(id) on delete cascade,
  -- The "associated merchant identifier" (FR-HIER-33). Activities are deal-
  -- linked, so the deal is the merchant. Kept after coords are purged so the
  -- surviving record still says WHICH merchant the touch was at.
  deal_id        uuid references deals(id) on delete set null,
  -- Device timestamp of the capture attempt.
  captured_at    timestamptz not null,
  -- Coordinates + accuracy in metres. Nullable: absent on a failed capture, and
  -- NULLED by the retention job once past the window (FR-HIER-36).
  latitude       double precision,
  longitude      double precision,
  accuracy_m     double precision,
  -- Why capture did or didn't resolve (FR-HIER-33). Drives the weekly capture-
  -- health figure (FR-HIER-37).
  capture_status text not null check (capture_status in
    ('captured', 'permission_denied', 'timed_out', 'unavailable', 'unsupported')),
  created_at     timestamptz not null default now()
);

create index activity_locations_org_captured_idx on activity_locations (org_id, captured_at);
create index activity_locations_deal_idx          on activity_locations (deal_id);

alter table activity_locations enable row level security;

-- INSERT: a rep may only geostamp an activity they logged (org-pinned). The
-- geostamp is written in the same client flow as the activity.
drop policy if exists activity_locations_insert on activity_locations;
create policy activity_locations_insert on activity_locations for insert
  with check (
    org_id = public.user_org_id()
    and exists (
      select 1 from activities a
      where a.id = activity_id
        and a.logged_by = auth.uid()
    )
  );

-- SELECT: fail closed for beta. The logger sees their own geostamps (the basis
-- for the deferred FR-HIER-41 "what my manager sees about me"), and an admin
-- sees the org's (needed for the operational capture-health figure). There is
-- deliberately NO manager/peer cross-visibility here: the manager-facing
-- location view is P2 and ships behind its own acknowledgment gate.
drop policy if exists activity_locations_select on activity_locations;
create policy activity_locations_select on activity_locations for select
  using (
    org_id = public.user_org_id()
    and (
      public.caller_is_admin()
      or exists (
        select 1 from activities a
        where a.id = activity_id
          and a.logged_by = auth.uid()
      )
    )
  );

-- No UPDATE/DELETE for clients. The retention purge runs as a SECURITY DEFINER
-- function; a geostamp is otherwise immutable.
revoke update, delete on activity_locations from authenticated;

-- ---------------------------------------------------------------------------
-- 2. user_location_settings — per-user consent (FR-HIER-32)
-- ---------------------------------------------------------------------------
-- The "geostamp on a logged activity" consent. Default ON: a missing row is
-- treated as enabled by the client, so we only store an explicit opt-out.
-- (The other two FR-HIER-32 settings: routing position is the OS prompt in
-- Path, unchanged; manager-sharing does not exist in beta.)
create table if not exists user_location_settings (
  user_id                   uuid primary key references profiles(id) on delete cascade,
  org_id                    uuid not null references organizations(id) on delete cascade,
  activity_geostamp_enabled boolean not null default true,
  updated_at                timestamptz not null default now()
);

alter table user_location_settings enable row level security;

drop policy if exists user_location_settings_select on user_location_settings;
create policy user_location_settings_select on user_location_settings for select
  using (user_id = auth.uid());

drop policy if exists user_location_settings_insert on user_location_settings;
create policy user_location_settings_insert on user_location_settings for insert
  with check (user_id = auth.uid() and org_id = public.user_org_id());

drop policy if exists user_location_settings_update on user_location_settings;
create policy user_location_settings_update on user_location_settings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. location_capture_config — retention window (FR-HIER-36)
-- ---------------------------------------------------------------------------
-- Single-row config. Retention is a value, not a constant, so it can be set
-- before the first production tenant without a code change.
create table if not exists location_capture_config (
  id             boolean primary key default true check (id),  -- single row
  retention_days int not null default 90 check (retention_days > 0),
  updated_at     timestamptz not null default now()
);
insert into location_capture_config (id) values (true) on conflict (id) do nothing;

alter table location_capture_config enable row level security;
-- Read-only to admins; writes happen via migration / operator, not the client.
drop policy if exists location_capture_config_select on location_capture_config;
create policy location_capture_config_select on location_capture_config for select
  using (public.caller_is_admin());

-- ---------------------------------------------------------------------------
-- 4. Retention purge (FR-HIER-36) — null coords past the window, keep the rest
-- ---------------------------------------------------------------------------
create or replace function public.purge_activity_location_coords()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_days int;
  v_count int;
begin
  select retention_days into v_days from location_capture_config where id = true;
  v_days := coalesce(v_days, 90);
  update activity_locations
     set latitude = null, longitude = null, accuracy_m = null
   where captured_at < now() - make_interval(days => v_days)
     and (latitude is not null or longitude is not null or accuracy_m is not null);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Daily purge. Pure-SQL job, so pg_cron calls the function directly (no edge
-- function / shared secret needed). Idempotent: re-scheduling replaces the job.
select cron.schedule(
  'purge-activity-location-coords',
  '30 4 * * *',
  $$ select public.purge_activity_location_coords() $$
);
