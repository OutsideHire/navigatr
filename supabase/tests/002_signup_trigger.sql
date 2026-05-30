-- Tests for the handle_new_user_signup trigger on auth.users INSERT.
--
-- Behavior under test (current, post-self-serve-org-creation):
--   * email signup WITH a valid live-org invite code -> profile created
--     (first user = manager, subsequent = rep).            [cases 1, 2]
--   * email signup with NO / invalid / disabled-org code  -> NO raise, NO
--     profile; the user is left for the frontend to route to
--     /create-organization (self-serve path, see 006).     [cases 3, 4, 5]
--   * OAuth signup (provider != 'email')                   -> trigger no-ops.
--                                                            [case 6]
--
-- HISTORY: cases 3/4/5 previously asserted the trigger RAISED
-- 'signup_requires_invite_code' / 'invalid_invite_code'. That raising
-- behavior was removed when self-serve org creation landed (migration
-- 20260529000003) — a missing or bad invite code is now a valid profile-less
-- state, not an error. These cases now assert the no-raise contract.
--
-- Run with the service-role connection (which bypasses RLS but still fires
-- triggers on auth.users INSERTs):
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/002_signup_trigger.sql
--
-- The script self-cleans on success (rolls back the wrapping transaction).
-- Each `do` block raises on failure, leaving you with a clear error.

begin;

-- Seed: a fresh org with a known invite code, and a second disabled org.
insert into organizations (id, name, slug, invite_code, is_disabled) values
  ('00000000-0000-0000-0000-000000000001', 'Test ISO', 'test-iso',     'test-iso-aaaa', false),
  ('00000000-0000-0000-0000-000000000002', 'Dead ISO', 'dead-iso',     'dead-iso-bbbb', true);

-- ---------------------------------------------------------------------------
-- Case 1: email signup with valid code — first user becomes manager.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at, email_confirmed_at)
values (
  '10000000-0000-0000-0000-000000000001',
  'first@test-iso.example',
  jsonb_build_object('invite_code', 'test-iso-aaaa', 'full_name', 'First User'),
  jsonb_build_object('provider', 'email'),
  'authenticated', 'authenticated', now(), now(), now()
);

do $$
declare r profiles%rowtype;
begin
  select * into r from profiles where id = '10000000-0000-0000-0000-000000000001';
  if r.org_id <> '00000000-0000-0000-0000-000000000001' then
    raise exception 'case1: wrong org_id %', r.org_id;
  end if;
  if r.role <> 'manager' then
    raise exception 'case1: expected role=manager got %', r.role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Case 2: second email signup with same code — becomes rep.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at, email_confirmed_at)
values (
  '10000000-0000-0000-0000-000000000002',
  'second@test-iso.example',
  jsonb_build_object('invite_code', 'test-iso-aaaa'),
  jsonb_build_object('provider', 'email'),
  'authenticated', 'authenticated', now(), now(), now()
);

do $$
declare r profiles%rowtype;
begin
  select * into r from profiles where id = '10000000-0000-0000-0000-000000000002';
  if r.role <> 'rep' then
    raise exception 'case2: expected role=rep got %', r.role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Case 3: email signup with NO invite_code — trigger returns early, leaving
-- the user profile-less. The auth.users row is a legitimate signup and stays;
-- the frontend routes the user to /create-organization (the self-serve path
-- covered by 006_create_organization.sql).
--
-- NOTE: an earlier version of handle_new_user_signup RAISED
-- 'signup_requires_invite_code' here. That was removed when self-serve org
-- creation landed — a missing code is now a valid state, not an error.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at, email_confirmed_at)
values (
  '10000000-0000-0000-0000-000000000003',
  'noinvite@test-iso.example',
  '{}'::jsonb,
  jsonb_build_object('provider', 'email'),
  'authenticated', 'authenticated', now(), now(), now()
);

do $$
declare c int;
begin
  -- The signup row persists (it did not raise / roll back).
  select count(*) into c from auth.users where id = '10000000-0000-0000-0000-000000000003';
  if c <> 1 then raise exception 'case3: expected auth.users row to persist, found %', c; end if;
  -- But no profile was created — the user has not picked/created an org yet.
  select count(*) into c from profiles where id = '10000000-0000-0000-0000-000000000003';
  if c <> 0 then raise exception 'case3: trigger should not create a profile without an invite code'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Case 4: invalid invite_code — trigger returns early, no profile. (Same
-- no-raise contract as case 3; the bad code is surfaced later at AcceptInvite.)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at, email_confirmed_at)
values (
  '10000000-0000-0000-0000-000000000004',
  'badcode@test-iso.example',
  jsonb_build_object('invite_code', 'does-not-exist'),
  jsonb_build_object('provider', 'email'),
  'authenticated', 'authenticated', now(), now(), now()
);

do $$
declare c int;
begin
  select count(*) into c from profiles where id = '10000000-0000-0000-0000-000000000004';
  if c <> 0 then raise exception 'case4: trigger should not create a profile for an invalid invite code'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Case 5: disabled-org invite_code — trigger returns early, no profile. The
-- code matches a row, but `not o.is_disabled` filters it out, so the lookup
-- finds nothing and the trigger leaves the user profile-less.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at, email_confirmed_at)
values (
  '10000000-0000-0000-0000-000000000005',
  'dead@dead-iso.example',
  jsonb_build_object('invite_code', 'dead-iso-bbbb'),
  jsonb_build_object('provider', 'email'),
  'authenticated', 'authenticated', now(), now(), now()
);

do $$
declare c int;
begin
  select count(*) into c from profiles where id = '10000000-0000-0000-0000-000000000005';
  if c <> 0 then raise exception 'case5: trigger should not create a profile for a disabled org'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Case 6: OAuth signup (provider != 'email') — trigger returns early, no profile.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at, email_confirmed_at)
values (
  '10000000-0000-0000-0000-000000000006',
  'oauth@test-iso.example',
  jsonb_build_object('full_name', 'Google User'),
  jsonb_build_object('provider', 'google'),
  'authenticated', 'authenticated', now(), now(), now()
);

do $$
declare c int;
begin
  select count(*) into c from profiles where id = '10000000-0000-0000-0000-000000000006';
  if c <> 0 then raise exception 'case6: trigger should not have created profile for OAuth user'; end if;
end $$;

\echo 'ALL TRIGGER TESTS PASSED'

rollback;
