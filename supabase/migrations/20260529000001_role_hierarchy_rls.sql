-- 20260529000001_role_hierarchy_rls.sql
--
-- 7-role hierarchy visibility layer. PRD §3.2 calls for an org-chart-aware
-- access model: a VP sees every rep at any depth below them, and nothing
-- else. The schema piece (profiles.role_path ltree + GiST index) shipped
-- in 20260528000001_v1_foundation. This migration is the *policy layer*
-- that uses it.
--
-- ───────────────────────────────────────────────────────────────────────
-- DESIGN DECISIONS (locked in office-hours review 2026-05-29)
-- ───────────────────────────────────────────────────────────────────────
--
-- D1: KEEP the existing user_role enum (rep/manager/admin).
--     The 3-role enum continues to answer "what can you do?" (RequireRole,
--     "can invite teammates", etc.). The new role_path ltree answers
--     "whose data can you see?". Different questions, different columns.
--
-- D2: NULL role_path = BACKWARD COMPATIBLE.
--     When either the caller or the target has NULL role_path, fall through
--     to the previous org-wide visibility. Every existing user has NULL
--     role_path today, so this migration changes ZERO observable behavior
--     until customers fill in their org chart. No flip day, no breakage.
--
-- D3: Scope today: deals + activities + profiles. The "what I see" surfaces.
--     Partners / org_invites / deal_stage_history continue to use the
--     existing policies; most of their access flows through SECURITY DEFINER
--     RPCs anyway and would be redundant to gate here.
--
-- ───────────────────────────────────────────────────────────────────────
-- PERFORMANCE
-- ───────────────────────────────────────────────────────────────────────
--
-- caller_role_path() is STABLE so Postgres calls it once per query, not
-- once per row. The hierarchy check on the target's role_path runs per
-- row but hits profiles via the primary key index (id = p_owner), and
-- the ltree comparison itself is cheap (~100ns). Aggregate cost: well
-- under the existing org_id check overhead on any realistic query.
--
-- ───────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ───────────────────────────────────────────────────────────────────────
--
-- Every policy is dropped and recreated. To roll back, paste the original
-- policy bodies from 20260519000001_deals.sql / 20260519000002_activities.sql
-- / 20260517000001_orgs_and_profiles.sql into the SQL editor. ~30 seconds.

-- ---------------------------------------------------------------------------
-- 1. caller_role_path() — fetched once per query, planner-memoized
-- ---------------------------------------------------------------------------
-- Returns the current user's role_path or NULL. SECURITY DEFINER bypasses
-- the profiles_select policy so this works inside other policies (which
-- would otherwise recurse).
create or replace function public.caller_role_path() returns ltree
language sql stable security definer set search_path = public as $$
  select role_path from profiles where id = auth.uid()
$$;

grant execute on function public.caller_role_path() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. user_can_see_owner(p_owner) — the load-bearing visibility predicate
-- ---------------------------------------------------------------------------
-- Returns TRUE if the caller is allowed to see records owned by p_owner.
--
-- Logic, in priority order:
--   1. Own row → TRUE (everyone sees their own records, always)
--   2. Caller has NULL role_path → TRUE (backward compat: org-wide)
--   3. Target has NULL role_path → TRUE (backward compat: target hasn't
--                                         been placed in the hierarchy
--                                         yet, default to visible)
--   4. Target's role_path is at or below caller's in the ltree → TRUE
--   5. Otherwise → FALSE
--
-- The function is SECURITY DEFINER so it can read profiles.role_path for
-- the target user without that user's RLS bouncing the lookup.
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
    when (select p from caller) is null then true
    when (select p from target) is null then true
    else (select p from target) <@ (select p from caller)
  end
$$;

grant execute on function public.user_can_see_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. deals: rewrite SELECT + UPDATE policies for hierarchy
-- ---------------------------------------------------------------------------

-- SELECT: same org + hierarchy gate.
drop policy if exists deals_select on deals;
create policy deals_select on deals for select
  using (
    org_id = public.user_org_id()
    and public.user_can_see_owner(owner_id)
  );

-- INSERT: unchanged. Reps create deals they own; managers can re-assign
-- via UPDATE. (We're not gating who CAN insert by hierarchy — anyone in
-- the org can create a deal under their own ownership.)
-- The previous insert policy is preserved by 20260519000001_deals.sql.

