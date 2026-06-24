-- coverage_snapshot: per-rep, per-day Activity Logging Coverage snapshot
-- (PRD §3.3.C.14). SP1 fills the call channel only; visit/meeting/email
-- columns are nullable forward-compat for SP3-5. Unlike rep-only
-- coverage_signal, snapshot SCORES are manager-visible (PRD §3.3.C.10).
-- Written exclusively by the service-role nightly job (bypasses RLS).

create table coverage_snapshot (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  user_id             uuid not null references profiles(id) on delete cascade,
  snapshot_date       date not null,

  composite_coverage  numeric not null check (composite_coverage between 0 and 1),
  confidence_level    text not null check (confidence_level in ('high','medium','low','insufficient')),

  -- Per-channel: coverage is 0..1 or NULL when the channel is inactive; for the
  -- live call channel event_count is 0-or-more, while the not-yet-built channels
  -- stay NULL (null = channel not live, 0 = live but no detected events).
  call_coverage       numeric check (call_coverage between 0 and 1),
  call_event_count    int not null default 0,
  visit_coverage      numeric check (visit_coverage between 0 and 1),   -- forward-compat (SP5)
  visit_event_count   int,
  meeting_coverage    numeric check (meeting_coverage between 0 and 1), -- forward-compat (SP3)
  meeting_event_count int,
  email_coverage      numeric check (email_coverage between 0 and 1),   -- forward-compat (SP4)
  email_event_count   int,

  active_channels     text[] not null default '{}',
  window_start_date   date not null,
  window_end_date     date not null,
  created_at          timestamptz not null default now(),

  unique (user_id, snapshot_date)
);

create index coverage_snapshot_user_date_idx on coverage_snapshot (user_id, snapshot_date desc);
create index coverage_snapshot_org_date_idx  on coverage_snapshot (org_id, snapshot_date);

-- Org consistency: pull org_id from the rep's profile (the job sets it, but
-- keep the column authoritative — mirrors the activities pattern).
create or replace function coverage_snapshot_enforce_org_consistency()
returns trigger
language plpgsql as $$
declare
  v_org uuid;
begin
  select p.org_id into v_org from profiles p where p.id = new.user_id;
  if v_org is null then
    raise exception 'coverage_snapshot references a user with no org';
  end if;
  new.org_id := v_org;
  return new;
end $$;

create trigger coverage_snapshot_enforce_org_consistency_trg
  before insert or update of user_id, org_id on coverage_snapshot
  for each row execute function coverage_snapshot_enforce_org_consistency();

-- RLS: rep reads own; manager/admin read their hierarchy subtree (scores are
-- manager-visible). The org gate is REQUIRED and load-bearing: user_can_see_owner
-- does no org check of its own (and returns true on NULL role_path), so every
-- caller (deals, activities) ANDs it with org_id = user_org_id() — without that
-- gate this leaks snapshots cross-org. No INSERT/UPDATE/DELETE policy exists by
-- design: with RLS enabled, that denies all client writes, so only the
-- service-role nightly job (which bypasses RLS) can write.
alter table coverage_snapshot enable row level security;

create policy coverage_snapshot_select on coverage_snapshot for select
  using (
    org_id = public.user_org_id()
    and (user_id = auth.uid() or public.user_can_see_owner(user_id))
  );

-- Per-org coverage configuration (bands, minimums, enabled channels, label
-- overrides). Code supplies defaults when keys are absent.
alter table organizations
  add column if not exists coverage_config jsonb not null default '{}'::jsonb;
