-- 20260601000003_chain_handling.sql
--
-- Path Slice 5: chain confidence + brand attribution + show-chains-in-browse.
--   - prospects: chain_confidence / chain_brand_id / chain_brand_name (additive;
--     self-heal on TTL re-pull).
--   - exclusion_seed: brand_id + primary_type (the allowlist grows in this file).
--   - prospects_nearby: opt-in p_include_chains so Find Near Me can show + flag
--     chains while Create Path keeps excluding them.

alter table prospects
  add column chain_confidence text,   -- 'high' | 'medium' | 'low' | null
  add column chain_brand_id   text,
  add column chain_brand_name text;

alter table exclusion_seed
  add column brand_id     text,
  add column primary_type text;

-- Recreate prospects_nearby: signature gains p_include_chains + 3 returned chain
-- columns (before distance_m). Body otherwise identical to 20260601000001.
drop function if exists prospects_nearby(double precision, double precision, double precision, text, integer);

create function prospects_nearby(
  p_lat            double precision,
  p_lng            double precision,
  p_radius_m       double precision default 3000,
  p_profession     text default null,
  p_limit          integer default 30,
  p_include_chains boolean default false
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
    and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
  order by distance_m asc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

grant execute on function prospects_nearby(double precision, double precision, double precision, text, integer, boolean) to authenticated;
