-- 20260531000001_path_prospect_store.sql
--
-- Path / Build-Your-Path — Phase 1: the prospect store + Places-ingest spine.
-- See PATH_DESIGN.md for the full design. This migration lays down the
-- geospatial cache everything else hangs off.
--
-- THE KEY ARCHITECTURAL CHOICE — this store is PLATFORM-SHARED, not org-scoped.
-- A coffee shop at 123 Main St is the same business for every ISO, so we
-- ingest it from Google Places ONCE and every tenant's reps read it. That is
-- the whole reason the cache cuts Places spend ~90%: the expensive work
-- (Places call + chain classification) happens once for the platform, not
-- once per tenant.
--
-- This DELIBERATELY diverges from the project's usual "select-only-your-org"
-- RLS pattern. `prospects` and `exclusion_seed` are readable by ANY
-- authenticated user (shared cache). The tenant-specific *verdict* layering
-- (per-tenant overrides, FR-PATH-13/16/19) is a later migration; Phase 1 is
-- just the shared store + a coarse in_profile/is_chain flag computed at ingest.
--
-- Writes: NONE from the client. The discover_prospects Edge Function writes
-- with the service role (bypasses RLS). No insert/update/delete policies are
-- defined, so the authenticated rep client can read but never mutate.

-- ---------------------------------------------------------------------------
-- PostGIS — Supabase installs extensions into the `extensions` schema.
-- (Mirrors the existing convention, e.g. extensions.gen_random_bytes in
-- create_organization.) Geography types + GIST opclasses resolve via the
-- postgres role's search_path at migration time; the RPC below sets its own
-- search_path to include `extensions` so ST_* functions resolve there too.
-- ---------------------------------------------------------------------------
create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- prospects — the shared geospatial business cache.
-- ---------------------------------------------------------------------------
-- One row per real-world business, keyed by Google place_id (the dedupe key:
-- ingest once, reuse for every rep in every tenant). `location` is the
-- PostGIS geography used for ST_DWithin proximity queries; lat/lng are
-- denormalized alongside it so the client (which has no PostGIS) can render
-- markers and run its own haversine without a round-trip.
create table prospects (
  id                uuid primary key default gen_random_uuid(),
  place_id          text not null unique,                  -- Google Place ID
  name              text not null,
  category          text not null,                          -- normalized primary category
  google_types      text[] not null default '{}',           -- raw Places types, for re-classification
  location          extensions.geography(Point, 4326) not null,
  lat               double precision not null,
  lng               double precision not null,
  geo_cell          text not null,                           -- geohash cell (precision 6), set by ingest
  address           text,
  phone             text,
  website           text,
  rating_count      integer,                                 -- Places userRatingCount (size proxy)
  -- Google Places does NOT return employee count. NULL until a firmographics
  -- vendor lands (PATH_DESIGN.md §6 / Phase 5). The >250 filter is vendor-gated.
  employee_count    integer,
  -- ICP verdict computed at ingest (see discover_prospects/icpFilter.ts).
  is_chain          boolean not null default false,
  chain_reason      text,                                    -- 'seed_list'|'same_name_density'|'category'|'gov'|null
  in_profile        boolean not null default true,           -- passed the category gate for >=1 profession
  source            text not null default 'google_places',   -- source-agnostic: 'firmographics' slots in later
  first_seen_at     timestamptz not null default now(),
  last_refreshed_at timestamptz not null default now()
);

-- Spatial index: the workhorse for prospects_nearby's ST_DWithin.
create index prospects_location_gix on prospects using gist (location);
-- Cell + category lookups during ingest classification (same-name density).
create index prospects_geo_cell_idx on prospects (geo_cell);
create index prospects_category_idx on prospects (category);
-- Partial index for the hot read path: in-profile, non-chain prospects.
create index prospects_servable_idx on prospects (geo_cell)
  where in_profile and not is_chain;
-- Same-name density heuristic (FR-PATH-14) counts same-name rows; index name.
create index prospects_name_lower_idx on prospects (lower(name));

-- PostgREST (and the Edge Function via supabase-js) can't write a PostGIS
-- geography directly, so the ingest inserts plain lat/lng and this trigger
-- derives `location` from them. Also stamps last_refreshed_at on every write
-- so the Approach-C refresh job (Phase 5) has a freshness signal. search_path
-- includes `extensions` so ST_MakePoint / the geography cast resolve.
create or replace function prospects_set_location()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.lat is not null and new.lng is not null then
    new.location := ST_MakePoint(new.lng, new.lat)::geography;
  end if;
  new.last_refreshed_at := now();
  return new;
end $$;

create trigger prospects_set_location_trg
  before insert or update on prospects
  for each row execute function prospects_set_location();

alter table prospects enable row level security;

-- Shared read: any authenticated rep, any tenant. No write policies → only
-- the service-role Edge Function can mutate.
create policy prospects_select_authenticated
  on prospects for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- geo_cell_cache — cold-cell bookkeeping + FR-PATH-17 observability.
