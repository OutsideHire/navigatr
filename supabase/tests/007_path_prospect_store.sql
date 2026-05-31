-- Tests for migration 20260531000001_path_prospect_store.
--
-- Run with the service-role connection:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/007_path_prospect_store.sql
--
-- Self-cleans via the wrapping transaction's rollback. Each `do $$` block
-- raises with a clear case label on failure.
--
-- What's under test (Phase 1 of Path / Build-Your-Path — see PATH_DESIGN.md):
--   * the prospects_set_location trigger derives the PostGIS geography from
--     plain lat/lng on insert (PostgREST can't write geography directly). [case 1]
--   * prospects_nearby returns servable rows within radius, nearest first,
--     and computes distance_m.                                            [case 2]
--   * prospects_nearby EXCLUDES chains and out-of-profile rows (the ICP
--     verdict stored at ingest is enforced in the read path).            [case 3]
--   * prospects_nearby honors the radius (far rows drop out).            [case 4]
--   * the shared cache is readable by ANY authenticated user (platform-
--     shared, deliberately NOT org-scoped) but NOT writable by them.     [case 5]
--   * exclusion_seed shipped its starter chain list and is auth-readable. [case 6]
--
-- Austin city hall ≈ (30.2672, -97.7431). We seed rows at known offsets so the
-- distance + radius assertions are deterministic.

begin;

-- A user to act as for the RLS / RPC-grant assertions. The shared cache has no
-- org scoping, so any authenticated user is enough.
insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000c1', 'Path Test', 'path-test', 'path-test-aaaa');
insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('60000000-0000-0000-0000-000000000001', 'rep@path.example', 'authenticated', 'authenticated', now(), now(), now());
insert into profiles (id, org_id, role, full_name, email) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'rep', 'Path Rep', 'rep@path.example');

-- ───────────────────────────────────────────────────────────────────
-- Seed prospects via service role (bypasses RLS, fires the trigger).
-- We insert ONLY lat/lng + flags; the trigger fills `location`.
--   near    : ~150m away, servable      → must appear, distance small
--   mid     : ~1.2km away, servable     → must appear
--   far     : ~6km away, servable       → outside the 3km radius
--   chain   : ~150m away, is_chain      → filtered out
--   offprof : ~150m away, not in_profile→ filtered out
-- ───────────────────────────────────────────────────────────────────
insert into prospects (place_id, name, category, lat, lng, geo_cell, in_profile, is_chain, chain_reason)
values
  ('p_near',    'Near SMB',      'restaurant', 30.26855, -97.7431, '9v6kp', true,  false, null),
  ('p_mid',     'Mid SMB',       'dentist',    30.27800, -97.7431, '9v6kp', true,  false, null),
  ('p_far',     'Far SMB',       'restaurant', 30.32100, -97.7431, '9v6kq', true,  false, null),
  ('p_chain',   'Subway #4471',  'restaurant', 30.26855, -97.7432, '9v6kp', true,  true,  'seed_list'),
  ('p_offprof', 'Grand Hotel',   'lodging',    30.26855, -97.7433, '9v6kp', false, false, null);

-- ───────────────────────────────────────────────────────────────────
-- Case 1: the trigger derived `location` from lat/lng for every row.
-- ───────────────────────────────────────────────────────────────────
do $$
declare c int;
begin
  select count(*) into c from prospects where location is null;
  if c <> 0 then raise exception 'case1: % prospect rows have null location (trigger did not fire)', c; end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 2: prospects_nearby returns the two servable in-radius rows,
-- nearest first, with a sane distance_m.
-- ───────────────────────────────────────────────────────────────────
do $$
declare
  ids text[];
  near_d double precision;
  mid_d double precision;
begin
  select array_agg(place_id order by distance_m) into ids
    from prospects_nearby(30.2672, -97.7431, 3000, null, 30);
  if ids <> array['p_near','p_mid'] then
    raise exception 'case2: expected [p_near, p_mid] got %', ids;
  end if;
  select distance_m into near_d from prospects_nearby(30.2672, -97.7431, 3000, null, 30) where place_id = 'p_near';
  select distance_m into mid_d  from prospects_nearby(30.2672, -97.7431, 3000, null, 30) where place_id = 'p_mid';
  if near_d >= mid_d then
    raise exception 'case2: near (%) should be closer than mid (%)', near_d, mid_d;
  end if;
  -- p_near is ~150m out; allow generous slack for the haversine approximation.
  if near_d > 400 then raise exception 'case2: near distance % unexpectedly large', near_d; end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 3: chains and out-of-profile rows never appear, even in-radius.
-- ───────────────────────────────────────────────────────────────────
do $$
declare c int;
begin
  select count(*) into c from prospects_nearby(30.2672, -97.7431, 3000, null, 30)
    where place_id in ('p_chain', 'p_offprof');
  if c <> 0 then raise exception 'case3: chain/off-profile rows leaked into results (% found)', c; end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 4: radius is honored — a tight 500m radius drops the ~1.2km mid row.
-- ───────────────────────────────────────────────────────────────────
do $$
declare ids text[];
begin
  select array_agg(place_id order by distance_m) into ids
    from prospects_nearby(30.2672, -97.7431, 500, null, 30);
  if ids <> array['p_near'] then
    raise exception 'case4: expected only [p_near] within 500m, got %', ids;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 5: shared cache — authenticated user can READ all rows (no org
-- scoping) but CANNOT write (no insert policy → RLS denies).
-- ───────────────────────────────────────────────────────────────────
do $$
declare c int;
begin
  perform set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);

  -- Read: sees every shared row, regardless of org.
  select count(*) into c from prospects;
  if c < 5 then raise exception 'case5: authenticated read saw only % prospects, expected >=5', c; end if;

  -- Write: must be denied by RLS (no insert policy on the shared cache).
  begin
    insert into prospects (place_id, name, category, lat, lng, geo_cell)
      values ('p_evil', 'Hacker Co', 'other', 30.2672, -97.7431, '9v6kp');
    raise exception 'case5: authenticated user was able to INSERT into prospects (should be denied)';
  exception
    when insufficient_privilege then null;  -- expected: RLS blocked the write
  end;
end $$;

-- Reset to superuser for the final read assertions.
reset role;

-- ───────────────────────────────────────────────────────────────────
-- Case 6: the exclusion_seed starter chain list shipped with the migration.
-- ───────────────────────────────────────────────────────────────────
do $$
declare c int;
begin
  select count(*) into c from exclusion_seed where active;
  if c < 25 then raise exception 'case6: expected the seeded chain list (>=25 active), found %', c; end if;
  -- Spot-check a known brand the ingest must catch.
  select count(*) into c from exclusion_seed where name_pattern = 'subway';
  if c <> 1 then raise exception 'case6: subway seed pattern missing'; end if;
end $$;

\echo 'ALL PATH PROSPECT STORE TESTS PASSED'

rollback;