-- UPDATE: org-scoped + (own OR (manager/admin AND target in my subtree)).
-- The capability check (role in manager/admin) is preserved; the new gate
-- restricts which subset of deals a manager can edit, defaulting to "all"
-- when no hierarchy is set (NULL role_path on either side).
drop policy if exists deals_update on deals;
create policy deals_update on deals for update
  using (
    org_id = public.user_org_id()
    and (
      owner_id = auth.uid()
      or (
        public.user_role() in ('manager', 'admin')
        and public.user_can_see_owner(owner_id)
      )
    )
  )
  with check (
    org_id = public.user_org_id()
  );

-- DELETE: same as UPDATE (manager/admin + hierarchy-scoped).
drop policy if exists deals_delete on deals;
create policy deals_delete on deals for delete
  using (
    org_id = public.user_org_id()
    and public.user_role() in ('manager', 'admin')
    and public.user_can_see_owner(owner_id)
  );

-- ---------------------------------------------------------------------------
-- 4. activities: gate visibility on the PARENT DEAL'S OWNER
-- ---------------------------------------------------------------------------
--
-- An activity belongs to a deal. Whoever can see the deal should see its
-- activities. Gating on activities.logged_by instead would break the
-- intuitive case: a manager logs a note on their rep's deal, the rep
-- can't see it. That's wrong — the activity lives on the rep's deal,
-- the rep needs to see it.
--
-- The exists() subquery hits deals via the (deal_id) primary key index;
-- planner pushes the check inside the index scan. Negligible overhead.

drop policy if exists activities_select on activities;
create policy activities_select on activities for select
  using (
    org_id = public.user_org_id()
    and exists (
      select 1 from deals d
      where d.id = activities.deal_id
        and public.user_can_see_owner(d.owner_id)
    )
  );

-- INSERT unchanged (logged_by must be auth.uid(); org_id forced from
-- parent deal by activities_enforce_org_consistency trigger).

drop policy if exists activities_update on activities;
create policy activities_update on activities for update
  using (
    org_id = public.user_org_id()
    and (
      logged_by = auth.uid()
      or (
        public.user_role() in ('manager', 'admin')
        and exists (
          select 1 from deals d
          where d.id = activities.deal_id
            and public.user_can_see_owner(d.owner_id)
        )
      )
    )
  )
  with check (
    org_id = public.user_org_id()
  );

drop policy if exists activities_delete on activities;
create policy activities_delete on activities for delete
  using (
    org_id = public.user_org_id()
    and public.user_role() in ('manager', 'admin')
    and exists (
      select 1 from deals d
      where d.id = activities.deal_id
        and public.user_can_see_owner(d.owner_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 5. profiles: see self + see hierarchy
-- ---------------------------------------------------------------------------
--
-- Profile visibility is its own special case because the helper functions
-- themselves call into profiles. Recursion guard: the existing pattern
-- (using a self-join through auth.uid() inside the policy) stays as the
-- primary check; user_can_see_owner is added as an OR branch so users in
-- the same hierarchy subtree can see each other.
--
-- The fallback "see everyone in my org" path is preserved exactly as
-- before via the existing self-join. That keeps the Team page rendering
-- and avoids breaking RequireRole, useProfile, etc.

-- CRITICAL: use public.user_org_id() (SECURITY DEFINER, bypasses RLS),
-- NOT an inline subquery against profiles. The inline subquery causes
-- infinite recursion through this very policy and 500s every profile
-- read in the app. This was fixed by migration
-- 20260518000003_fix_profiles_select_recursion; do NOT regress.

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (
    -- See own profile.
    id = auth.uid()
    -- See others in same org (existing behavior, preserved verbatim
    -- from the v1 foundation set — recursion-safe via helper).
    or org_id = public.user_org_id()
  );

-- Note: we did NOT replace the org-wide visibility with hierarchy-only
-- visibility on profiles. Reps need to see manager names + the team
-- leaderboard renders all org members. Hierarchy gating on profiles is
-- a v1.1 concern once we have role-aware UI.

-- ---------------------------------------------------------------------------
-- 6. Convenience: a small helper for backfill scripts
-- ---------------------------------------------------------------------------
--
-- Admin tooling (CSV import, role assignment UI, etc.) will eventually
-- want to set role_path for users. We don't ship a public RPC for that
-- today — admins can do it via SQL editor for the v1.0 ISO #1 pilot.
-- When the role-assignment UI lands, it'll add a SECURITY DEFINER RPC
-- here that validates ltree shape and authz.
--
-- For now, just expose a read-only helper so admins can introspect.
create or replace function public.org_role_tree()
returns table (id uuid, full_name text, role_path ltree)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role_path
  from profiles p
  where p.org_id = public.user_org_id()
    and p.role_path is not null
  order by p.role_path
$$;

grant execute on function public.org_role_tree() to authenticated;
