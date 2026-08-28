-- Cross-tenant isolation: one ISO must NEVER see another ISO's data.
--
-- Run with a service-role connection (see tools/run-db-tests.sh):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/028_cross_org_isolation.sql
--
-- Self-cleans via the wrapping transaction's rollback. Each `do $$` block
-- raises with a clear case label on failure.
--
-- WHY THIS EXISTS (regression protocol, golden path #5). Every other RLS script
-- (004/008/019) seeds exactly ONE org and asserts WITHIN-org hierarchy scoping.
-- The predicate that separates tenant A from tenant B is therefore never
-- exercised: a regression in a base RLS policy, or a SECURITY DEFINER RPC that
-- forgets its org filter, would leak org A's pipeline to org B and still pass
-- CI. One ISO seeing another ISO's data is the single worst failure for a
-- multi-tenant beta, so it gets its own dedicated regression.
--
-- Shape under test, two independent orgs, each with an admin + a placed rep,
-- one deal per rep and one activity per deal:
--
--   Org A  admin_a (admin, role_path NULL, admin-exempt, the highest-risk path)
--          rep_a   (rep,   role_path 'a')  → deal A1 → activity on A1
--   Org B  admin_b (admin, role_path NULL)
--          rep_b   (rep,   role_path 'b')  → deal B1 → activity on B1
--
-- The critical assertion is that admin visibility (which is org-WIDE within an
-- org) is still org-BOUNDED: an admin sees everything in their own org and
-- nothing in the other. Assertions target the specific fixture orgs by id, so
-- the base-seed org (supabase/seed.sql runs before tests) never affects counts.

begin;

-- ───────────────────────────────────────────────────────────────────
-- Seed: two orgs + 4 users + 2 deals + 2 activities.
-- Everything is seeded UPFRONT, as superuser, before any DO block calls
-- set_config('role','authenticated'), that switch is sticky for the rest
-- of the transaction, so later inserts would otherwise go through RLS.
-- ───────────────────────────────────────────────────────────────────
insert into organizations (id, name, slug, invite_code) values
  ('aaaa0000-0000-4000-8000-0000000000a0', 'Org A Payments', 'org-a-iso', 'org-a-isolation'),
  ('bbbb0000-0000-4000-8000-0000000000b0', 'Org B Payments', 'org-b-iso', 'org-b-isolation');

-- auth.users seeded minimally (no invite_code metadata) so the signup trigger
-- does not run its first-user-is-admin logic; profiles are set explicitly below.
insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('aaaa0000-0000-4000-8000-0000000000a1', 'admin_a@iso.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('aaaa0000-0000-4000-8000-0000000000a2', 'rep_a@iso.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('bbbb0000-0000-4000-8000-0000000000b1', 'admin_b@iso.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('bbbb0000-0000-4000-8000-0000000000b2', 'rep_b@iso.example',   'authenticated', 'authenticated', now(), now(), now());

-- profiles.email is NOT NULL. Admins have NULL role_path (admin-exempt within
-- their org); reps are placed leaves.
insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('aaaa0000-0000-4000-8000-0000000000a1', 'aaaa0000-0000-4000-8000-0000000000a0', 'admin', 'Admin A', 'admin_a@iso.example', null),
  ('aaaa0000-0000-4000-8000-0000000000a2', 'aaaa0000-0000-4000-8000-0000000000a0', 'rep',   'Rep A',   'rep_a@iso.example',   'a'::ltree),
  ('bbbb0000-0000-4000-8000-0000000000b1', 'bbbb0000-0000-4000-8000-0000000000b0', 'admin', 'Admin B', 'admin_b@iso.example', null),
  ('bbbb0000-0000-4000-8000-0000000000b2', 'bbbb0000-0000-4000-8000-0000000000b0', 'rep',   'Rep B',   'rep_b@iso.example',   'b'::ltree);

insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('aaaa0000-0000-4000-8000-0000000000d1', 'aaaa0000-0000-4000-8000-0000000000a0', 'aaaa0000-0000-4000-8000-0000000000a2', 'Org A Deal', 'CA', 'ca@x.example', '+15550000101', 100000),
  ('bbbb0000-0000-4000-8000-0000000000d2', 'bbbb0000-0000-4000-8000-0000000000b0', 'bbbb0000-0000-4000-8000-0000000000b2', 'Org B Deal', 'CB', 'cb@x.example', '+15550000201', 200000);

insert into activities (org_id, deal_id, logged_by, type, disposition, occurred_at, outcome_notes) values
  ('aaaa0000-0000-4000-8000-0000000000a0', 'aaaa0000-0000-4000-8000-0000000000d1',
   'aaaa0000-0000-4000-8000-0000000000a2', 'drop_in', 'met_dm', now(), 'org A note'),
  ('bbbb0000-0000-4000-8000-0000000000b0', 'bbbb0000-0000-4000-8000-0000000000d2',
   'bbbb0000-0000-4000-8000-0000000000b2', 'drop_in', 'met_dm', now(), 'org B note');

-- Runs a query as a specific authenticated user (RLS in force).
create or replace function _iso_as_user(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 1: Org A ADMIN sees org A's deal but ZERO of org B's.
-- Admin visibility is org-wide but must stay org-BOUNDED, the highest-risk
-- leak path (an admin-exempt SECURITY DEFINER filter that forgets org_id).
-- ───────────────────────────────────────────────────────────────────
do $$
declare own int; other int;
begin
  perform _iso_as_user('aaaa0000-0000-4000-8000-0000000000a1');
  select count(*) into own   from deals where org_id = 'aaaa0000-0000-4000-8000-0000000000a0';
  select count(*) into other from deals where org_id = 'bbbb0000-0000-4000-8000-0000000000b0';
  if own < 1 then
    raise exception 'case1: admin A should see org A deal(s), saw %', own;
  end if;
  if other <> 0 then
    raise exception 'case1: admin A must see ZERO org B deals, saw % (CROSS-TENANT LEAK)', other;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 2: Org A REP sees own deal, ZERO of org B's deals.
-- ───────────────────────────────────────────────────────────────────
do $$
declare own_visible boolean; other int;
begin
  perform _iso_as_user('aaaa0000-0000-4000-8000-0000000000a2');
  select exists (select 1 from deals where id = 'aaaa0000-0000-4000-8000-0000000000d1') into own_visible;
  select count(*) into other from deals where org_id = 'bbbb0000-0000-4000-8000-0000000000b0';
  if not own_visible then
    raise exception 'case2: rep A must always see own deal';
  end if;
  if other <> 0 then
    raise exception 'case2: rep A must see ZERO org B deals, saw % (CROSS-TENANT LEAK)', other;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 3: symmetric, Org B ADMIN sees ZERO of org A's deals.
-- ───────────────────────────────────────────────────────────────────
do $$
declare other int;
begin
  perform _iso_as_user('bbbb0000-0000-4000-8000-0000000000b1');
  select count(*) into other from deals where org_id = 'aaaa0000-0000-4000-8000-0000000000a0';
  if other <> 0 then
    raise exception 'case3: admin B must see ZERO org A deals, saw % (CROSS-TENANT LEAK)', other;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 4: activities are org-bounded, org A users see ZERO org B activities.
-- ───────────────────────────────────────────────────────────────────
do $$
declare other int;
begin
  perform _iso_as_user('aaaa0000-0000-4000-8000-0000000000a1');
  select count(*) into other from activities where org_id = 'bbbb0000-0000-4000-8000-0000000000b0';
  if other <> 0 then
    raise exception 'case4: admin A must see ZERO org B activities, saw % (CROSS-TENANT LEAK)', other;
  end if;

  perform _iso_as_user('aaaa0000-0000-4000-8000-0000000000a2');
  select count(*) into other from activities where deal_id = 'bbbb0000-0000-4000-8000-0000000000d2';
  if other <> 0 then
    raise exception 'case4: rep A must see ZERO activities on org B deal, saw % (CROSS-TENANT LEAK)', other;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 5: profiles are org-wide WITHIN an org (reps need manager names /
-- the Team page) but must NOT cross the org boundary.
-- ───────────────────────────────────────────────────────────────────
do $$
declare other int;
begin
  perform _iso_as_user('aaaa0000-0000-4000-8000-0000000000a2');
  select count(*) into other from profiles where org_id = 'bbbb0000-0000-4000-8000-0000000000b0';
  if other <> 0 then
    raise exception 'case5: rep A must see ZERO org B profiles, saw % (CROSS-TENANT LEAK)', other;
  end if;
end $$;

-- No explicit drop of _iso_as_user: set_config has switched the role to
-- 'authenticated' (sticky), which is not the function owner, so a drop would
-- fail on permissions. The wrapping rollback removes it anyway.

rollback;
