-- 20260531000003_prospect_rating.sql
--
-- Phase A of the opportunity-ranking design (2026-05-31): store the Google
-- Places `rating` (average stars, 1.0–5.0) alongside the existing
-- `rating_count`. Together they're the saturation/opportunity signal navigatr
-- ranks on in-app — low review count = under-pitched/newly-opened = the rep's
-- edge; `rating` is a secondary quality read.
--
-- This pairs with two non-DB changes that ship the same week:
--   - discover_prospects: flip searchNearby rankPreference POPULARITY → DISTANCE
--     (so underseen places get FETCHED) and add `places.rating` to the FieldMask
--     + the upsert row.
--   - navigatr: opportunity sort (low rating_count up, distance tiebreak).
--
-- Existing rows get NULL rating until their (cell, bucket) cache expires and
-- re-pulls them — acceptable self-healing, same pattern as the category
-- backfill. No backfill needed.

alter table prospects
  add column rating double precision;   -- Places average rating (stars), nullable

-- ---------------------------------------------------------------------------
-- prospects_nearby — recreated to return `rating`.
-- ---------------------------------------------------------------------------
-- Postgres can't `create or replace` a function whose OUT/return signature
-- changes (the return TABLE gains a column), so we DROP then CREATE. The body,
-- security, and grant are otherwise identical to 20260531000001. `rating` is
-- appended AFTER rating_count to keep the existing column order stable for any
-- positional consumers.
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
  distance_m     double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    p.id, p.place_id, p.name, p.category, p.address,
    p.lat, p.lng, p.phone, p.website, p.employee_count, p.rating_count, p.rating,
    ST_Distance(p.location, ST_MakePoint(p_lng, p_lat)::geography) as distance_m
  from prospects p
  where p.in_profile
    and not p.is_chain
    and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
  order by distance_m asc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

grant execute on function prospects_nearby(double precision, double precision, double precision, text, integer) to authenticated;
