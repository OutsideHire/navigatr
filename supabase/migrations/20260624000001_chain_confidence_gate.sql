-- 20260624000001_chain_confidence_gate.sql
--
-- Chain Handling spec §5 confidence gate. Previously prospects_nearby excluded
-- ALL chains when p_include_chains is false (the bare `not p.is_chain` predicate).
-- Per §5, a chain must be excluded ONLY when it is high/medium-confidence; low-
-- and null-confidence chains are returned even when p_include_chains is false.
--
-- The chain predicate in the WHERE clause changes from
--   and (p_include_chains or not p.is_chain)
-- to
--   and (p_include_chains or not p.is_chain or coalesce(p.chain_confidence, '') not in ('high', 'medium'))
-- The coalesce is REQUIRED for null-safety: a bare `chain_confidence not in
-- ('high','medium')` evaluates to NULL (unknown) for a NULL confidence under SQL
-- three-valued logic, which would DROP the row in a WHERE — wrongly excluding a
-- null-confidence chain. coalesce(...,'') maps NULL → '' → not in (...) is TRUE,
-- so low- and null-confidence chains are kept (only high/medium are excluded),
-- matching §5 (`return is_chain AND chain_confidence in ('high','medium')`) and the
-- client candidatePool gate.
--
-- Body is otherwise identical to 20260602000001_raise_read_limit.sql (the latest
-- definition of this function). Signature unchanged → `create or replace` (no drop,
-- grants preserved).
--
-- HAND-APPLY ONLY: per this repo's convention this migration must be applied to
-- prod by hand (psql / SQL editor), NOT via `supabase db push`.

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
    and (p_include_chains or not p.is_chain or coalesce(p.chain_confidence, '') not in ('high', 'medium'))
    and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
  order by distance_m asc
  limit greatest(1, least(coalesce(p_limit, 30), 500));
$$;

grant execute on function prospects_nearby(double precision, double precision, double precision, text, integer, boolean) to authenticated;
