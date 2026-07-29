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
  -- ── 1. Activity backfill on active demo deals ──────────────────────────
  -- One touch per active deal on days where the cadence gate fires. The gate
  -- widens with age (recent = every 2 days, oldest = every ~6), so activity
  -- volume + the recomputed composite both rise toward today. Dispositions all
  -- schedule a follow-up, and the dense recent touches "keep" earlier
  -- follow-ups, lifting follow-up discipline. Rotates type/disposition by day so
  -- the volume bars and mix look natural. g = 0 is today, g = v_days-1 oldest.
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
    (current_date - g + 4)                                    -- follow-up 4 days out
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
