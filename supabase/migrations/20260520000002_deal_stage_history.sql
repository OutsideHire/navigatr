-- deal_stage_history: append-only log of every stage transition on
-- every deal. Powers the dashboard's Conversion Funnel + the
-- "touches before win" persistence stat (already shipped via the
-- activities-to-win hero) + future cycle-time analytics.
--
-- Two write paths:
--   1. On INSERT of a deal — write a (from_stage=NULL, to_stage=new.stage)
--      row so the funnel "entered X" count is correct from day one.
--   2. On UPDATE OF stage on deals (and only when actually changed) —
--      write a (from_stage=old, to_stage=new) row.
--
-- The frontend never writes to this table — it's RLS read-only for
-- authenticated users. The trigger functions are SECURITY DEFINER so
-- they always succeed even if the calling user couldn't INSERT directly.

create table deal_stage_history (
  id                uuid primary key default gen_random_uuid(),

  -- Tenancy. Denorm org_id mirrors deals.org_id; the trigger pulls it
  -- from the parent deal so it's always consistent.
  org_id            uuid not null references organizations(id) on delete cascade,
  deal_id           uuid not null references deals(id)         on delete cascade,

  -- Stage transition. from_stage NULL for the INSERT case ("created in
  -- stage X" — useful for the funnel's "entered" counts).
  from_stage        deal_stage,
  to_stage          deal_stage not null,

  -- When the transition happened. Defaults to now() so the trigger
  -- doesn't have to set it explicitly.
  transitioned_at   timestamptz not null default now(),

  -- Who did it. Pulled from auth.uid() inside the trigger. NULL if a
  -- system / service-role context drove the change (e.g. a Sprint 2
  -- automation rule).
  transitioned_by   uuid references profiles(id) on delete set null,

  -- Sanity guard: a transition row should never have from_stage equal
  -- to to_stage (no-op). Lets us catch trigger bugs early.
  constraint deal_stage_history_no_noop
    check (from_stage is null or from_stage <> to_stage)
);

-- Indexes
-- Funnel rollup walks history grouped by deal: (deal_id, transitioned_at desc).
-- Per-stage "entered" counts: (org_id, to_stage).
-- Recency by org for "last 4 weeks of activity" widgets: (org_id, transitioned_at desc).
create index deal_stage_history_deal_idx       on deal_stage_history (deal_id, transitioned_at desc);
create index deal_stage_history_org_to_idx     on deal_stage_history (org_id, to_stage);
create index deal_stage_history_org_at_idx     on deal_stage_history (org_id, transitioned_at desc);

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the trigger always succeeds — frontend users have
-- no INSERT privilege on deal_stage_history (RLS policy below denies
-- INSERT for the authenticated role), but the trigger needs to write
-- on their behalf.
create or replace function deal_stage_history_record_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into deal_stage_history (org_id, deal_id, from_stage, to_stage, transitioned_by)
  values (new.org_id, new.id, null, new.stage, auth.uid());
  return new;
end $$;

create or replace function deal_stage_history_record_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only record actual transitions. UPDATE of other columns shouldn't
  -- pollute history.
  if new.stage is distinct from old.stage then
    insert into deal_stage_history (org_id, deal_id, from_stage, to_stage, transitioned_by)
    values (new.org_id, new.id, old.stage, new.stage, auth.uid());
  end if;
  return new;
end $$;

create trigger deal_stage_history_insert_trg
  after insert on deals
  for each row execute function deal_stage_history_record_insert();

create trigger deal_stage_history_update_trg
  after update of stage on deals
  for each row execute function deal_stage_history_record_update();

-- ---------------------------------------------------------------------------
-- Backfill — give every existing deal a synthetic "created in stage X"
-- row so the funnel + per-stage counts reflect reality immediately.
-- Without this, on the first run the funnel would show zeros because no
-- INSERT triggers fired for pre-existing rows.
--
-- transitioned_by is left NULL because we can't know who originally
-- created these deals (auth.uid() is null at migration time).
-- transitioned_at uses the deal's created_at so the timeline is
-- accurate.
-- ---------------------------------------------------------------------------
insert into deal_stage_history (org_id, deal_id, from_stage, to_stage, transitioned_at, transitioned_by)
select org_id, id, null, stage, created_at, null
from deals
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RLS — read-only for authenticated users.
-- ---------------------------------------------------------------------------
-- No INSERT/UPDATE/DELETE policies. The triggers are SECURITY DEFINER
-- so they bypass RLS for writes; clients can never modify the audit
-- log directly. Forge-proof.
alter table deal_stage_history enable row level security;

create policy deal_stage_history_select on deal_stage_history for select
  using (org_id = public.user_org_id());
