-- 20260724000001_pipeline_place_id_dedupe.sql
--
-- Pipeline prospect de-duplication. Anchor each deal to the Google place_id so a
-- business already tied to an ACTIVE deal (anyone in the org) is BOTH hidden from
-- Path discovery and blocked from being added a second time. "Active" = stage not
-- in ('won','lost'): a closed deal frees the business to be rediscovered/re-worked.

-- 1. Store the prospect fingerprint on the deal. Nullable: manual + legacy deals
--    have no place_id and are intentionally out of scope for de-dup.
alter table deals add column if not exists place_id text;

-- 2a. Fast lookup for the discovery-exclusion join (Mechanism A).
create index if not exists deals_org_place_idx
  on deals (org_id, place_id)
  where place_id is not null;

-- 2b. Hard org-wide guarantee (Mechanism B): at most one ACTIVE deal per
--     (org, place_id). A won/lost deal drops out of this partial index, so the
--     same business can be re-added later as a fresh active deal.
create unique index if not exists deals_org_place_active_uidx
  on deals (org_id, place_id)
  where place_id is not null and stage not in ('won','lost');

-- 3. Discovery hides any prospect already in an active deal for the caller's org.
--    Body is identical to 20260702000001 plus the NOT EXISTS clause. SECURITY
--    DEFINER, so the deals read bypasses RLS; org is scoped explicitly via
--    public.user_org_id() (resolves from the caller's JWT, same as the RLS
--    policies). create or replace keeps the existing 7-arg grant.
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
    and not exists (
      select 1 from deals d
      where d.place_id = p.place_id
        and d.org_id = public.user_org_id()
        and d.stage not in ('won','lost')
    )
  order by distance_m asc
  limit greatest(1, least(coalesce(p_limit, 30), 500));
$$;
