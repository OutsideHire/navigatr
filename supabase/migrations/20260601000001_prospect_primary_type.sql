-- 20260601000001_prospect_primary_type.sql
--
-- Path v2 Slice 1: store the Google Places `primaryType` on prospects and
-- return it from prospects_nearby. primaryType is the single best-guess category
-- for a place; the ingest falls back to types[0] when it's missing so we never
-- drop a lead's category. Improves downstream bucketing without a vendor.
--
-- Pairs with discover_prospects adding `places.primaryType` to the field mask +
-- the upsert row. Existing rows get NULL until their (cell, bucket) cache
-- expires and re-pulls them — same self-heal as the rating column.

alter table prospects
  add column primary_type text;   -- Places primaryType (or types[0] fallback)

-- Recreate prospects_nearby to return primary_type. Postgres can't `create or
-- replace` a function whose return TABLE gains a column, so DROP then CREATE.
-- Identical body/security/grant to 20260531000003 with primary_type appended.
drop function if exists prospects_nearby(double precision, double precision, double precision, text, integer);

create function prospects_nearby(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_m   double precision default 3000,
  p_profession text default null,
  p_limit      integer default 30
)
returns table (
  id             uuid,
  place_id       text,
  name           text,
  category       text,
  address        text,
  lat            double precision,
  lng            double precision,
  phone          text,
  website        text,
  employee_count integer,
  rating_count   integer,
  rating         double precision,
  primary_type   text,
  distance_m     double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    p.id, p.place_id, p.name, p.category, p.address,
    p.lat, p.lng, p.phone, p.website, p.employee_count, p.rating_count, p.rating, p.primary_type,
    ST_Distance(p.location, ST_MakePoint(p_lng, p_lat)::geography) as distance_m
  from prospects p
  where p.in_profile
    and not p.is_chain
    and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
  order by distance_m asc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

grant execute on function prospects_nearby(double precision, double precision, double precision, text, integer) to authenticated;
