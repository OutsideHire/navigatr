-- Tests for migration 20260820000008_hier_bundle5_capture_health
-- (PRD 6.12.A Bundle 5, FR-HIER-37: weekly capture-health figure).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/014_capture_health.sql
--
-- Self-cleans via ROLLBACK. Verifies location_capture_health():
--   * breaks logged activities down by geostamp capture_status over the window,
--     with a 'no_geostamp' bucket for activities carrying none,
--   * excludes activities older than the window,
--   * is admin-only (a non-admin gets an empty set).

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000d2', 'Health Test', 'health-test', 'health-test-aa');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@h2.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0000000-0000-0000-0000-000000000002', 'rep@h2.example',   'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', 'admin', 'Admin', 'admin@h2.example', 'top'::ltree),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d2', 'rep',   'Rep',   'rep@h2.example',   'top.rep'::ltree);

insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('a1000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-000000000002', 'H Co', 'C', 'c@h2.example', '+15550030001', 10000);

-- Activities: 3 in-window (captured / denied / none), 1 old (excluded).
insert into activities (id, org_id, deal_id, logged_by, type, disposition, occurred_at, outcome_notes) values
  ('a2000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000002', 'call', 'positive_engagement', now(),              'cap'),
  ('a2000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000002', 'call', 'positive_engagement', now(),              'denied'),
  ('a2000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000002', 'call', 'positive_engagement', now(),              'none'),
  ('a2000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-000000000002', 'call', 'positive_engagement', now() - interval '30 days', 'old');

insert into activity_locations (activity_id, org_id, deal_id, captured_at, latitude, longitude, accuracy_m, capture_status) values
  ('a2000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000d1', now(), 30.2, -97.7, 10, 'captured'),
  ('a2000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000d1', now(), null, null, null, 'permission_denied'),
  ('a2000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000d1', now() - interval '30 days', 30.2, -97.7, 10, 'captured');

-- ─── Admin: window breakdown ──────────────────────────────────────────
do $$
declare v_cap int; v_denied int; v_none int; v_rows int;
begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  select activity_count into v_cap    from public.location_capture_health(7) where capture_status = 'captured';
  select activity_count into v_denied from public.location_capture_health(7) where capture_status = 'permission_denied';
  select activity_count into v_none   from public.location_capture_health(7) where capture_status = 'no_geostamp';
  if coalesce(v_cap, 0)    <> 1 then raise exception 'health: captured expected 1 (old excluded), got %', v_cap; end if;
  if coalesce(v_denied, 0) <> 1 then raise exception 'health: permission_denied expected 1, got %', v_denied; end if;
  if coalesce(v_none, 0)   <> 1 then raise exception 'health: no_geostamp expected 1, got %', v_none; end if;
  select count(*) into v_rows from public.location_capture_health(7);
  if v_rows <> 3 then raise exception 'health: expected 3 status buckets in window, got %', v_rows; end if;
end $$;

-- ─── Non-admin: empty ─────────────────────────────────────────────────
do $$
declare v_rows int;
begin
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000002', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_rows from public.location_capture_health(7);
  if v_rows <> 0 then raise exception 'health: non-admin must get an empty set, got % rows', v_rows; end if;
end $$;

rollback;
