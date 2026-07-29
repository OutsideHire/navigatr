-- 20260729000002_demo_persistence_history.sql
--
-- SP-2: give the demo org a full-looking Persistence Index. The report's trend
-- line, per-rep sparklines and 30-day deltas are recomputed live from
-- activities, and the benchmark lines come from persistence_company_snapshot.
-- The base demo seed only spans ~2 weeks of activity, so all of those look thin.
--
-- This backfills ~180 days of synthetic activity on the demo's active deals
-- (cadence tightening toward today so the trend drifts upward, per the SP-2
-- decision), and seeds a rising company-average / top-decile snapshot series so
-- the benchmark lines fill. Demo-only: called from reset_demo_data(), never for
-- real tenants. Idempotent (re-runnable on every demo reset).

create or replace function _seed_demo_persistence_history(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days   int := 180;                 -- covers 1W/1M/3M/6M fully; 1Y partial
  v_reps   int;
begin
  -- ── 0. Make sure every rep has an active deal to score on ──────────────
  -- A rep whose deals are all won/lost has no active follow-ups, so their score
  -- is null ("no data yet"). Re-activate one closed deal for any such owner so
  -- every rep shows on the team roster.
  with need as (
    select owner_id
    from deals
    where org_id = p_org and owner_id is not null
    group by owner_id
    having count(*) filter (where stage not in ('won', 'lost')) = 0
  ),
  pick as (
    select distinct on (d.owner_id) d.id
    from deals d
    join need n on n.owner_id = d.owner_id
    where d.org_id = p_org
    order by d.owner_id, d.id
  )
  update deals set stage = 'contacted' where id in (select id from pick);

  -- ── 1. Activity backfill on active demo deals ──────────────────────────
  -- One touch per active deal on days where the cadence gate fires (widening
  -- with age: recent ~every 2 days, oldest ~every 6). g = 0 is today.
  --
  -- Follow-up discipline is what makes the trend RISE and VARY: each touch's
  -- follow-up is either "kept" (long +10d window, always satisfied by the next
  -- touch) or "lapses" (+1d window, missed). The lapse rate is high in the past
  -- and low recently, and offset per rep, so older windows score lower and reps
  -- differ, instead of everyone pinned at 100. `lapses` fires more often as g
  -- (age) grows; the per-owner hash spreads reps apart.
  insert into activities (
    org_id, deal_id, logged_by, type, disposition,
    duration_minutes, outcome_notes, occurred_at, follow_up_date
  )
  select
    p_org,
    d.id,
    d.owner_id,
    (array['call','email','drop_in']::activity_type[])[1 + (g % 3)],
    (array['positive_engagement','connected_with_dm','followup_requested']::disposition[])[1 + (g % 3)],
    case when (g % 3) = 0 then 8 + (g % 12) else null end,   -- duration for calls only
    'Demo activity',
    (((current_date - g) + time '15:00'))::timestamptz,       -- date + time = timestamp
    (current_date - g
      + case
          when ((g + (abs(hashtext(d.owner_id::text)) % 5)) % 10) < (2 + (g / 30))
          then 1    -- lapses: 1-day window the next touch cannot satisfy
          else 10   -- kept: wide window the next touch satisfies
        end)::date
  from deals d
  cross join generate_series(0, v_days - 1) as g
  where d.org_id = p_org
    and d.owner_id is not null
    and d.stage not in ('won', 'lost')
    and (g % (2 + (g / 45))) = 0;                             -- cadence tightens toward today

  -- ── 2. Company benchmark snapshots (rising) ────────────────────────────
  select greatest(1, count(*)) into v_reps
    from profiles where org_id = p_org and role = 'rep';

  insert into persistence_company_snapshot (
    org_id, snapshot_date, composite_median, composite_p90, rep_count, formula_version
  )
  select
    p_org,
    (current_date - g)::date,
    round(58 + ((v_days - g)::numeric / v_days) * 17, 1),      -- median 58 -> 75
    round(86 + ((v_days - g)::numeric / v_days) * 7, 1),       -- p90    86 -> 93
    v_reps,
    3                                                          -- formula stamp (reads don't filter on it)
  from generate_series(0, v_days - 1) as g
  on conflict (org_id, snapshot_date) do update set
    composite_median = excluded.composite_median,
    composite_p90    = excluded.composite_p90,
    rep_count        = excluded.rep_count,
    formula_version  = excluded.formula_version;
end $$;

-- Internal only: called by reset_demo_data() (same admin/flag gate). NOT
-- callable directly by clients.
revoke all on function _seed_demo_persistence_history(uuid) from public;

-- ── Extend the demo reset wrapper to also seed persistence history ──
create or replace function reset_demo_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_role   user_role;
  v_owner  uuid := auth.uid();
begin
  if v_owner is null then raise exception 'not_authenticated'; end if;
  select p.org_id, p.role into v_org_id, v_role from profiles p where p.id = v_owner;
  if v_role <> 'admin' then raise exception 'not_authorized'; end if;
  if not exists (
    select 1 from org_features
    where org_id = v_org_id and feature_key = 'demo_reset' and enabled
  ) then
    raise exception 'demo_reset_not_enabled';
  end if;

  perform reset_demo_data_base();                       -- existing wipe + 18-deal reseed
  perform _seed_demo_hierarchy(v_org_id, v_owner);      -- + synthetic 7-layer org, branch-distributed deals
  perform _seed_demo_persistence_history(v_org_id);     -- + 180d activity backfill + rising benchmark snapshots
end $$;
grant execute on function reset_demo_data() to authenticated;
