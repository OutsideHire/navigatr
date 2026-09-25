-- Decide "is this a chain" at SEARCH time instead of at first sight.
--
-- WHY. is_chain is computed once per place at ingest and NOTHING ever
-- recomputes it: no backfill, no cron, no admin RPC. The read path reads the
-- stored boolean and never re-consults the brand list. So adding a brand to
-- exclusion_seed has no effect on any business already in the table.
--
-- That is not theoretical. A production sweep on 2026-09-25 found 18 True Value
-- stores with is_chain = false. True Value is a co-op whose members trade under
-- local names ("Adam True Value Hardware & Ag Sply"), so the substring list
-- missed them at ingest. Adding the pattern alone would NOT have hidden those
-- 18 rows; they would have stayed visible forever.
--
-- The fix ORs the stored verdict with a live check against the brand list. It
-- can only ever hide MORE, never less, so a correctly-flagged row keeps its
-- existing behaviour and nothing that is visible today disappears except an
-- actual chain. From here, adding a brand takes effect for every rep on their
-- next search: no backfill, no re-pull, no Google spend.
--
-- The same-name-density and enterprise-brand gates stay at ingest for now. They
-- need territory-wide counts that are expensive to compute per query, and they
-- are not what is leaking.

-- The one verified gap. Deliberately just this brand: it is the only escape a
-- sweep of the major chains actually found, and every pattern added here is a
-- substring match that can catch an unrelated business.
insert into exclusion_seed (name_pattern, brand, scope, brand_id, primary_type)
values ('true value', 'True Value', 'national', 'true_value', 'hardware_store')
on conflict (name_pattern) do nothing;

create or replace function prospects_nearby(
  p_lat            double precision,
  p_lng            double precision,
  p_radius_m       double precision default 3000,
  p_profession     text default null,
  p_limit          integer default 30,
  p_include_chains boolean default false,
  p_categories     text[] default null
)
returns table (
  id               uuid,
  place_id         text,
  name             text,
  category         text,
  address          text,
  lat              double precision,
  lng              double precision,
  phone            text,
  website          text,
  employee_count   integer,
  rating_count     integer,
  rating           double precision,
  primary_type     text,
  is_chain         boolean,
  chain_confidence text,
  chain_brand_name text,
  distance_m       double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    p.id, p.place_id, p.name, p.category, p.address,
    p.lat, p.lng, p.phone, p.website, p.employee_count, p.rating_count, p.rating, p.primary_type,
    p.is_chain, p.chain_confidence, p.chain_brand_name,
    ST_Distance(p.location, ST_MakePoint(p_lng, p_lat)::geography) as distance_m
  from prospects p
  where p.in_profile
    and (
      p_include_chains
      or (
        not p.is_chain
        -- Live brand check. Inline rather than a helper so the planner can run
        -- it against the survivors of the spatial + category narrowing above,
        -- not against the whole table.
        and not exists (
          select 1 from exclusion_seed s
          where s.active
            and position(lower(s.name_pattern) in lower(p.name)) > 0
        )
      )
    )
    and (p_categories is null or p.category = any(p_categories))
    and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
    and not exists (
      select 1 from deals d
      where d.place_id = p.place_id
        and d.org_id = public.user_org_id()
        and d.stage not in ('won','lost')
    )
    and not exists (
      select 1 from deals d
      where d.org_id = public.user_org_id()
        and d.stage not in ('won','lost')
        and d.dedupe_key is not null
        and d.dedupe_key = public.deal_dedupe_key(p.name, p.address)
    )
  order by distance_m asc
  limit greatest(1, least(coalesce(p_limit, 30), 500));
$$;

-- Keep the hidden counts consistent with what the list actually hides,
-- otherwise the "N filtered out" affordance lies to the rep.
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
      where not p_include_chains
        and (
          p.is_chain
          or exists (
            select 1 from exclusion_seed s
            where s.active
              and position(lower(s.name_pattern) in lower(p.name)) > 0
          )
        )
    ), 0)::int as chains_hidden,
    coalesce(count(*) filter (
      where (
        p_include_chains
        or (
          not p.is_chain
          and not exists (
            select 1 from exclusion_seed s
            where s.active
              and position(lower(s.name_pattern) in lower(p.name)) > 0
          )
        )
      )
        and exists (
          select 1 from deals d
          where d.org_id = public.user_org_id()
            and d.stage not in ('won','lost')
            and (
              d.place_id = p.place_id
              or (d.dedupe_key is not null and d.dedupe_key = public.deal_dedupe_key(p.name, p.address))
            )
        )
    ), 0)::int as in_pipeline_hidden
  from prospects p
  where p.in_profile
    and (p_categories is null or p.category = any(p_categories))
    and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m);
$$;
