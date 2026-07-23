-- Scope team_leaderboard to the caller's reporting subtree.
-- Reuses public.user_can_see_owner (role_path ltree). Admins (NULL role_path)
-- keep full-org visibility via the predicate's NULL-caller fallback. A manager
-- with a role_path sees self + descendants only. Pending invites are scoped by
-- the visibility of their assigned manager; admins/unplaced callers see all
-- invites. Signature and return columns are unchanged (WHERE-clause only), so
-- the frontend contract is unchanged.
-- Apply: paste this whole file into the Supabase SQL editor.

drop function if exists team_leaderboard(int);
create or replace function team_leaderboard(p_window_days int default 30)
returns table (
  agent_id            uuid,
  full_name           text,
  email               text,
  role                user_role,
  role_level          role_level,
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
