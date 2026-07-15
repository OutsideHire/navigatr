-- Reporting hierarchy authoring (Dashboard Hierarchy, Slice 1).
--
-- The visibility machinery already exists (20260528000001 role_path ltree +
-- 20260529000001 user_can_see_owner + hierarchy-gated deals/activities/profiles
-- SELECT policies). It is dormant because every profile has role_path = NULL
-- (backward-compat → org-wide). This migration adds the AUTHORING input
-- (profiles.manager_id) and derives role_path from the manager chain, so that
-- populating the org chart activates per-role scoping app-wide.
--
-- Model (beta: admin / manager / rep; extends to 7 layers via deeper chains):
--   * admin            → role_path NULL  (sees whole org via the NULL-caller
--                        fallback; never placed in the tree, so "owner sees
--                        everything" holds regardless of how many subtrees).
--   * non-admin root   → role_path = own label (manager_id null, or manager is
--                        an admin/owner with NULL path).
--   * non-admin child  → role_path = manager.role_path || own label.

-- 1) manager_id: the "reports to" authoring input.
alter table profiles
  add column manager_id uuid references profiles(id) on delete set null;
create index profiles_manager_id_idx on profiles (manager_id);

-- 2) Stable ltree label for a profile id (hyphens are illegal in labels;
--    the 'u' prefix keeps it a valid label). e.g. u3f2a1b...
create or replace function public.profile_role_label(p_id uuid)
returns ltree language sql immutable as $$
  select ('u' || replace(p_id::text, '-', ''))::ltree
$$;

-- 3) Rebuild role_path for a member AND all transitive reports, top-down.
--    Recomputes the root from its CURRENT manager, then cascades using the
--    freshly-computed parent paths. Admins resolve to NULL at every node.
create or replace function public.rebuild_role_path_subtree(p_root uuid)
returns void language sql as $$
  with recursive tree as (
    select m.id,
           case
             when m.role = 'admin' then null::ltree
             when parent.role_path is null then public.profile_role_label(m.id)
             else parent.role_path || public.profile_role_label(m.id)
           end as new_path
    from profiles m
    left join profiles parent on parent.id = m.manager_id
    where m.id = p_root
    union all
    select c.id,
           case
             when c.role = 'admin' then null::ltree
             when t.new_path is null then public.profile_role_label(c.id)
             else t.new_path || public.profile_role_label(c.id)
           end
    from profiles c
    join tree t on c.manager_id = t.id
  )
  update profiles p set role_path = tree.new_path
  from tree where tree.id = p.id;
$$;

