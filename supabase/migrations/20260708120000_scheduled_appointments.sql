-- Two-way calendar sync, Milestone 1: future appointments a rep BOOKS (distinct
-- from the past-tense `activities` log). Attaches to a deal; pushed to the rep's
-- primary Google Calendar by the sync_appointment Edge function (which fills
-- calendar_event_id + calendar_sync_status via service role).
--
-- RLS follows the deals/activities pattern in this codebase: tenancy pivots on
-- the SECURITY DEFINER helpers public.user_org_id() / public.user_role()
-- (defined in 20260517000001_orgs_and_profiles.sql) rather than inline profile
-- sub-selects. profiles.role is the user_role enum ('rep','manager','admin').
create table scheduled_appointments (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  owner_id              uuid not null references profiles(id)      on delete cascade,
  deal_id               uuid not null references deals(id)         on delete cascade,
  title                 text not null,
  start_at              timestamptz not null,
  end_at                timestamptz not null,
  location_address      text,
  location_lat          double precision,
  location_lng          double precision,
  notes                 text,
  status                text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  calendar_event_id     text,
  calendar_sync_status  text not null default 'pending' check (calendar_sync_status in ('pending','synced','error')),
  calendar_sync_error   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (end_at > start_at)
);

create index scheduled_appointments_owner_start_idx on scheduled_appointments (owner_id, start_at);
create index scheduled_appointments_deal_idx        on scheduled_appointments (deal_id);

alter table scheduled_appointments enable row level security;

-- Reps see their own appointments; managers/admins see the whole org (matches
-- the coaching/visibility posture of deals + activities).
create policy scheduled_appointments_select on scheduled_appointments
  for select using (
    owner_id = auth.uid()
    or (
      org_id = public.user_org_id()
      and public.user_role() in ('manager', 'admin')
    )
  );

-- Reps book appointments as themselves.
create policy scheduled_appointments_insert on scheduled_appointments
  for insert with check (owner_id = auth.uid());

-- Reps edit only their own appointments.
create policy scheduled_appointments_update on scheduled_appointments
  for update using (owner_id = auth.uid());

-- Shared updated_at auto-bump helper (defined in 20260519000001_deals.sql).
create trigger scheduled_appointments_set_updated_at
  before update on scheduled_appointments
  for each row execute function set_updated_at();
