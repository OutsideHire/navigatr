-- 20260820000005_hier_bundle1_pipeline_metrics.sql
--
-- PRD Addendum 6.12.A, Bundle 1 (P0), FR-HIER-03: compute the Pipeline KPI
-- totals SERVER-SIDE across the caller's full RLS-scoped set of deals, instead
-- of summing whatever subset the client happened to load.
--
-- Why this matters: the client's deals query has no explicit row limit, so
-- PostgREST caps it at its default max rows (1000). For a manager high in the
-- hierarchy who can see thousands of deals, the client-summed KPIs silently
-- understate. This function sums in the database over every visible row, so the
-- headline numbers are correct regardless of how many the client loaded. It
-- also supersedes FR-HIER-04 (a client-side row-limit guard), which is no
-- longer needed for these metrics.
--
-- SECURITY INVOKER (the default, stated explicitly) so the caller's own
-- hierarchy RLS on `deals` (deals_select -> user_can_see_owner) decides which
-- rows are summed. This is the whole point: the totals reflect exactly what the
-- caller is allowed to see, computed by the same rule as the list.
--
-- Parity with the client (features/pipeline/pages/PipelinePage.tsx computeKpis):
--   * total_pipeline_cents / weighted_cents / active_deals / no_value_active_deals
--     are over OPEN deals only (stage not in 'won','lost').
--   * weighted = round(value_cents * probability / 100) PER DEAL, then summed
--     (Math.round on the client; Postgres round() matches for our non-negative
--     domain).
--   * won_this_month is gated by the deal's WON-transition timestamp from
--     deal_stage_history (the latest to_stage='won' row), falling back to
--     deals.updated_at when the deal has no such history row (legacy rows /
--     history not yet written). This mirrors buildWonAtMap + the
--     `wonAtByDeal?.get(id) ?? updatedAt` fallback.
--   * p_month_start is supplied by the CLIENT as the first instant of the
--     current month in the user's local time, so "this month" means exactly
--     what the user sees on their screen (no server-timezone drift).

create or replace function public.pipeline_metrics(p_month_start timestamptz)
returns table (
  total_pipeline_cents  bigint,
  weighted_cents        bigint,
  active_deals          bigint,
  won_this_month_cents  bigint,
  won_deals_this_month  bigint,
  no_value_active_deals bigint
)
language sql stable security invoker set search_path = public as $$
  with visible as (
    select
      d.stage,
      d.value_cents,
      d.probability,
      -- Latest WON transition for this deal, else the deal's updated_at.
      -- The correlated lookup only touches history for deals already visible
      -- via deals RLS, so no cross-owner leak even though deal_stage_history
      -- itself is org-scoped.
      coalesce(
        (select max(h.transitioned_at)
           from deal_stage_history h
          where h.deal_id = d.id
            and h.to_stage = 'won'),
        d.updated_at
      ) as won_at
    from deals d
  )
  select
    coalesce(sum(value_cents)
      filter (where stage not in ('won', 'lost')), 0)::bigint,
    coalesce(sum(round(value_cents * probability / 100.0))
      filter (where stage not in ('won', 'lost')), 0)::bigint,
    count(*)
      filter (where stage not in ('won', 'lost'))::bigint,
    coalesce(sum(value_cents)
      filter (where stage = 'won' and won_at >= p_month_start), 0)::bigint,
    count(*)
      filter (where stage = 'won' and won_at >= p_month_start)::bigint,
    count(*)
      filter (where stage not in ('won', 'lost') and coalesce(value_cents, 0) = 0)::bigint
  from visible;
$$;

grant execute on function public.pipeline_metrics(timestamptz) to authenticated;
