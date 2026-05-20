-- partners + partner_deals: referral source tracking.
--
-- Partners are CPAs, bankers, attorneys, insurance agents, and consultants
-- who feed leads into the rep's pipeline. The frontend exposes:
--   * /partners list (sortable by revenue, name, recency)
--   * /partners/:id detail (deals referred, last touch, notes)
--   * AddPartnerSheet (create new)
--
-- partner_deals is the many-to-many link. One deal can have multiple
-- referring partners (rare — typically split-credit); one partner refers
-- many deals (common). Storing attribution as a link table beats a
-- partners.attributed_deal_ids array because it lets us add per-link
-- metadata later (e.g. attributed_at, credit_share) without a migration.

create type partner_status as enum ('active', 'cooling', 'inactive');

create table partners (
  id              uuid primary key default gen_random_uuid(),

  -- Tenancy + audit.
  org_id          uuid not null references organizations(id) on delete cascade,
  created_by      uuid not null references profiles(id)      on delete restrict,

  name            text not null,
  company         text not null,
  type            partner_type not null,
  status          partner_status not null default 'active',

  -- Contact. E.164 phone is the contract (matches deals.contact_phone).
  phone           text,
  email           text,

  -- Free-text city for Sprint 1; the AddPartnerSheet captures it as-is.
  -- Sprint 2: structured address + geocode for the Path map.
  city            text,

  -- Denorm "last touch" + "next followup" timestamps. Rep maintains them
  -- via UPDATE for now; a Sprint-2 partner_activities table can drive
  -- them via trigger (same pattern as deals + activities).
  last_touch_at      timestamptz,
  next_followup_at   timestamptz,

  notes           text not null default '',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger partners_set_updated_at
  before update on partners
  for each row execute function set_updated_at();

-- Indexes
-- Org list page, default sort by recency.
create index partners_org_updated_at_idx on partners (org_id, updated_at desc);
-- Filter by status (active / cooling / inactive chips on the list page).
create index partners_org_status_idx     on partners (org_id, status);
-- Filter by type (cpa / banker / attorney chips on the list page).
create index partners_org_type_idx       on partners (org_id, type);

-- ---------------------------------------------------------------------------
-- partner_deals: many-to-many link.
-- ---------------------------------------------------------------------------
create table partner_deals (
  partner_id      uuid not null references partners(id) on delete cascade,
  deal_id         uuid not null references deals(id)    on delete cascade,

  -- Denormalized org_id — same RLS argument as activities. One column
  -- lookup beats a 2-table join on every row check. Trigger below
  -- enforces consistency with the parent partner.
  org_id          uuid not null references organizations(id) on delete cascade,

  -- When the rep attributed the deal to this partner.
  attributed_at   timestamptz not null default now(),
  attributed_by   uuid references profiles(id) on delete set null,

  -- Free-text. Sprint 2 may carry credit_share (decimal) once we wire
  -- partner revenue reporting; for now reps can describe in notes.
  notes           text not null default '',

  primary key (partner_id, deal_id)
);

create index partner_deals_org_idx          on partner_deals (org_id);
create index partner_deals_partner_idx      on partner_deals (partner_id);
create index partner_deals_deal_idx         on partner_deals (deal_id);

-- Consistency trigger: org_id on link MUST mirror the partner's org_id.
-- Same argument as activities — without this, a malicious caller could
-- insert a link with mismatched org_id and bypass RLS isolation.
create or replace function partner_deals_enforce_org_consistency()
returns trigger
language plpgsql as $$
declare
  v_partner_org uuid;
  v_deal_org    uuid;
begin
  select p.org_id into v_partner_org from partners p where p.id = new.partner_id;
  if v_partner_org is null then
    raise exception 'partner_deals references non-existent partner';
  end if;
  select d.org_id into v_deal_org from deals d where d.id = new.deal_id;
  if v_deal_org is null then
    raise exception 'partner_deals references non-existent deal';
  end if;
  -- Cross-org attribution is a real bug class. The frontend should never
  -- do it (RLS would deny the partner select), but enforce here so even
  -- a buggy backend script can't create one.
  if v_partner_org <> v_deal_org then
    raise exception 'cross-tenant attribution: partner.org_id != deal.org_id';
  end if;
  new.org_id := v_partner_org;
  return new;
end $$;

create trigger partner_deals_enforce_org_consistency_trg
  before insert or update on partner_deals
  for each row execute function partner_deals_enforce_org_consistency();

-- ---------------------------------------------------------------------------
-- RLS — partners
-- ---------------------------------------------------------------------------
alter table partners enable row level security;

create policy partners_select on partners for select
  using (org_id = public.user_org_id());

create policy partners_insert on partners for insert
  with check (
    org_id     = public.user_org_id()
    and created_by = auth.uid()
  );

create policy partners_update on partners for update
  using (
    org_id = public.user_org_id()
    and (
      public.user_role() in ('manager', 'admin')
      or created_by = auth.uid()
    )
  )
  with check (
    org_id = public.user_org_id()
  );

create policy partners_delete on partners for delete
  using (
    org_id = public.user_org_id()
    and public.user_role() in ('manager', 'admin')
  );

-- ---------------------------------------------------------------------------
-- RLS — partner_deals
-- ---------------------------------------------------------------------------
alter table partner_deals enable row level security;

-- SELECT: any org member sees any link in the org. Same coaching/visibility
-- argument as deals + activities.
create policy partner_deals_select on partner_deals for select
  using (org_id = public.user_org_id());

-- INSERT: with-check pins org_id; the consistency trigger overwrites
-- anyway. attributed_by may be null (system attribution from import).
create policy partner_deals_insert on partner_deals for insert
  with check (org_id = public.user_org_id());

-- UPDATE: managers/admins can re-attribute (rare). Reps can edit links
-- they created if attributed_by matches them.
create policy partner_deals_update on partner_deals for update
  using (
    org_id = public.user_org_id()
    and (
      public.user_role() in ('manager', 'admin')
      or attributed_by = auth.uid()
    )
  )
  with check (
    org_id = public.user_org_id()
  );

-- DELETE: managers/admins only — attribution is part of the audit trail.
create policy partner_deals_delete on partner_deals for delete
  using (
    org_id = public.user_org_id()
    and public.user_role() in ('manager', 'admin')
  );
