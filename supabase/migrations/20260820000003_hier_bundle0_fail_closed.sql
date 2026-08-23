-- 20260820000003_hier_bundle0_fail_closed.sql
--
-- PRD Addendum 6.12.A, Bundle 0 (P0). Reverses the fail-OPEN visibility default
-- (Decision D-15 / FR-HIER-49). Previously user_can_see_owner returned TRUE when
-- either the caller or the target had no reporting-hierarchy placement (NULL
-- role_path), so an unplaced user saw the whole organization and an unplaced
-- user's records were visible to everyone. That default is reversed here:
--
--   * A user with no placement sees only records they own.
--   * Records owned by an unplaced user are not visible to placed non-admins.
--   * Administrators are EXEMPT and keep full-organization visibility, so an
--     organization is never locked out of its own data. Admin is decided on the
--     7-level model (role_level = 'administrator'), per FR-HIER-42.
--
-- Also routes partner_activities visibility through the parent partner
-- (FR-HIER-52) via a new can_see_partner() helper. TODAY that helper is
-- org-scoped, because partners are still organization-wide (no owner until
-- Bundle 2), so this is behaviour-preserving for partner touches now. Bundle 2
-- tightens can_see_partner() to add owner/hierarchy scoping and every
-- partner-touch policy that calls it follows automatically.
--
-- No client change: the client already renders whatever the server returns.
-- Verified by supabase/tests/004_role_hierarchy_rls.sql (CI 'database' job).

-- ---------------------------------------------------------------------------
-- 1. caller_is_admin() — admin predicate on the seven-level model
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can read profiles.role_level from inside other
-- policies without recursing through profiles_select. role_level is NOT NULL
-- (backfilled in 20260722000002) and kept consistent with the legacy role, so
-- 'administrator' is the reliable admin signal. Missing profile -> false.
create or replace function public.caller_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role_level = 'administrator' from profiles where id = auth.uid()),
    false
  )
$$;

grant execute on function public.caller_is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. user_can_see_owner(p_owner) — now fails CLOSED
-- ---------------------------------------------------------------------------
-- Priority order:
--   1. Own row                       -> TRUE  (everyone sees their own, always)
--   2. Caller is an administrator    -> TRUE  (full-org visibility, never locked out)
--   3. Caller has NULL role_path     -> FALSE (unplaced non-admin: self only)
--   4. Target has NULL role_path     -> FALSE (unplaced owner: hidden from placed non-admins)
--   5. Target at/below caller ltree  -> TRUE
--   6. Otherwise                     -> FALSE
create or replace function public.user_can_see_owner(p_owner uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  with caller as (
    select public.caller_role_path() as p
  ),
  target as (
    select role_path as p from profiles where id = p_owner
  )
  select case
    when p_owner = auth.uid() then true
    when public.caller_is_admin() then true
    when (select p from caller) is null then false
    when (select p from target) is null then false
    else (select p from target) <@ (select p from caller)
  end
$$;

grant execute on function public.user_can_see_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. can_see_partner(p_partner) — parent-partner visibility helper (FR-HIER-52)
-- ---------------------------------------------------------------------------
-- Org-scoped today (partners are organization-wide until Bundle 2 gives them an
-- owner). Kept as its own function so Bundle 2 tightens the rule in ONE place
-- and every partner-touch policy that inherits from it follows.
create or replace function public.can_see_partner(p_partner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from partners
    where id = p_partner
      and org_id = public.user_org_id()
  )
$$;

grant execute on function public.can_see_partner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. partner_activities: inherit the parent partner's visibility (FR-HIER-52)
-- ---------------------------------------------------------------------------
-- Was org-wide (org_id = user_org_id()), the route by which any teammate could
-- read anyone's partner notes, transcripts and attachments. Now gated on
-- can_see_partner. Behaviour-preserving today (partners are org-wide), and
-- tightens automatically when Bundle 2 scopes partners. SELECT only here; the
-- owner-based write rule (FR-HIER-15) ships with Bundle 2.
drop policy if exists partner_activities_select on partner_activities;
create policy partner_activities_select on partner_activities for select
  using (
    org_id = public.user_org_id()
    and public.can_see_partner(partner_id)
  );
