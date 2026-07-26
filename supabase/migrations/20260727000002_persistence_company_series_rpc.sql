-- 20260727000002_persistence_company_series_rpc.sql
-- Org daily company-aggregate series for the trend chart's company-average and
-- top-decile lines. Org-scoped via user_org_id(); the client gates by role
-- (reps do not render peer benchmarks). SELECT-only, no mutation.
create or replace function persistence_company_series(p_range_days integer default 90)
returns table (snapshot_date date, composite_median numeric, composite_p90 numeric, rep_count int)
language sql stable security definer set search_path = public as $$
  select s.snapshot_date, s.composite_median, s.composite_p90, s.rep_count
  from persistence_company_snapshot s
  where s.org_id = public.user_org_id()
    and s.snapshot_date >= (current_date - make_interval(days => greatest(1, least(coalesce(p_range_days, 90), 400))))
  order by s.snapshot_date asc;
$$;
grant execute on function persistence_company_series(integer) to authenticated;
