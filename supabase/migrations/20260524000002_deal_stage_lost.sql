-- 20260524000002_deal_stage_lost.sql
--
-- Part 1: extends the deal_stage enum with a terminal 'lost' value
--         parallel to the existing 'won' value.
-- Part 2: re-creates team_leaderboard to:
--           * exclude 'lost' deals from open_deals / pipeline_cents
--           * add lost_deals_window / lost_cents_window rollup columns
--
-- NOTE: Run this file in TWO statements in Supabase Studio:
--   1. The ALTER TYPE statement on its own.
--   2. The CREATE OR REPLACE FUNCTION block.
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as a
-- subsequent statement that references the new value.

-- ---------------------------------------------------------------------------
-- Part 1 — extend the enum
-- ---------------------------------------------------------------------------

-- Add 'lost' as a terminal closed-out stage parallel to 'won'.
-- Existing reports/triggers that check `stage = 'won'` continue to work
-- without modification; queries that lump everything-except-'won' as
-- "active" (e.g. the team_leaderboard RPC below, kanban filters, KPI
-- cards) must be updated to also exclude 'lost'.
alter type deal_stage add value if not exists 'lost';

-- ---------------------------------------------------------------------------
-- Part 2 — update team_leaderboard RPC
-- (apply only after the ALTER TYPE above has committed)
-- ---------------------------------------------------------------------------

-- team_leaderboard(p_window_days int default 30)
--
-- Returns per-agent rollup columns:
--   open_deals / pipeline_cents         — deals in non-won, non-lost stages, all time
--   won_deals_window / won_cents_window — deals marked won inside the window
--   lost_deals_window / lost_cents_window — deals marked lost inside the window
--   activities_window                   — activities logged inside the window
--   last_activity                       — max(occurred_at) over all time; null if none
--
-- DROP first: adding columns to RETURNS TABLE counts as a return-type
-- change, which CREATE OR REPLACE FUNCTION refuses (SQLSTATE 42P13).
drop function if exists team_leaderboard(int);

create or replace function team_leaderboard(p_window_days int default 30)
returns table (
  agent_id            uuid,
  full_name           text,
  email               text,
  role                user_role,
  status              text,           -- 'active' | 'revoked' | 'invited'
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
