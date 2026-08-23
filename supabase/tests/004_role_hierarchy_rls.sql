-- Tests for migration 20260529000001_role_hierarchy_rls.
--
-- Run with service-role connection:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/004_role_hierarchy_rls.sql
--
-- Self-cleans via the wrapping transaction's rollback. Each `do $$` block
-- raises with a clear case label on failure.
--
-- Hierarchy under test:
--
--   ceo  (role_path = 'ceo')
--    └─ vp   (role_path = 'ceo.vp')
--        ├─ rep1  (role_path = 'ceo.vp.rep1')
--        └─ rep2  (role_path = 'ceo.vp.rep2')
--    └─ vp2  (role_path = 'ceo.vp2')      ← sibling subtree
--        └─ rep3  (role_path = 'ceo.vp2.rep3')
--   loner (role_path = NULL)               ← backward-compat control
--
-- Each user owns one deal so we can assert who sees what.

begin;

-- ───────────────────────────────────────────────────────────────────
-- Seed: org + 6 users + 6 deals
-- ───────────────────────────────────────────────────────────────────

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000b1', 'Hierarchy Test', 'hier-test', 'hier-test-aaaa');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('40000000-0000-0000-0000-000000000001', 'ceo@h.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000002', 'vp@h.example',    'authenticated', 'authenticated', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000003', 'rep1@h.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000004', 'rep2@h.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000005', 'vp2@h.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000006', 'rep3@h.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000007', 'loner@h.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('40000000-0000-0000-0000-000000000008', 'boss@h.example',  'authenticated', 'authenticated', now(), now(), now());

-- profiles.email is NOT NULL since 20260523000001_admin_portal. Seed must
-- include it. The values mirror the auth.users emails above.
insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'admin',   'CEO',   'ceo@h.example',   'ceo'::ltree),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', 'manager', 'VP',    'vp@h.example',    'ceo.vp'::ltree),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', 'rep',     'Rep 1', 'rep1@h.example',  'ceo.vp.rep1'::ltree),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b1', 'rep',     'Rep 2', 'rep2@h.example',  'ceo.vp.rep2'::ltree),
  ('40000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b1', 'manager', 'VP 2',  'vp2@h.example',   'ceo.vp2'::ltree),
  ('40000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000b1', 'rep',     'Rep 3', 'rep3@h.example',  'ceo.vp2.rep3'::ltree),
  ('40000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000b1', 'rep',     'Loner', 'loner@h.example', null),
  ('40000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000b1', 'admin',   'Boss',  'boss@h.example',  null);

-- One deal per user, owned by that user.
insert into deals (
  id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents
) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-000000000001', 'CEO Deal',   'C', 'c@x.example', '+15550000001', 10000),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-000000000002', 'VP Deal',    'V', 'v@x.example', '+15550000002', 20000),
  ('50000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-000000000003', 'Rep1 Deal',  'R', 'r1@x.example','+15550000003', 30000),
  ('50000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-000000000004', 'Rep2 Deal',  'R', 'r2@x.example','+15550000004', 40000),
  ('50000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-000000000005', 'VP2 Deal',   'V', 'v2@x.example','+15550000005', 50000),
  ('50000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-000000000006', 'Rep3 Deal',  'R', 'r3@x.example','+15550000006', 60000),
  ('50000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-000000000007', 'Loner Deal', 'L', 'l@x.example', '+15550000007', 70000);

-- ───────────────────────────────────────────────────────────────────
-- Activity fixtures — must be seeded UPFRONT, before any role-switching
-- test case runs. Once a `set_config('role', 'authenticated', true)`
-- fires inside a DO block, the role stays sticky for the rest of the
-- transaction, and subsequent inserts go through RLS instead of
-- bypassing it as superuser. The activities_insert policy requires
-- logged_by = auth.uid(), which wouldn't match if we tried to seed
-- after the assertions had set auth.uid to a different user.
insert into activities (org_id, deal_id, logged_by, type, disposition, occurred_at, outcome_notes) values
  ('00000000-0000-0000-0000-0000000000b1', '50000000-0000-0000-0000-000000000003',
   '40000000-0000-0000-0000-000000000002', 'call', 'positive_engagement', now(), 'vp note on rep1 deal'),
  ('00000000-0000-0000-0000-0000000000b1', '50000000-0000-0000-0000-000000000005',
   '40000000-0000-0000-0000-000000000002', 'call', 'positive_engagement', now(), 'vp note on vp2 deal');

