-- coverage_signal: detected activity signals for Activity Logging Coverage
-- (PRD §3.3.C). SP0 writes only phone/dial signals (one per click-to-call
-- tap at a deal-context call site). Rep-only visibility: a rep sees ONLY
-- their own signals — managers get aggregates in a later sub-project, never
-- raw signals (PRD §3.3.C.11). matched_activity_id / matched_at exist for
-- the SP1 matching job and are unused in v0 (matching is computed on read).

create table coverage_signal (
  id                  uuid primary key default gen_random_uuid(),

  -- Tenancy. Denormalized org_id (mirrors deals.org_id) enforced by the
  -- consistency trigger below — same pattern as activities.
  org_id              uuid not null references organizations(id) on delete cascade,

  -- The rep the signal belongs to. profiles.id = auth uid (same as
  -- activities.logged_by). on delete restrict preserves attribution.
  user_id             uuid not null references profiles(id) on delete restrict,

  -- v0 domain is constrained to the only values written today; widen the
  -- CHECK (cheap alter) as channels/types land in later sub-projects.
  channel             text not null check (channel in ('phone')),
  signal_type         text not null check (signal_type in ('dial')),
  deal_id             uuid not null references deals(id) on delete cascade,
  detected_at         timestamptz not null default now(),
  source_metadata     jsonb not null default '{}'::jsonb,   -- { phone_number }

  -- SP1 forward-compat (unused in v0).
  matched_activity_id uuid references activities(id) on delete set null,
  matched_at          timestamptz,

  created_at          timestamptz not null default now()
);

create index coverage_signal_user_detected_idx on coverage_signal (user_id, detected_at desc);
create index coverage_signal_deal_idx           on coverage_signal (deal_id);

-- Org consistency: overwrite org_id from the parent deal so a malformed
-- client payload cannot escape RLS isolation (mirrors activities).
create or replace function coverage_signal_enforce_org_consistency()
returns trigger
language plpgsql as $$
declare
  v_deal_org uuid;
begin
  select d.org_id into v_deal_org from deals d where d.id = new.deal_id;
  if v_deal_org is null then
    raise exception 'coverage_signal references non-existent deal';
  end if;
  new.org_id := v_deal_org;
  return new;
end $$;

create trigger coverage_signal_enforce_org_consistency_trg
  before insert or update of deal_id, org_id on coverage_signal
  for each row execute function coverage_signal_enforce_org_consistency();

-- ---------------------------------------------------------------------------
-- RLS — rep-only. A rep inserts + selects only their own signals. No
-- update/delete from the client (signals are immutable). No manager/admin
-- read path: unmatched signals are rep-private (PRD §3.3.C.11).
-- ---------------------------------------------------------------------------
alter table coverage_signal enable row level security;

create policy coverage_signal_select on coverage_signal for select
  using (user_id = auth.uid());

create policy coverage_signal_insert on coverage_signal for insert
  with check (org_id = public.user_org_id() and user_id = auth.uid());
