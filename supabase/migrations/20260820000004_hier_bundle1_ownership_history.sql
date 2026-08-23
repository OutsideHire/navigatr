-- 20260820000004_hier_bundle1_ownership_history.sql
--
-- PRD Addendum 6.12.A, Bundle 1 (P0), the two IRREVERSIBLE requirements:
--   FR-HIER-01  Deal ownership changes -> append-only history (prior owner +
--               effective date), so any past period can be attributed to the
--               owner as it stood then. The current owner stays on deals.
--   FR-HIER-02  Reporting-line changes -> append-only history (prior manager +
--               prior role level + effective date), so a period can be reported
--               against the hierarchy as it stood then.
--
-- These capture information that cannot be reconstructed once overwritten. No
-- reporting surface is required in this release; this only starts the record.
--
-- Append-only mechanics: RLS is enabled with ONLY a SELECT policy (admin-scoped
-- audit read). There is no INSERT / UPDATE / DELETE policy, so clients can
-- neither write nor mutate the history. The rows are written exclusively by the
-- SECURITY DEFINER capture triggers below, which run as the table owner and so
-- bypass RLS. UPDATE/DELETE are additionally revoked from authenticated.

-- ---------------------------------------------------------------------------
-- 1. deal_owner_history (FR-HIER-01)
-- ---------------------------------------------------------------------------
create table if not exists deal_owner_history (
  id                uuid primary key default gen_random_uuid(),
  deal_id           uuid not null references deals(id) on delete cascade,
  org_id            uuid not null references organizations(id) on delete cascade,
  -- null on the initial assignment (deal creation). on delete set null so a
  -- future profile deletion never blocks on the audit trail.
  previous_owner_id uuid references profiles(id) on delete set null,
  new_owner_id      uuid references profiles(id) on delete set null,
  effective_at      timestamptz not null,
  recorded_at       timestamptz not null default now()
);

create index deal_owner_history_deal_idx on deal_owner_history (deal_id, effective_at);
create index deal_owner_history_org_idx  on deal_owner_history (org_id, effective_at);

alter table deal_owner_history enable row level security;

-- Audit read is admin-only for now (no rep-facing surface this release).
drop policy if exists deal_owner_history_select on deal_owner_history;
create policy deal_owner_history_select on deal_owner_history for select
  using (org_id = public.user_org_id() and public.caller_is_admin());

revoke update, delete on deal_owner_history from authenticated;

-- Capture trigger. AFTER INSERT records the initial assignment (previous null);
-- AFTER UPDATE records only when owner_id actually changed. org_id/effective_at
-- come from the deal row (owner_changed_at is set by deals_touch_owner_changed_at).
create or replace function public.record_deal_owner_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into deal_owner_history (deal_id, org_id, previous_owner_id, new_owner_id, effective_at)
    values (new.id, new.org_id, null, new.owner_id, coalesce(new.owner_changed_at, new.created_at, now()));
  elsif tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    insert into deal_owner_history (deal_id, org_id, previous_owner_id, new_owner_id, effective_at)
    values (new.id, new.org_id, old.owner_id, new.owner_id, coalesce(new.owner_changed_at, now()));
  end if;
  return null; -- AFTER trigger; return value ignored
end $$;

drop trigger if exists deals_record_owner_change on deals;
create trigger deals_record_owner_change
  after insert or update of owner_id on deals
  for each row execute function public.record_deal_owner_change();

-- ---------------------------------------------------------------------------
-- 2. reporting_line_history (FR-HIER-02)
-- ---------------------------------------------------------------------------
create table if not exists reporting_line_history (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id) on delete cascade,
  org_id              uuid not null references organizations(id) on delete cascade,
  previous_manager_id uuid references profiles(id) on delete set null,
  new_manager_id      uuid references profiles(id) on delete set null,
  previous_role_level role_level,
  new_role_level      role_level,
  effective_at        timestamptz not null default now(),
  recorded_at         timestamptz not null default now()
);

create index reporting_line_history_user_idx on reporting_line_history (user_id, effective_at);
create index reporting_line_history_org_idx  on reporting_line_history (org_id, effective_at);

alter table reporting_line_history enable row level security;

drop policy if exists reporting_line_history_select on reporting_line_history;
create policy reporting_line_history_select on reporting_line_history for select
  using (org_id = public.user_org_id() and public.caller_is_admin());

revoke update, delete on reporting_line_history from authenticated;

-- Capture trigger. Records the initial placement on INSERT, and any change to
-- manager_id OR role_level on UPDATE. A pure role_path recompute (which does not
-- touch manager_id/role_level) does NOT log, so subtree rebuilds are silent.
create or replace function public.record_reporting_line_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into reporting_line_history (user_id, org_id, previous_manager_id, new_manager_id, previous_role_level, new_role_level)
    values (new.id, new.org_id, null, new.manager_id, null, new.role_level);
  elsif tg_op = 'UPDATE'
    and (new.manager_id is distinct from old.manager_id
         or new.role_level is distinct from old.role_level) then
    insert into reporting_line_history (user_id, org_id, previous_manager_id, new_manager_id, previous_role_level, new_role_level)
    values (new.id, new.org_id, old.manager_id, new.manager_id, old.role_level, new.role_level);
  end if;
  return null;
end $$;

drop trigger if exists profiles_record_reporting_line_change on profiles;
create trigger profiles_record_reporting_line_change
  after insert or update of manager_id, role_level on profiles
  for each row execute function public.record_reporting_line_change();