-- Helper to count visible deals as a specific user. set_config seeds
-- the JWT-derived auth.uid() that RLS reads.
create or replace function _test_visible_deal_count(p_user uuid)
returns int language plpgsql as $$
declare
  c int;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into c from deals;
  return c;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 1: leaf user (rep1) sees ONLY their own deal
-- ───────────────────────────────────────────────────────────────────
-- FAIL CLOSED (PRD 6.12.A D-15 / FR-HIER-49). rep1 is a placed leaf with no
-- descendants. The loner has NULL role_path (unplaced) and is now HIDDEN from
-- placed non-admins (the old NULL-target fallback is removed). So rep1 sees:
--   own only = 1.
do $$
declare n int;
begin
  n := _test_visible_deal_count('40000000-0000-0000-0000-000000000003');
  if n <> 1 then
    raise exception 'case1: rep1 should see 1 (own only; unplaced loner hidden), got %', n;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 2: middle user (vp) sees own + 2 descendants (NOT the unplaced loner)
-- ───────────────────────────────────────────────────────────────────
-- vp sees: own + rep1 + rep2 (ltree descendants) = 3. The unplaced loner is
-- now hidden (fail closed).
do $$
declare n int;
begin
  n := _test_visible_deal_count('40000000-0000-0000-0000-000000000002');
  if n <> 3 then
    raise exception 'case2: vp should see 3 (own + 2 reps; loner hidden), got %', n;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 3: top user (ceo) sees full subtree (everyone with a role_path)
-- ───────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  n := _test_visible_deal_count('40000000-0000-0000-0000-000000000001');
  -- ceo is role=admin -> caller_is_admin() -> EXEMPT, full-org visibility
  -- (FR-HIER-49). Sees every deal in the org: ceo + vp + rep1 + rep2 + vp2 +
  -- rep3 + loner = 7. (boss owns no deal.)
  if n <> 7 then
    raise exception 'case3: admin ceo should see all 7 deals (admin-exempt), got %', n;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 4: sibling-subtree user (vp2) does NOT see vp's subtree
-- ───────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  n := _test_visible_deal_count('40000000-0000-0000-0000-000000000005');
  -- vp2 sees: own (vp2) + rep3 = 2. The unplaced loner is hidden (fail closed).
  -- Critically, vp2 does NOT see vp, rep1, rep2, ceo.
  if n <> 2 then
    raise exception 'case4: vp2 should see 2 (own subtree only; loner hidden), got %', n;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 5: fail closed — loner (unplaced, non-admin) sees ONLY their own
-- ───────────────────────────────────────────────────────────────────
-- The core of FR-HIER-49 / D-15, and the regression case for FR-HIER-54
-- (a user with no placement, whether never-placed or placement-removed —
-- both are NULL role_path — resolves to self-only, never org-wide).
do $$
declare n int;
begin
  n := _test_visible_deal_count('40000000-0000-0000-0000-000000000007');
  if n <> 1 then
    raise exception 'case5: unplaced non-admin loner should see 1 (own only), got %', n;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 5b: an UNPLACED administrator is still exempt (FR-HIER-49)
-- ───────────────────────────────────────────────────────────────────
-- boss is role=admin with NULL role_path. The admin exemption is checked
-- BEFORE the unplaced-caller fail-closed branch, so an org is never locked
-- out of its own data by an admin who has not been slotted into the tree.
-- boss sees every deal in the org (7; boss owns none).
do $$
declare n int;
begin
  n := _test_visible_deal_count('40000000-0000-0000-0000-000000000008');
  if n <> 7 then
    raise exception 'case5b: unplaced admin boss should see all 7 deals (admin-exempt), got %', n;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 6: explicit ltree check — vp2's deal is NOT visible to vp
-- ───────────────────────────────────────────────────────────────────
do $$
declare visible boolean;
begin
  perform set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000002'::text, true);
  perform set_config('role', 'authenticated', true);
  select exists (
    select 1 from deals where id = '50000000-0000-0000-0000-000000000005'
  ) into visible;
  if visible then
    raise exception 'case6: vp should NOT see vp2''s deal — hierarchy leak';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 7: explicit ltree check — vp's deal IS visible to ceo
