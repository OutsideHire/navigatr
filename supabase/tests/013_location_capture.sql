-- Tests for migration 20260820000007_hier_bundle5_location_capture
-- (PRD 6.12.A Bundle 5: activity location capture + consent + retention).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/013_location_capture.sql
--
-- Self-cleans via the wrapping transaction's ROLLBACK. Verifies:
--   * a rep can geostamp only an activity they logged (insert with-check),
--   * SELECT is fail-closed: the logger + an admin see the geostamp, a peer
--     sees none (no manager/peer location visibility in beta),
--   * the retention purge nulls old coords but keeps the merchant + status,
--   * user_location_settings is self-only.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000d1', 'Loc Test', 'loc-test', 'loc-test-aaaaa');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('90000000-0000-0000-0000-000000000001', 'admin@l.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('90000000-0000-0000-0000-000000000002', 'rep1@l.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('90000000-0000-0000-0000-000000000003', 'rep2@l.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'admin', 'Admin', 'admin@l.example', 'top'::ltree),
  ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d1', 'rep',   'Rep1',  'rep1@l.example',  'top.rep1'::ltree),
  ('90000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000d1', 'rep',   'Rep2',  'rep2@l.example',  'top.rep2'::ltree);

insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('91000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '90000000-0000-0000-0000-000000000002', 'Loc Co', 'C', 'c@l.example', '+15550020001', 10000);

-- Activities: a1/a3/a4 logged by rep1, a2 logged by rep2. Seeded as superuser.
insert into activities (id, org_id, deal_id, logged_by, type, disposition, occurred_at, outcome_notes) values
  ('92000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '91000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-000000000002', 'call', 'positive_engagement', now(), 'r1 a1'),
  ('92000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d1', '91000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-000000000003', 'call', 'positive_engagement', now(), 'r2 a2'),
  ('92000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000d1', '91000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-000000000002', 'call', 'positive_engagement', now(), 'r1 a3'),
  ('92000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000d1', '91000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-000000000002', 'call', 'positive_engagement', now(), 'r1 a4');

-- Geostamps: recent (on a1) + old (on a3, past the 90-day window). a4 is left
-- geostamp-free for the insert test.
insert into activity_locations (activity_id, org_id, deal_id, captured_at, latitude, longitude, accuracy_m, capture_status) values
  ('92000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '91000000-0000-0000-0000-0000000000a1', now(), 30.2, -97.7, 12.0, 'captured'),
  ('92000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000d1', '91000000-0000-0000-0000-0000000000a1', now() - interval '100 days', 30.3, -97.8, 15.0, 'captured');

-- ─── Retention purge (FR-HIER-36): null old coords, keep merchant + status ──
do $$
declare n int;
begin
  perform public.purge_activity_location_coords();
  -- old row: coords nulled, but deal + status kept.
  select count(*) into n from activity_locations
    where activity_id = '92000000-0000-0000-0000-0000000000a3'
      and latitude is null and longitude is null and accuracy_m is null
      and deal_id = '91000000-0000-0000-0000-0000000000a1'
      and capture_status = 'captured';
  if n <> 1 then raise exception 'purge: old coords should be nulled, merchant+status kept, got %', n; end if;
  -- recent row: coords intact.
  select count(*) into n from activity_locations
    where activity_id = '92000000-0000-0000-0000-0000000000a1' and latitude is not null;
  if n <> 1 then raise exception 'purge: recent coords must remain, got %', n; end if;
end $$;

-- ─── INSERT with-check: only your own activity ────────────────────────
do $$
declare denied boolean := false;
begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000002', true); -- rep1
  perform set_config('role', 'authenticated', true);
  -- own activity a4 -> allowed
  insert into activity_locations (activity_id, org_id, deal_id, captured_at, capture_status)
  values ('92000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000d1', '91000000-0000-0000-0000-0000000000a1', now(), 'permission_denied');
  -- someone else's activity a2 -> denied
  begin
    insert into activity_locations (activity_id, org_id, deal_id, captured_at, capture_status)
    values ('92000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d1', '91000000-0000-0000-0000-0000000000a1', now(), 'captured');
  exception when others then denied := true;
  end;
  if not denied then raise exception 'insert: rep must NOT geostamp another rep''s activity'; end if;
end $$;

-- ─── SELECT fail-closed: logger + admin yes, peer no ──────────────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000002', true); -- rep1
  perform set_config('role', 'authenticated', true);
  select count(*) into n from activity_locations;
  if n <> 3 then raise exception 'select: rep1 should see 3 own geostamps (a1,a3,a4), got %', n; end if;
end $$;

do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000003', true); -- rep2
  perform set_config('role', 'authenticated', true);
  select count(*) into n from activity_locations;
  if n <> 0 then raise exception 'select: peer rep2 should see 0 geostamps, got %', n; end if;
end $$;

do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', true); -- admin
  perform set_config('role', 'authenticated', true);
  select count(*) into n from activity_locations;
  if n <> 3 then raise exception 'select: admin should see all 3 org geostamps, got %', n; end if;
end $$;

-- ─── user_location_settings is self-only ──────────────────────────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000002', true); -- rep1
  perform set_config('role', 'authenticated', true);
  insert into user_location_settings (user_id, org_id, activity_geostamp_enabled)
  values ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d1', false);
  select count(*) into n from user_location_settings;
  if n <> 1 then raise exception 'settings: rep1 should see only their own row, got %', n; end if;

  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000003', true); -- rep2
  perform set_config('role', 'authenticated', true);
  select count(*) into n from user_location_settings;
  if n <> 0 then raise exception 'settings: rep2 must not see rep1 settings, got %', n; end if;
end $$;

rollback;