-- 4) admin_set_manager: set a member's manager, then rebuild their subtree's
--    paths. Admin-only, org-scoped, cycle-safe. Mirrors admin_set_role.
create or replace function admin_set_manager(p_member uuid, p_manager uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
  v_member_role user_role;
  v_is_cycle boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select p.org_id, p.role into v_org_id, v_caller
    from profiles p where p.id = auth.uid() and p.deactivated_at is null;
  if v_org_id is null or v_caller <> 'admin' then
    raise exception 'forbidden';
  end if;

  select p.role into v_member_role
    from profiles p
   where p.id = p_member and p.org_id = v_org_id and p.deactivated_at is null;
  if v_member_role is null then raise exception 'member_not_found'; end if;
  if v_member_role = 'admin' then raise exception 'cannot_place_admin'; end if;

  if p_manager is not null then
    if p_manager = p_member then raise exception 'cannot_report_to_self'; end if;
    if not exists (
      select 1 from profiles p
       where p.id = p_manager and p.org_id = v_org_id and p.deactivated_at is null
    ) then raise exception 'manager_not_found'; end if;

    -- Cycle guard: the proposed manager must not currently report (transitively)
    -- to the member.
    with recursive up as (
      select p_manager as id
      union all
      select pr.manager_id from profiles pr join up on pr.id = up.id
      where pr.manager_id is not null
    )
    select exists (select 1 from up where id = p_member) into v_is_cycle;
    if v_is_cycle then raise exception 'cycle_detected'; end if;
  end if;

  update profiles set manager_id = p_manager where id = p_member and org_id = v_org_id;
  -- Rebuild from the MANAGER, not just the member: the manager may not have
  -- been rooted yet (no role_path). Rebuilding the manager's subtree roots the
  -- manager (own label) AND recomputes every descendant — including the
  -- newly-attached member — so assigning reps actually scopes the manager.
  -- When unassigning (no manager), rebuild the member's own subtree so it
  -- re-roots cleanly.
  if p_manager is not null then
    perform public.rebuild_role_path_subtree(p_manager);
  else
    perform public.rebuild_role_path_subtree(p_member);
  end if;
end $$;

grant execute on function admin_set_manager(uuid, uuid) to authenticated;

-- 5) team_leaderboard: add manager_id to the roster so the admin UI can show
--    and set each member's current manager. Return-type change requires DROP.
--
-- Reconciled with the current definition (20260524000002_deal_stage_lost.sql).
-- Preserves EVERY existing column (including lost_deals_window,
-- lost_cents_window, and the open-deals `stage not in ('won','lost')` filter)
-- and inserts manager_id after status (the position LeaderboardRow expects).
drop function if exists team_leaderboard(int);
create or replace function team_leaderboard(p_window_days int default 30)
returns table (
  agent_id            uuid,
  full_name           text,
  email               text,
  role                user_role,
  status              text,           -- 'active' | 'revoked' | 'invited'
  manager_id          uuid,
  open_deals          int,
  pipeline_cents      bigint,
  won_deals_window    int,
  won_cents_window    bigint,
  lost_deals_window   int,
  lost_cents_window   bigint,
  activities_window   int,
  last_activity       timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
  v_window int;
begin
  -- authz: must be authenticated
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select p.org_id, p.role
    into v_org_id, v_caller
    from profiles p
   where p.id = auth.uid()
     and p.deactivated_at is null;

  if v_org_id is null or v_caller not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  -- clamp window: null / ≤ 0 → 30; >365 → 365
  v_window := case
    when p_window_days is null or p_window_days <= 0 then 30
    when p_window_days > 365 then 365
    else p_window_days
  end;

  return query
  with

  -- one scan of deals for this org; filter expressions are pushed into
  -- aggregate filters so the planner reads the table once
  deal_aggs as (
    select
      d.owner_id,
      count(*)        filter (where d.stage not in ('won', 'lost'))                                                as open_count,
      coalesce(
        sum(d.value_cents) filter (where d.stage not in ('won', 'lost')),
        0
      )::bigint                                                                                                    as open_value,
      count(*)        filter (where d.stage = 'won'
                                and d.updated_at >= now() - (v_window || ' days')::interval)                      as won_count,
      coalesce(
        sum(d.value_cents) filter (where d.stage = 'won'
                                     and d.updated_at >= now() - (v_window || ' days')::interval),
        0
      )::bigint                                                                                                    as won_value,
      count(*)        filter (where d.stage = 'lost'
                                and d.updated_at >= now() - (v_window || ' days')::interval)                      as lost_count,
      coalesce(
        sum(d.value_cents) filter (where d.stage = 'lost'
                                     and d.updated_at >= now() - (v_window || ' days')::interval),
        0
      )::bigint                                                                                                    as lost_value
    from deals d
    where d.org_id = v_org_id
    group by d.owner_id
  ),

  -- one scan of activities for this org
  activity_aggs as (
    select
      a.logged_by,
      count(*) filter (where a.occurred_at >= now() - (v_window || ' days')::interval) as act_count,
      max(a.occurred_at)                                                                as last_act
    from activities a
    where a.org_id = v_org_id
    group by a.logged_by
  )

  -- active + deactivated (revoked) profiles
  select
    p.id,
    p.full_name,
    p.email,
    p.role,
    case when p.deactivated_at is not null then 'revoked' else 'active' end :: text,
    p.manager_id,
    coalesce(da.open_count,  0)::int,
    coalesce(da.open_value,  0)::bigint,
    coalesce(da.won_count,   0)::int,
    coalesce(da.won_value,   0)::bigint,
    coalesce(da.lost_count,  0)::int,
    coalesce(da.lost_value,  0)::bigint,
    coalesce(aa.act_count,   0)::int,
    aa.last_act
  from profiles p
  left join deal_aggs     da on da.owner_id  = p.id
  left join activity_aggs aa on aa.logged_by = p.id
  where p.org_id = v_org_id

  union all

  -- pending invites — no deal/activity data; last_activity = invite created_at
  -- so the column is non-null and the frontend can sort without special-casing
  select
    oi.id,
    oi.full_name,
    oi.email,
    oi.role,
    'invited'::text,
    null::uuid,
    0::int,
    0::bigint,
    0::int,
    0::bigint,
    0::int,
    0::bigint,
    0::int,
    oi.created_at
  from org_invites oi
  where oi.org_id    = v_org_id
    and oi.accepted_at is null
    and oi.revoked_at  is null;

end $$;

grant execute on function team_leaderboard(int) to authenticated;

-- 6) admin_set_role: re-derive role_path when a role changes.
--    role_path derivation is now role-dependent (admin => NULL / org-wide;
--    non-admin => derived from the manager chain). The prior admin_set_role
--    (20260625000002) did NOT touch role_path — so promoting a manager to
--    admin would leave a stale non-NULL path (wrongly scoped instead of
--    org-wide), and demoting an admin would leave NULL (wrongly org-wide
--    instead of scoped). Recreate it to rebuild the member's subtree after the
--    role change so the invariant holds. Body is otherwise identical to
--    20260625000002_admin_set_role.sql.
create or replace function admin_set_role(p_profile_id uuid, p_new_role user_role)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
  v_target_role user_role;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select p.org_id, p.role into v_org_id, v_caller
    from profiles p
   where p.id = auth.uid() and p.deactivated_at is null;
  if v_org_id is null or v_caller <> 'admin' then
    raise exception 'forbidden';
  end if;

  if p_profile_id = auth.uid() then
    raise exception 'cannot_change_own_role';
  end if;

  select p.role into v_target_role
    from profiles p
   where p.id = p_profile_id and p.org_id = v_org_id and p.deactivated_at is null;
  if v_target_role is null then
    raise exception 'profile_not_found';
  end if;

  if v_target_role = 'admin' and p_new_role <> 'admin'
     and (select count(*) from profiles
            where org_id = v_org_id and role = 'admin' and deactivated_at is null) <= 1 then
    raise exception 'cannot_demote_sole_admin';
  end if;

  update profiles set role = p_new_role where id = p_profile_id and org_id = v_org_id;

  -- Re-derive role_path for the member + all reports (admin<=>NULL flip, and a
  -- demoted admin becomes a subtree root whose reports nest under them).
  perform public.rebuild_role_path_subtree(p_profile_id);
end $$;

grant execute on function admin_set_role(uuid, user_role) to authenticated;
