-- deals: the core pipeline entity. Every rep-facing surface (Pipeline page,
-- Dashboard KPIs, Path map, Deal Detail) reads from here. Activities and
-- partner_links FK into it.
--
-- Schema mirrors the frontend `Deal` type in apps/app/src/features/pipeline
-- + the AddDealSheet form. Profession-specific fields (annual volume,
-- acceptance methods, etc.) live in profession_data JSONB rather than
-- nullable columns — we promote any field to a real column once we need to
-- index or filter on it.

create table deals (
  id                    uuid primary key default gen_random_uuid(),

  -- Tenancy. org_id is the RLS pivot; owner_id is the rep responsible.
  -- on delete restrict on owner_id: keep the deal if the rep leaves; a
  -- manager re-assigns. on delete cascade on org_id: deleting the tenant
  -- (admin-only operation outside RLS) takes its deals with it.
  org_id                uuid not null references organizations(id) on delete cascade,
  owner_id              uuid not null references profiles(id)      on delete restrict,

  -- Company
  company_name          text not null,
  address               text,
  industry              text,
  employee_count_range  text,

  -- Primary contact
  contact_name          text not null,
  contact_title         text,
  contact_email         text not null,
  contact_phone         text not null, -- E.164

  -- Deal economics + state
  value_cents           bigint   not null check (value_cents >= 0),
  stage                 deal_stage not null default 'new',
  probability           smallint not null default 20 check (probability between 0 and 100),
  expected_close        date,
  lead_source           text,
  notes                 text,

  -- Activity timestamps (denormalized for cheap list-page sorts/filters;
  -- authoritative source is the activities table, but a trigger there
  -- will keep these in sync once activities ships).
  last_activity_at      timestamptz,
  next_followup_at      timestamptz,

  -- Profession-specific bucket. Frontend writes/reads shape per profession.
  profession_data       jsonb not null default '{}'::jsonb,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- updated_at auto-bump. Re-usable helper — activities and partners will
-- want the same thing. Defined here because deals is the first table that
-- needs it; subsequent migrations can re-use without redefining.
create or replace function set_updated_at()
returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger deals_set_updated_at
  before update on deals
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Pipeline page filters by stage chips within the org: (org_id, stage).
-- "My deals" filter: (org_id, owner_id).
-- Upcoming followups query: (org_id, next_followup_at) — partial since
--   most deals at any given moment have NULL next_followup_at (won/lost).
-- Default sort on the list is updated_at desc.
create index deals_org_stage_idx       on deals (org_id, stage);
create index deals_org_owner_idx       on deals (org_id, owner_id);
create index deals_org_next_followup_idx
  on deals (org_id, next_followup_at)
  where next_followup_at is not null;
create index deals_org_updated_at_idx  on deals (org_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table deals enable row level security;

-- Everyone in the org sees every deal. Sales orgs share visibility for
-- coaching + pipeline reviews; if we ever need stricter, add a "visible_to"
-- column rather than narrowing this policy.
create policy deals_select on deals for select
  using (org_id = public.user_org_id());

-- Reps create deals they own. with-check forces owner_id = self so a rep
-- can't pre-assign a deal to a teammate at insert time. Managers can
-- assign-on-create by updating owner_id after insert.
create policy deals_insert on deals for insert
  with check (
    org_id   = public.user_org_id()
    and owner_id = auth.uid()
  );

-- Update rules:
--   reps      → only their own deals (owner_id = auth.uid())
--   managers  → any deal in the org
--   admins    → any deal in the org
-- with-check pins org_id to the user's org so you can't move a deal to
-- another tenant via UPDATE. Won deals stay editable (no stage lock).
create policy deals_update on deals for update
  using (
    org_id = public.user_org_id()
    and (
      public.user_role() in ('manager', 'admin')
      or owner_id = auth.uid()
    )
  )
  with check (
    org_id = public.user_org_id()
  );

-- Delete is destructive (loses history). Managers/admins only for now;
-- if reps need a "close lost / archive" path, that's a stage transition,
-- not a delete.
create policy deals_delete on deals for delete
  using (
    org_id = public.user_org_id()
    and public.user_role() in ('manager', 'admin')
  );
