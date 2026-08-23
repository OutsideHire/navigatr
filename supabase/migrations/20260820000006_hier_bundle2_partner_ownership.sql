-- 20260820000006_hier_bundle2_partner_ownership.sql
--
-- PRD Addendum 6.12.A, Bundle 2 (P0). Gives partners an OWNER and scopes them
-- to the reporting hierarchy, the same rule deals already follow. Closes the
-- partner items deferred from Bundle 0:
--   FR-HIER-15  owner-based partner writes (edit/delete follow the owner +
--               management chain, not the legacy rep/manager/admin role).
--   FR-HIER-52  partner touches (partner_activities) inherit the parent
--               partner's visibility.
--   FR-HIER-54  partner-touch peer isolation: a rep's partner touches are not
--               visible to a peer in a sibling subtree.
--
-- Decision (user, 2026-08-23): partners are HIERARCHY-scoped, not org-shared.
-- You see a partner if you own it or its owner is at/below you in the tree;
-- administrators keep full-org visibility (via user_can_see_owner).
--
-- Migrations are free here: only the founders exist, no real partner data yet.
-- Existing partners (incl. demo rows) are backfilled owner_id = created_by.

-- ---------------------------------------------------------------------------
-- 1. partners.owner_id — the responsible rep (mirrors deals.owner_id)
-- ---------------------------------------------------------------------------
alter table partners
  add column if not exists owner_id uuid references profiles(id) on delete restrict;

-- Backfill from the audit creator, then lock NOT NULL.
update partners set owner_id = created_by where owner_id is null;
alter table partners alter column owner_id set not null;

-- Hierarchy visibility walks (org_id, owner_id), same access shape as deals.
create index if not exists partners_org_owner_idx on partners (org_id, owner_id);

-- Safety net: default owner_id to created_by on any insert that omits it, so
-- every existing insert path (notably the demo-reset function, whose large
-- body predates this column) keeps working without a rewrite. The client
-- stamps owner_id explicitly; this only fills the gap. Runs BEFORE the NOT NULL
-- check, and created_by is itself NOT NULL, so owner_id always ends up set.
create or replace function public.partners_default_owner()
returns trigger language plpgsql as $$
begin
  if new.owner_id is null then
    new.owner_id := new.created_by;
  end if;
  return new;
end $$;

drop trigger if exists partners_default_owner_trg on partners;
create trigger partners_default_owner_trg
  before insert on partners
  for each row execute function public.partners_default_owner();

-- ---------------------------------------------------------------------------
-- 2. partners RLS — read scoped to hierarchy; writes owner-based (FR-HIER-15)
-- ---------------------------------------------------------------------------
-- SELECT: own + subtree (+ admin exempt), exactly like deals_select.
drop policy if exists partners_select on partners;
create policy partners_select on partners for select
  using (
    org_id = public.user_org_id()
    and public.user_can_see_owner(owner_id)
  );

-- UPDATE: the owner, anyone above the owner in the tree, or an admin. No longer
-- keyed on the legacy rep/manager/admin role (FR-HIER-15). with-check pins the
-- org; owner reassignment control is a later bundle.
drop policy if exists partners_update on partners;
create policy partners_update on partners for update
  using (
    org_id = public.user_org_id()
    and public.user_can_see_owner(owner_id)
  )
  with check (org_id = public.user_org_id());

-- DELETE: same owner-based rule (was manager/admin only).
drop policy if exists partners_delete on partners;
create policy partners_delete on partners for delete
  using (
    org_id = public.user_org_id()
    and public.user_can_see_owner(owner_id)
  );

-- ---------------------------------------------------------------------------
-- 3. can_see_partner() — tighten from org-wide to hierarchy (FR-HIER-52/54)
-- ---------------------------------------------------------------------------
-- Bundle 0 introduced this helper org-scoped (partners had no owner yet) and
-- routed partner_activities_select through it. Now that partners have an owner,
-- tightening it HERE automatically scopes every partner-touch policy that calls
-- it. SECURITY DEFINER so the inner partners read bypasses partners RLS (no
-- policy recursion); auth.uid() still resolves to the caller inside a definer.
create or replace function public.can_see_partner(p_partner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from partners
    where id = p_partner
      and org_id = public.user_org_id()
      and public.user_can_see_owner(owner_id)
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. partner_activities writes — inherit partner visibility (FR-HIER-15/54)
-- ---------------------------------------------------------------------------
-- SELECT already routes through can_see_partner (Bundle 0) and so tightened in
-- step 3. Here the write policies stop keying on the legacy role and instead
-- require that the caller can see the parent partner, so a rep can only log /
-- edit / delete touches on partners within their own hierarchy, and a peer in a
-- sibling subtree can do none of the three.
drop policy if exists partner_activities_insert on partner_activities;
create policy partner_activities_insert on partner_activities for insert
  with check (
    org_id = public.user_org_id()
    and logged_by = auth.uid()
    and public.can_see_partner(partner_id)
  );

drop policy if exists partner_activities_update on partner_activities;
create policy partner_activities_update on partner_activities for update
  using (
    org_id = public.user_org_id()
    and public.can_see_partner(partner_id)
  )
  with check (
    org_id = public.user_org_id()
    and public.can_see_partner(partner_id)
  );

drop policy if exists partner_activities_delete on partner_activities;
create policy partner_activities_delete on partner_activities for delete
  using (
    org_id = public.user_org_id()
    and public.can_see_partner(partner_id)
  );