-- ---------------------------------------------------------------------------
-- "Have we already pulled Places for this (cell, category)?" One row per
-- combo. last_pulled_at drives the cache-hit decision; raw/filtered counts
-- are the observability numbers (total returned vs how many survived ICP),
-- surfaced to admins later. last_refreshed_at column on prospects + this
-- table together enable the Approach-C scheduled refresh job (Phase 5).
create table geo_cell_cache (
  geo_cell        text not null,
  category        text not null,
  last_pulled_at  timestamptz not null default now(),
  raw_count       integer not null default 0,               -- Places returned
  filtered_count  integer not null default 0,               -- removed by ICP/exclusion
  kept_count      integer not null default 0,               -- upserted as servable
  primary key (geo_cell, category)
);

-- Locked down entirely: no policies. Only the service role (which bypasses
-- RLS) reads/writes this. Admin observability reads come through an RPC later.
alter table geo_cell_cache enable row level security;

-- ---------------------------------------------------------------------------
-- exclusion_seed — the global, navigatr-curated chain list (FR-PATH-12/13).
-- ---------------------------------------------------------------------------
-- Curated ONCE centrally, applied to every tenant ("curate and feed to many").
-- The ingest function matches a candidate business name against active rows
-- to flag known national/regional chains. The same-name-density heuristic in
-- icpFilter.ts catches the UNKNOWN chains this list misses; the per-tenant
-- admin override + review queue (Phase 4) handles the long tail.
create table exclusion_seed (
  id            uuid primary key default gen_random_uuid(),
  -- Case-insensitive substring matched against the business name. e.g.
  -- 'subway', 'jersey mike', 'chase bank'. Kept simple on purpose; a fuzzier
  -- matcher can replace this without a schema change.
  name_pattern  text not null,
  brand         text not null,                               -- display/grouping label
  scope         text not null default 'national' check (scope in ('national','regional')),
  region        text,                                        -- nullable; set for regional brands
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (name_pattern)
);

create index exclusion_seed_active_idx on exclusion_seed (active) where active;

alter table exclusion_seed enable row level security;
-- Authenticated read so an admin UI can show the list later; writes are
-- service-role / admin-RPC only (no write policies here).
create policy exclusion_seed_select_authenticated
  on exclusion_seed for select to authenticated using (true);

-- A small starter set of high-volume national brands. This is NOT exhaustive —
-- it's the 80/20 of chain *volume*. The heuristics + admin queue grow the rest.
insert into exclusion_seed (name_pattern, brand, scope) values
  ('subway',            'Subway',            'national'),
  ('mcdonald',          'McDonald''s',       'national'),
  ('starbucks',         'Starbucks',         'national'),
  ('jersey mike',       'Jersey Mike''s',    'national'),
  ('jimmy john',        'Jimmy John''s',     'national'),
  ('dunkin',            'Dunkin''',          'national'),
  ('chipotle',          'Chipotle',          'national'),
  ('taco bell',         'Taco Bell',         'national'),
  ('burger king',       'Burger King',       'national'),
  ('wendy',             'Wendy''s',          'national'),
  ('domino',            'Domino''s',         'national'),
  ('pizza hut',         'Pizza Hut',         'national'),
  ('chase',             'Chase Bank',        'national'),
  ('wells fargo',       'Wells Fargo',       'national'),
  ('bank of america',   'Bank of America',   'national'),
  ('walgreens',         'Walgreens',         'national'),
  ('cvs',               'CVS',               'national'),
  ('7-eleven',          '7-Eleven',          'national'),
  ('shell',             'Shell',             'national'),
  ('chevron',           'Chevron',           'national'),
  ('exxon',             'ExxonMobil',        'national'),
  ('autozone',          'AutoZone',          'national'),
  ('home depot',        'The Home Depot',    'national'),
  ('lowe',              'Lowe''s',           'national'),
  ('walmart',           'Walmart',           'national'),
  ('target',            'Target',            'national'),
  ('ups store',         'The UPS Store',     'national'),
  ('fedex',             'FedEx',             'national'),
  ('great clips',       'Great Clips',       'national'),
  ('planet fitness',    'Planet Fitness',    'national');

-- ---------------------------------------------------------------------------
-- prospects_nearby — the read path Path's map/list calls.
-- ---------------------------------------------------------------------------
-- Returns servable (in-profile, non-chain) prospects within p_radius_m of the
-- rep, nearest first, with the great-circle distance precomputed so the client
-- doesn't recompute it. SECURITY DEFINER + search_path including `extensions`
-- so ST_* resolve. p_profession is accepted for forward-compat (per-profession
-- category refinement is Phase 4); Phase 1 filters on the coarse in_profile flag.
create or replace function prospects_nearby(
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
  distance_m     double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    p.id, p.place_id, p.name, p.category, p.address,
    p.lat, p.lng, p.phone, p.website, p.employee_count, p.rating_count,
    ST_Distance(p.location, ST_MakePoint(p_lng, p_lat)::geography) as distance_m
  from prospects p
  where p.in_profile
    and not p.is_chain
    and ST_DWithin(p.location, ST_MakePoint(p_lng, p_lat)::geography, p_radius_m)
  order by distance_m asc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

grant execute on function prospects_nearby(double precision, double precision, double precision, text, integer) to authenticated;
