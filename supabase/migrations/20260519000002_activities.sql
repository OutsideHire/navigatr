-- activities: per-deal interaction log. Each row is one call / email /
-- drop-in / appointment. Drives the deal-detail timeline + the org-wide
-- "what happened today" feed. The deals table carries denormalized
-- last_activity_at / next_followup_at columns that we keep in sync via
-- the trigger at the bottom of this migration.

create table activities (
  id                uuid primary key default gen_random_uuid(),

  -- Tenancy. Denormalized org_id (mirrors deals.org_id) so RLS is one
  -- column lookup instead of a sub-select against deals on every row.
  -- A trigger (activities_enforce_org_consistency) enforces the mirror.
  org_id            uuid not null references organizations(id) on delete cascade,

  -- The deal this activity belongs to.
  deal_id           uuid not null references deals(id) on delete cascade,

  -- Who logged it. on delete restrict so we preserve attribution if a
  -- rep leaves; a manager can re-assign by updating the row.
  logged_by         uuid not null references profiles(id) on delete restrict,

  type              activity_type not null,
  disposition       disposition not null,

  -- Minutes. Required for call/appointment; null for email/drop_in
  -- (enforced at the API layer, not at the DB — the disposition tile
  -- design lets the rep pick a type that doesn't require duration).
  duration_minutes  int check (duration_minutes is null or duration_minutes >= 0),

  outcome_notes     text not null default '',

  -- When the activity actually happened (rep can backfill).
  occurred_at       timestamptz not null default now(),

  -- Calculated follow-up date based on disposition (frontend computes
  -- via lib/followUpScheduling). Null for terminal outcomes
  -- (closed_lost, not_interested) and for dispositions with no auto-
  -- scheduled next touch.
  follow_up_date    date,

  -- When the row was written to the DB. Distinct from occurred_at —
  -- e.g. a rep logging yesterday's call this morning has
  -- occurred_at = yesterday but created_at = now.
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Org-wide activity feed (Activities page): (org_id, occurred_at desc).
-- Deal timeline (DealDetailPage): (deal_id, occurred_at desc).
-- "My activity" filter (logged_by + recency): (logged_by, occurred_at desc).
create index activities_org_occurred_idx     on activities (org_id, occurred_at desc);
create index activities_deal_occurred_idx    on activities (deal_id, occurred_at desc);
create index activities_logged_by_occurred_idx on activities (logged_by, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Org consistency trigger
-- ---------------------------------------------------------------------------
-- activities.org_id MUST equal deals.org_id for the linked deal. The FK
-- on deal_id doesn't constrain this — an activity could be inserted with
-- org_id = orgA pointing at a deal in orgB, which would bypass RLS
-- isolation. This trigger pulls org_id from the parent deal on every
-- insert/update so the caller cannot cheat it.
create or replace function activities_enforce_org_consistency()
returns trigger
language plpgsql as $$
declare
  v_deal_org uuid;
begin
  select d.org_id into v_deal_org from deals d where d.id = new.deal_id;
  if v_deal_org is null then
    raise exception 'activity references non-existent deal';
  end if;
  -- Always overwrite, don't trust the caller. If they passed a mismatching
  -- value it was either a bug or an attempt to escape RLS — either way,
  -- the deal's org_id is authoritative.
  new.org_id := v_deal_org;
  return new;
end $$;

create trigger activities_enforce_org_consistency_trg
  before insert or update of deal_id, org_id on activities
  for each row execute function activities_enforce_org_consistency();

-- ---------------------------------------------------------------------------
-- Deal denormalized-columns sync trigger
-- ---------------------------------------------------------------------------
-- deals.last_activity_at and deals.next_followup_at are denormalized so
-- the pipeline list page doesn't have to aggregate over activities on
-- every render. This trigger keeps them in sync.
--
-- After any insert/update/delete on activities, recompute the parent
-- deal's:
--   last_activity_at = MAX(occurred_at) across all activities for the deal
--   next_followup_at = the most-recent activity's follow_up_date
--                      (most recent = ORDER BY occurred_at DESC LIMIT 1)
--
-- The "most recent activity owns the next follow-up" semantic matches
-- how reps actually work: each call's disposition supersedes the prior
-- one's follow-up plan.
create or replace function activities_sync_deal_denorm()
returns trigger
language plpgsql as $$
declare
  v_deal_id        uuid;
  v_last_activity  timestamptz;
  v_next_followup  timestamptz;
begin
  -- Pick the deal_id to recompute. For INSERT/UPDATE that's new.deal_id;
  -- for DELETE it's old.deal_id. UPDATE could in theory move an activity
  -- between deals, in which case both old + new need recomputing — we
  -- handle that via the two-recompute branch.
  if tg_op = 'DELETE' then
    v_deal_id := old.deal_id;
  else
    v_deal_id := new.deal_id;
  end if;

  -- Recompute for v_deal_id.
  select max(a.occurred_at) into v_last_activity
  from activities a where a.deal_id = v_deal_id;

  select (a.follow_up_date::timestamptz) into v_next_followup
  from activities a
  where a.deal_id = v_deal_id
  order by a.occurred_at desc
  limit 1;

  update deals
     set last_activity_at = v_last_activity,
         next_followup_at = v_next_followup
   where id = v_deal_id;

  -- UPDATE that moved an activity between deals: also recompute the
  -- prior deal so its denorm columns reflect the loss.
  if tg_op = 'UPDATE' and old.deal_id is distinct from new.deal_id then
    select max(a.occurred_at) into v_last_activity
    from activities a where a.deal_id = old.deal_id;

    select (a.follow_up_date::timestamptz) into v_next_followup
    from activities a
    where a.deal_id = old.deal_id
    order by a.occurred_at desc
    limit 1;

    update deals
       set last_activity_at = v_last_activity,
           next_followup_at = v_next_followup
     where id = old.deal_id;
  end if;

  return null; -- AFTER trigger; return value ignored.
end $$;

create trigger activities_sync_deal_denorm_trg
  after insert or update or delete on activities
  for each row execute function activities_sync_deal_denorm();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table activities enable row level security;

-- Everyone in the org sees every activity in the org. Same coaching /
-- visibility argument as deals.
create policy activities_select on activities for select
  using (org_id = public.user_org_id());

-- Reps log activities as themselves. with-check pins org_id to the
-- user's org (the trigger will overwrite from the deal, so this is
-- belt-and-suspenders for the rare case the trigger is disabled) and
-- logged_by to the session user.
create policy activities_insert on activities for insert
  with check (
    org_id    = public.user_org_id()
    and logged_by = auth.uid()
  );

-- Reps edit only their own logs. Managers/admins edit any in the org.
-- with-check forbids moving an activity to another org via UPDATE.
create policy activities_update on activities for update
  using (
    org_id = public.user_org_id()
    and (
      public.user_role() in ('manager', 'admin')
      or logged_by = auth.uid()
    )
  )
  with check (
    org_id = public.user_org_id()
  );

-- Delete is destructive (loses audit trail). Managers/admins only.
-- If reps need to "undo" a misfire, they UPDATE the disposition or
-- amend notes; we don't surface true deletion in the rep UI.
create policy activities_delete on activities for delete
  using (
    org_id = public.user_org_id()
    and public.user_role() in ('manager', 'admin')
  );
