-- Path & Activities polish P2.1 — coordinates on deals.
--
-- Deals have never stored a location. Path-created deals borrow coordinates from
-- their originating prospect (via place_id), but a manually-typed deal has only
-- an address string and so can't be routed as an "owed visit". These nullable
-- columns let the app geocode a manual deal's address at create time and store
-- the result, so hand-entered deals can also surface in Find-Near-Me.
--
-- Nullable + no backfill: existing manual deals stay coordinate-less until
-- re-saved (acceptable for v1). Path-created deals keep resolving coordinates
-- through their prospect, so they don't need these populated.

alter table deals
  add column if not exists lat double precision,
  add column if not exists lng double precision;

comment on column deals.lat is 'Latitude for Path routing; geocoded from address for manual deals. Null when unknown.';
comment on column deals.lng is 'Longitude for Path routing; geocoded from address for manual deals. Null when unknown.';
