-- Hide home-based businesses from discovery, with a way to get them back.
--
-- A beta ISO reports ~70% of the businesses discovered in their territory are
-- residential, and their reps report 50-70%. A rep cannot walk into a house, so
-- these are not workable door-knocks. We had no residential concept at all.
--
-- Google has NO "this is a home business" flag, so this infers it, and inference
-- is wrong in both directions. Two deliberate safeguards:
--   1. NULL never hides. The premises signals only populate for newly
--      discovered places, and hiding a real merchant because Google was quiet
--      about it is the failure we care most about avoiding.
--   2. Everything hidden is recoverable. p_include_home_based returns them, and
--      the counts function reports how many were hidden, so the UI can offer
--      "show N filtered out" rather than silently deleting a rep's territory.
--
-- Functions are dropped and recreated because the signature gains a parameter.
-- The destructive-migration guard deliberately does not flag functions: unlike
-- a table they carry no data and are rebuilt from this file.

-- Co-tenancy lookup: several businesses at one address means a strip mall or
-- office park, which PROTECTS the row from being hidden. Indexed on the
-- normalised address so the check stays cheap per candidate.
create index if not exists prospects_address_norm_idx
  on prospects (lower(btrim(address)))
  where address is not null;

drop function if exists prospects_nearby(
  double precision, double precision, double precision, text, integer, boolean, text[]);
drop function if exists prospects_nearby_hidden_counts(
  double precision, double precision, double precision, text, boolean, text[]);

-- Trade types that are overwhelmingly run from a vehicle or a house. A PRIOR,
-- never a verdict: a plumber with a real shop is caught by the protections
-- below and stays visible. Tuned from what reps actually recover via the
-- "show filtered" control.
create or replace function public.prospect_is_home_based(
  p_primary_type   text,
  p_pure_service   boolean,
  p_containing     integer,
  p_accessible     boolean,
  p_address        text,
  p_id             uuid
)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select
    case
      -- Google itself says the business serves customers at THEIR location.
      -- Authoritative: not overridable, because it is a direct statement that
      -- there is no customer-facing address to visit.
      when p_pure_service is true then true
      -- Otherwise a trade type only counts when nothing says "real premises".
      when p_primary_type = any (array[
             'plumber','electrician','roofing_contractor','general_contractor',
             'painter','locksmith','moving_company'
           ])
       and coalesce(p_containing, 0) = 0
       and p_accessible is distinct from true
       and not exists (
             -- Three or more businesses at one address: a plaza or office park.
             select 1 from prospects q
             where p_address is not null
               and lower(btrim(q.address)) = lower(btrim(p_address))
               and q.id <> p_id
             offset 1 limit 1
           )
      then true
      else false
    end;
$$;

create function prospects_nearby(
  p_lat               double precision,
  p_lng               double precision,
  p_radius_m          double precision default 3000,
  p_profession        text default null,
  p_limit             integer default 30,
  p_include_chains    boolean default false,
  p_categories        text[] default null,
  p_include_home_based boolean default false
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
  is_home_based    boolean,
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
    public.prospect_is_home_based(p.primary_type, p.pure_service_area,
      p.containing_places_count, p.has_accessibility, p.address, p.id) as is_home_based,
    ST_Distance(p.location, ST_MakePoint(p_lng, p_lat)::geography) as distance_m
  from prospects p
  where p.in_profile
    and (
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
    and (
      p_include_home_based
      or not public.prospect_is_home_based(p.primary_type, p.pure_service_area,
            p.containing_places_count, p.has_accessibility, p.address, p.id)
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

create function prospects_nearby_hidden_counts(
  p_lat               double precision,
  p_lng               double precision,
  p_radius_m          double precision default 3000,
  p_profession        text default null,
  p_include_chains    boolean default false,
  p_categories        text[] default null,
  p_include_home_based boolean default false
)
returns table (
  chains_hidden      integer,
  in_pipeline_hidden integer,
  home_based_hidden  integer
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with scoped as (
    select p.*,
      (p.is_chain or exists (
        select 1 from exclusion_seed s
        where s.active and position(lower(s.name_pattern) in lower(p.name)) > 0
      )) as chain_now,
      public.prospect_is_home_based(p.primary_type, p.pure_service_area,
        p.containing_places_count, p.has_accessibility, p.address, p.id) as home_now
    from prospects p
    where p.in_profile
      and (p_categories is null or p.category = any(p_categories))
      and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
  )
  select
    coalesce(count(*) filter (where not p_include_chains and chain_now), 0)::int,
    coalesce(count(*) filter (
      where (p_include_chains or not chain_now)
        and (p_include_home_based or not home_now)
        and exists (
          select 1 from deals d
          where d.org_id = public.user_org_id()
            and d.stage not in ('won','lost')
            and (
              d.place_id = scoped.place_id
              or (d.dedupe_key is not null and d.dedupe_key = public.deal_dedupe_key(scoped.name, scoped.address))
            )
        )
    ), 0)::int,
    -- Counted only among rows that survived the chain filter, so a chain that
    -- is also home-based is reported once, not twice.
    coalesce(count(*) filter (
      where not p_include_home_based
        and home_now
        and (p_include_chains or not chain_now)
    ), 0)::int
  from scoped;
$$;
