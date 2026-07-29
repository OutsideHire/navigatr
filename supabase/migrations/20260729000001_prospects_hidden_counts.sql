-- 20260729000001_prospects_hidden_counts.sql
--
-- Discovery transparency: alongside the servable prospects that prospects_nearby
-- returns, the UI wants to explain WHY a result set is short of what the rep
-- asked for. This companion function counts, within the same radius / profile /
-- category scope (but with NO limit), the two classes of nearby businesses that
-- were hidden:
--   * chains_hidden      - in-radius businesses excluded only because chains are
--                          hidden (Create). Zero when p_include_chains is true.
--   * in_pipeline_hidden - in-radius businesses that WOULD be servable but are
--                          already tied to an active deal in the caller's org
--                          (the pipeline de-dup, migration 20260724000001).
--
-- SECURITY DEFINER so the deals read bypasses RLS; org is scoped explicitly via
-- public.user_org_id() (resolves from the caller's JWT), matching prospects_nearby.
--
-- p_profession is accepted for call-site symmetry with prospects_nearby and is
-- intentionally unused in the body (fit is already encoded in prospects.in_profile).

create or replace function prospects_nearby_hidden_counts(
  p_lat            double precision,
  p_lng            double precision,
  p_radius_m       double precision default 3000,
  p_profession     text default null,
  p_include_chains boolean default false,
  p_categories     text[] default null
)
returns table (
  chains_hidden      integer,
  in_pipeline_hidden integer
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    coalesce(count(*) filter (
      where not p_include_chains and p.is_chain
    ), 0)::int as chains_hidden,
    coalesce(count(*) filter (
      where (p_include_chains or not p.is_chain)
        and exists (
          select 1 from deals d
          where d.place_id = p.place_id
            and d.org_id = public.user_org_id()
            and d.stage not in ('won','lost')
        )
    ), 0)::int as in_pipeline_hidden
  from prospects p
  where p.in_profile
    and (p_categories is null or p.category = any(p_categories))
    and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m);
$$;

grant execute on function prospects_nearby_hidden_counts(
  double precision, double precision, double precision, text, boolean, text[]
) to authenticated;
