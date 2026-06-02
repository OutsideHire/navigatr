-- 20260602000001_raise_read_limit.sql
--
-- Raise the prospects_nearby read cap 100 → 500. Merchant-services reps work
-- dense territories where the nearest 100 in-profile businesses within radius
-- isn't enough coverage. Body is identical to 20260601000003_chain_handling.sql
-- except the final `least(..., 100)` → `least(..., 500)`. Signature unchanged,
-- so `create or replace` (no drop needed); grants are preserved.
--
-- Paired with discover_prospects' READ_LIMIT bump (100 → 500); the Edge must be
-- redeployed after this for the larger pull to take effect (the smaller of the
-- two wins, so order doesn't break anything).

create or replace function prospects_nearby(
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
  limit greatest(1, least(coalesce(p_limit, 30), 500));
$$;

grant execute on function prospects_nearby(double precision, double precision, double precision, text, integer, boolean) to authenticated;
