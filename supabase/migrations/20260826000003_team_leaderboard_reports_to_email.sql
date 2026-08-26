-- Org chart: nest bulk-CSV-imported teams BEFORE everyone accepts.
--
-- Problem: after an admin bulk-imports "a manager + their reps" in one CSV,
-- the Team org chart shows the whole team FLAT until each person accepts.
-- Why: org_invites.manager_id is only set when the manager is already an
-- active profile; when the manager is ALSO a pending invite (same file), the
-- reporting line lives on org_invites.reports_to_email and manager_id stays
-- null (resolved to a real id only at accept, per 20260825000004). The org
-- chart links solely on manager_id, so those pending rows have no parent and
-- render as roots -> the admin's "did my structure import?" check looks broken.
--
-- Fix (additive, WHERE-clause unchanged): expose reports_to_email as a new
-- return column so the frontend org-tree builder can fall back to matching a
-- pending row to its manager by email when manager_id doesn't resolve. It is
-- emitted ONLY WHEN manager_id IS NULL -- i.e. exactly (and only) when the
-- id edge is unresolved and the email fallback is actually needed (a pending
-- invite whose manager is also pending, or a rep who accepted before their
-- manager). Once a real manager_id is known, that id points at a node already
-- visible to the caller, so the email is redundant AND must be suppressed:
-- profiles.reports_to_email is stamped once at accept and is NOT kept in sync
-- by admin_set_manager, so a re-parented row's stale reports_to_email could
-- otherwise reveal a manager email from OUTSIDE the caller's reporting subtree.
-- Gating on manager_id IS NULL keeps the promise that visibility is not widened
-- (fully-accepted orgs, where claim_invite_code has backfilled manager_id, emit
-- null here and are byte-for-byte unaffected).
--
-- Row-level visibility is also unchanged: a pending-under-pending invite
-- (manager_id null) is still only listed to admins / unplaced callers, exactly
-- as before. A manager-scoped caller seeing such invites is a separate concern.

drop function if exists team_leaderboard(int);
create or replace function team_leaderboard(p_window_days int default 30)
returns table (
  agent_id            uuid,
  full_name           text,
  email               text,
  role                public.user_role,
  role_level          public.role_level,
  status              text,           -- 'active' | 'revoked' | 'invited'
  manager_id          uuid,
  reports_to_email    text,           -- deferred reporting line (email) for unresolved manager_id
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
  v_caller public.user_role;
  v_window int;
begin
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

  v_window := case
    when p_window_days is null or p_window_days <= 0 then 30
    when p_window_days > 365 then 365
    else p_window_days
  end;

  return query
  with

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

  activity_aggs as (
    select
      a.logged_by,
      count(*) filter (where a.occurred_at >= now() - (v_window || ' days')::interval) as act_count,
      max(a.occurred_at)                                                                as last_act
    from activities a
    where a.org_id = v_org_id
    group by a.logged_by
  )

  select
    p.id,
    p.full_name,
    p.email,
    p.role,
    p.role_level,
    case when p.deactivated_at is not null then 'revoked' else 'active' end :: text,
    p.manager_id,
    case when p.manager_id is null then p.reports_to_email end,
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
    and public.user_can_see_owner(p.id)

  union all

  select
    oi.id,
    oi.full_name,
    oi.email,
    oi.role,
    oi.role_level,
    'invited'::text,
    oi.manager_id,
    case when oi.manager_id is null then oi.reports_to_email end,
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
    and oi.revoked_at  is null
    and (
      public.caller_role_path() is null
      or (oi.manager_id is not null and public.user_can_see_owner(oi.manager_id))
    );

end $$;

grant execute on function team_leaderboard(int) to authenticated;
