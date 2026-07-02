-- 20260702000001_prospects_nearby_category_filter.sql
--
-- Add an optional category filter to prospects_nearby so the Path search returns
-- the nearest N businesses OF the selected industries — not the nearest N of any
-- type in radius. Without this, the industry picker only scoped the Google
-- INGEST; the read returned every cached prospect nearby, so filtering appeared
-- broken (select "Restaurants" → get a mix).
--
-- p_categories = null → no filter ("All business types"). Callers pass the
-- EXPANDED category set (merged keys + the pre-merge split keys they absorbed),
-- because the Retail / Restaurants-Bars-Entertainment merge relabels old rows
-- without rewriting them (see industryTaxonomy.categoriesForIndustries).
--
-- Drops the 6-arg signature and recreates with the 7th param to avoid a
-- PostgREST overload ambiguity. Body is otherwise identical to
-- 20260602000001; the 25-row cap still comes from the Edge's p_limit.

drop function if exists prospects_nearby(double precision, double precision, double precision, text, integer, boolean);

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
    and (p_include_chains or not p.is_chain)
    and (p_categories is null or p.category = any(p_categories))
    and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
  order by distance_m asc
  limit greatest(1, least(coalesce(p_limit, 30), 500));
$$;

grant execute on function prospects_nearby(double precision, double precision, double precision, text, integer, boolean, text[]) to authenticated;
