-- Tests for migration 20260826000002_demo_seed_bulk_reps.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/025_demo_seed_bulk_reps.sql
--
-- Self-cleans via ROLLBACK. Verifies _seed_demo_bulk_reps creates N non-login
-- synthetic reps under the two existing demo managers (correct role_level,
-- deterministic ids, no password) and is re-runnable (idempotent per org). The
-- reset_demo_data wrapper's one-line call to it + the seat bump are trivial and
-- covered by inspection, not exercised here (the full reset chain is heavy).

begin;

-- Org + owner + the two managers the helper slots reps under (ids match the
-- helper's md5(org||key) convention).
insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000ff', 'Demo Bulk', 'demo-bulk', 'demo-bulk-code');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  (md5('00000000-0000-0000-0000-0000000000ff' || 'owner')::uuid, 'owner@demo.example', 'authenticated', 'authenticated', now(), now(), now()),
  (md5('00000000-0000-0000-0000-0000000000ff' || 'mgr1')::uuid,  'mgr1@demo.example',  'authenticated', 'authenticated', now(), now(), now()),
  (md5('00000000-0000-0000-0000-0000000000ff' || 'mgr2')::uuid,  'mgr2@demo.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, manager_id, full_name, email, role_path) values
  (md5('00000000-0000-0000-0000-0000000000ff' || 'owner')::uuid, '00000000-0000-0000-0000-0000000000ff', 'admin',   'administrator', null,                                                                'Owner',  'owner@demo.example', 'demoowner'::ltree),
  (md5('00000000-0000-0000-0000-0000000000ff' || 'mgr1')::uuid,  '00000000-0000-0000-0000-0000000000ff', 'manager', 'sales_manager', md5('00000000-0000-0000-0000-0000000000ff' || 'owner')::uuid, 'Mgr One', 'mgr1@demo.example', 'demoowner.mgr1'::ltree),
  (md5('00000000-0000-0000-0000-0000000000ff' || 'mgr2')::uuid,  '00000000-0000-0000-0000-0000000000ff', 'manager', 'sales_manager', md5('00000000-0000-0000-0000-0000000000ff' || 'owner')::uuid, 'Mgr Two', 'mgr2@demo.example', 'demoowner.mgr2'::ltree);

-- ── Seed 30 bulk reps and check they landed correctly. ──
do $$
declare
  v_org uuid := '00000000-0000-0000-0000-0000000000ff';
  v_ids uuid[];
  n int;
begin
  perform public._seed_demo_bulk_reps(v_org, md5(v_org::text || 'owner')::uuid, 30);
  select array_agg(md5(v_org::text || 'brep' || g)::uuid) into v_ids from generate_series(1, 30) g;

  select count(*) into n from profiles where org_id = v_org and id = any(v_ids);
  if n <> 30 then raise exception 'expected 30 bulk reps, got %', n; end if;

  select count(*) into n from profiles where id = any(v_ids) and role_level = 'sales_professional';
  if n <> 30 then raise exception 'all bulk reps should be sales_professional, got % of 30', n; end if;

  select count(*) into n from profiles
   where id = any(v_ids)
     and manager_id in (md5(v_org::text || 'mgr1')::uuid, md5(v_org::text || 'mgr2')::uuid);
  if n <> 30 then raise exception 'all bulk reps should report to mgr1/mgr2, got % of 30', n; end if;

  -- Non-login: no password on the synthetic auth.users rows.
  select count(*) into n from auth.users where id = any(v_ids) and encrypted_password is null;
  if n <> 30 then raise exception 'bulk reps must be non-login (null password), got % of 30', n; end if;
end $$;

-- ── Re-runnable: calling again does not duplicate (still 30, not 60). ──
do $$
declare
  v_org uuid := '00000000-0000-0000-0000-0000000000ff';
  n int;
begin
  perform public._seed_demo_bulk_reps(v_org, md5(v_org::text || 'owner')::uuid, 30);
  select count(*) into n from profiles where org_id = v_org and role_level = 'sales_professional';
  if n <> 30 then raise exception 're-running should keep 30 bulk reps, got %', n; end if;
end $$;

rollback;
