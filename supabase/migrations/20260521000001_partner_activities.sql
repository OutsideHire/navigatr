-- partner_activities: log every touch with a partner (cpa, banker,
-- attorney, etc.). Mirrors deals.activities — type, disposition-ish
-- note, occurred_at, follow_up_date — but partner-scoped instead of
-- deal-scoped. Drives the rep's "stay warm" cadence with referral
-- sources.
--
-- Design note: activities-against-deals and activities-against-partners
-- are intentionally separate tables. A touch with a partner doesn't
-- belong to a deal (it might generate one later) and forcing them
-- through a polymorphic activities table costs more in join complexity
-- than two clean tables save.
--
-- The trigger keeps partners.last_touch_at + next_followup_at in sync,
-- same pattern as activities → deals.

-- partner_touch_type — narrower vocabulary than activity_type because
-- "drop-in" doesn't usually apply to a CPA (they're typically office
-- visits scheduled in advance). Keep distinct from activity_type so
-- adding a partner-specific kind later (e.g. "lunch", "event") doesn't
-- pollute the deal-side enum.
create type partner_touch_type as enum ('call', 'email', 'meeting', 'note');

create table partner_activities (
  id                uuid primary key default gen_random_uuid(),

  -- Tenancy. Denorm org_id mirrors partner.org_id; trigger enforces.
  org_id            uuid not null references organizations(id) on delete cascade,
  partner_id        uuid not null references partners(id)      on delete cascade,

  -- Who logged it. on delete restrict so the audit trail survives a
  -- rep leaving; managers can re-attribute via UPDATE.
  logged_by         uuid not null references profiles(id) on delete restrict,

  type              partner_touch_type not null,

  -- Free-text note. No disposition enum here — partner relationships
  -- are looser than deal pipelines. The "outcome" is the note itself.
  notes             text not null default '',

  -- Minutes. Optional — emails + notes don't have a duration.
  duration_minutes  int check (duration_minutes is null or duration_minutes >= 0),

  -- When the touch happened (rep can backfill).
  occurred_at       timestamptz not null default now(),

  -- Optional next-touch date. Drives the partner's next_followup_at
  -- denorm on the parent partner.
  follow_up_date    date,

  created_at        timestamptz not null default now()
);

-- Indexes
-- Per-partner timeline (most common access pattern).
create index partner_activities_partner_at_idx on partner_activities (partner_id, occurred_at desc);
-- Org-wide "what's happening with partners" feed.
create index partner_activities_org_at_idx     on partner_activities (org_id, occurred_at desc);
-- "My partner activity" filter.
create index partner_activities_logged_by_idx  on partner_activities (logged_by, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Org-consistency trigger — same hazard as activities/partner_deals.
-- ---------------------------------------------------------------------------
create or replace function partner_activities_enforce_org_consistency()
returns trigger
language plpgsql as $$
declare
  v_partner_org uuid;
begin
  select p.org_id into v_partner_org from partners p where p.id = new.partner_id;
  if v_partner_org is null then
    raise exception 'partner_activities references non-existent partner';
  end if;
  -- Authoritative source is partners.org_id; overwrite whatever the
  -- caller sent. RLS isolation depends on this.
  new.org_id := v_partner_org;
  return new;
end $$;

create trigger partner_activities_enforce_org_consistency_trg
  before insert or update of partner_id, org_id on partner_activities
  for each row execute function partner_activities_enforce_org_consistency();

-- ---------------------------------------------------------------------------
-- Sync trigger — keeps partners.last_touch_at + next_followup_at fresh.
-- Same shape as activities → deals.
-- ---------------------------------------------------------------------------
create or replace function partner_activities_sync_partner_denorm()
returns trigger
language plpgsql as $$
declare
  v_partner_id     uuid;
  v_last_touch     timestamptz;
  v_next_followup  timestamptz;
begin
  if tg_op = 'DELETE' then
    v_partner_id := old.partner_id;
  else
    v_partner_id := new.partner_id;
  end if;

  select max(a.occurred_at) into v_last_touch
  from partner_activities a where a.partner_id = v_partner_id;

  -- Most recent touch's follow_up_date wins. Reps maintain plans
  -- forward-only; each touch supersedes the prior plan.
  select (a.follow_up_date::timestamptz) into v_next_followup
  from partner_activities a
  where a.partner_id = v_partner_id
  order by a.occurred_at desc
  limit 1;

  update partners
     set last_touch_at = v_last_touch,
         next_followup_at = v_next_followup
   where id = v_partner_id;

  -- UPDATE that moved an activity between partners: also recompute
  -- the prior partner. Rare but legitimate.
  if tg_op = 'UPDATE' and old.partner_id is distinct from new.partner_id then
    select max(a.occurred_at) into v_last_touch
    from partner_activities a where a.partner_id = old.partner_id;

    select (a.follow_up_date::timestamptz) into v_next_followup
    from partner_activities a
    where a.partner_id = old.partner_id
    order by a.occurred_at desc
    limit 1;

    update partners
       set last_touch_at = v_last_touch,
           next_followup_at = v_next_followup
     where id = old.partner_id;
  end if;

  return null;
end $$;

create trigger partner_activities_sync_partner_denorm_trg
  after insert or update or delete on partner_activities
  for each row execute function partner_activities_sync_partner_denorm();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table partner_activities enable row level security;

create policy partner_activities_select on partner_activities for select
  using (org_id = public.user_org_id());

create policy partner_activities_insert on partner_activities for insert
  with check (
    org_id    = public.user_org_id()
    and logged_by = auth.uid()
  );

create policy partner_activities_update on partner_activities for update
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

create policy partner_activities_delete on partner_activities for delete
  using (
    org_id = public.user_org_id()
    and public.user_role() in ('manager', 'admin')
  );