-- ───────────────────────────────────────────────────────────────────
do $$
declare visible boolean;
begin
  perform set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001'::text, true);
  perform set_config('role', 'authenticated', true);
  select exists (
    select 1 from deals where id = '50000000-0000-0000-0000-000000000002'
  ) into visible;
  if not visible then
    raise exception 'case7: ceo should see vp''s deal — hierarchy descendant';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 8: own deal is always visible (priority 1)
-- ───────────────────────────────────────────────────────────────────
-- Edge case: even if some future change broke the hierarchy logic,
-- you must always see your own records.
do $$
declare visible boolean;
begin
  perform set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000003'::text, true);
  perform set_config('role', 'authenticated', true);
  select exists (
    select 1 from deals where id = '50000000-0000-0000-0000-000000000003'
  ) into visible;
  if not visible then
    raise exception 'case8: rep1 must always see own deal';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 9: activities inherit visibility from the PARENT DEAL
-- ───────────────────────────────────────────────────────────────────
-- The right semantic: if you can see the deal, you see its activities.
-- A rep should see their manager's notes on a deal they own. A user
-- outside the deal owner's subtree should NOT see the activity even
-- if they're a peer of whoever logged it.

-- Fixtures for these assertions were seeded at the top of the file,
-- before any role-switching DO blocks ran. See "Activity fixtures" comment.

do $$
declare visible boolean;
begin
  -- rep1 OWNS the deal the VP logged on → rep1 sees the activity.
  perform set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000003'::text, true);
  perform set_config('role', 'authenticated', true);
  select exists (
    select 1 from activities
    where deal_id = '50000000-0000-0000-0000-000000000003'
      and logged_by = '40000000-0000-0000-0000-000000000002'
  ) into visible;
  if not visible then
    raise exception 'case9a: rep1 should see manager''s note on own deal';
  end if;

  -- ceo sees vp's activity on rep1's deal (rep1 is in ceo's subtree).
  perform set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001'::text, true);
  perform set_config('role', 'authenticated', true);
  select exists (
    select 1 from activities
    where deal_id = '50000000-0000-0000-0000-000000000003'
      and logged_by = '40000000-0000-0000-0000-000000000002'
  ) into visible;
  if not visible then
    raise exception 'case9b: ceo should see vp''s activity on rep1''s deal';
  end if;

  -- vp2 does NOT see the activity on rep1's deal (rep1 outside vp2's subtree).
  perform set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000005'::text, true);
  perform set_config('role', 'authenticated', true);
  select exists (
    select 1 from activities
    where deal_id = '50000000-0000-0000-0000-000000000003'
  ) into visible;
  if visible then
    raise exception 'case9c: vp2 should NOT see activities on rep1''s deal (cross-subtree)';
  end if;

  -- rep1 does NOT see vp's activity on vp2's deal (vp2's deal isn't rep1's).
  perform set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000003'::text, true);
  perform set_config('role', 'authenticated', true);
  select exists (
    select 1 from activities
    where deal_id = '50000000-0000-0000-0000-000000000005'
  ) into visible;
  if visible then
    raise exception 'case9d: rep1 should NOT see activities on vp2''s deal';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 10: caller_role_path helper returns the correct ltree
-- ───────────────────────────────────────────────────────────────────
do $$
declare p ltree;
begin
  perform set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000002'::text, true);
  perform set_config('role', 'authenticated', true);
  select public.caller_role_path() into p;
  if p::text <> 'ceo.vp' then
    raise exception 'case10: caller_role_path() should return ceo.vp for vp, got %', p::text;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 11: profiles still org-wide visible (we did NOT gate profiles
--          on hierarchy; reps need to see manager names + Team page).
-- ───────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000003'::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from profiles where org_id = '00000000-0000-0000-0000-0000000000b1';
  -- rep1 should still see all 8 profiles in the org (no hierarchy gate
  -- on profiles_select per design decision). 8 = the original 7 + boss.
  if n <> 8 then
    raise exception 'case11: rep1 should see 8 org profiles, got % (profiles must stay org-wide)', n;
  end if;
end $$;

-- No explicit `drop function _test_visible_deal_count` here — by the time
-- this line would execute, set_config has switched the role to
-- 'authenticated' (sticky for the transaction), and 'authenticated' is
-- not the owner of the function so the drop would fail with a permission
-- error. The rollback below undoes the CREATE OR REPLACE FUNCTION
-- anyway, so the function never persists outside this transaction.

-- All cases passed. Wrapping ROLLBACK keeps the DB clean.
rollback;
