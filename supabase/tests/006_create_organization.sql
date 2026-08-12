-- Tests for the self-serve org bootstrap RPC create_organization(p_name).
--
-- This is the path a user takes when they sign up WITHOUT an invite code:
-- the signup trigger leaves them profile-less, the frontend routes them to
-- /create-organization, and that page calls this RPC to mint an org + their
-- manager profile in one shot.
--
-- WHY THIS FILE EXISTS: on 2026-05-29 rpatton@gmail.com became the first user
-- to exercise this path in production and hit "Could not create workspace".
-- Root cause: profiles.email went NOT NULL on 2026-05-23, but this RPC (written
-- earlier) still inserted profiles without an email — a NOT NULL violation that
-- stayed latent for 6 days because nothing exercised this path. A test that
-- called the RPC against the live schema would have caught it the same day.
-- So: this test asserts, above all else, that the created profile has email
-- populated. Don't let that assertion get deleted.
--
-- Run with the service-role / postgres connection (bypasses RLS, but the RPC
-- is SECURITY DEFINER so it runs as owner regardless):
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/006_create_organization.sql
--
-- Self-cleans on success (rolls back the wrapping transaction). Each `do`
-- block raises on failure with a clear, case-tagged message.

begin;

-- ---------------------------------------------------------------------------
-- Seed: two auth.users with NO profiles (they signed up without an invite).
-- MUST be inserted before we switch role to 'authenticated' — the role is
-- sticky for the rest of the transaction and 'authenticated' can't write
-- auth.users.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at, email_confirmed_at)
values
  ('20000000-0000-0000-0000-000000000001',
   'founder@selfserve.example',
   jsonb_build_object('full_name', 'Pat Founder'),
   jsonb_build_object('provider', 'email'),
   'authenticated', 'authenticated', now(), now(), now()),
  ('20000000-0000-0000-0000-000000000002',
   'second@selfserve.example',
   '{}'::jsonb,
   jsonb_build_object('provider', 'email'),
   'authenticated', 'authenticated', now(), now(), now());

-- Simulate an authenticated request from the first user. auth.uid() reads
-- request.jwt.claim.sub. We set the 'role' GUC (mirrors PostgREST) but do
-- NOT actually `set role authenticated` — the connection stays as the owner
-- so RLS is bypassed for the test's own verification SELECTs below, while
-- the RPC (SECURITY DEFINER) and auth.uid() behave exactly as in prod.
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select set_config('role', 'authenticated', true);

-- ---------------------------------------------------------------------------
-- Case 1: happy path — first self-serve user gets an org + administrator profile.
-- This is the exact flow rpatton couldn't complete.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id uuid;
  v_role   user_role;
  v_code   text;
  p        profiles%rowtype;
  o        organizations%rowtype;
begin
  select org_id, role, invite_code
    into v_org_id, v_role, v_code
    from create_organization('Acme Payments');

  if v_org_id is null then
    raise exception 'case1: create_organization returned null org_id';
  end if;
  -- create_organization returns 'admin' since the role_level foundation
  -- (20260722000002): the creator is the org's Administrator. Said 'manager'
  -- until 2026-08-13, describing pre-July behaviour.
  if v_role <> 'admin' then
    raise exception 'case1: expected returned role=admin got %', v_role;
  end if;
  if v_code is null or length(v_code) <> 8 then
    raise exception 'case1: expected 8-char invite_code got %', v_code;
  end if;

  -- The profile must exist...
  select * into p from profiles where id = '20000000-0000-0000-0000-000000000001';
  if not found then
    raise exception 'case1: no profile row created for the caller';
  end if;
  -- ...and THIS is the assertion that would have caught the prod bug: email
  -- is NOT NULL on profiles, and the RPC must populate it from auth.users.
  if p.email is null or p.email <> 'founder@selfserve.example' then
    raise exception 'case1: profile email not populated correctly, got %', p.email;
  end if;
  if p.role <> 'admin' then
    raise exception 'case1: profile role expected admin got %', p.role;
  end if;
  if p.org_id <> v_org_id then
    raise exception 'case1: profile org_id % does not match returned %', p.org_id, v_org_id;
  end if;
  if p.full_name <> 'Pat Founder' then
    raise exception 'case1: expected full_name from metadata, got %', p.full_name;
  end if;

  -- And the organization should exist with a sensible slug.
  select * into o from organizations where id = v_org_id;
  if o.name <> 'Acme Payments' then
    raise exception 'case1: org name expected "Acme Payments" got %', o.name;
  end if;
  if o.slug <> 'acme-payments' then
    raise exception 'case1: slug expected acme-payments got %', o.slug;
  end if;
  if o.invite_code <> v_code then
    raise exception 'case1: org invite_code % != returned %', o.invite_code, v_code;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Case 2: same user calls again — one-profile-per-user guard rejects.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform create_organization('Second Workspace');
    raise exception 'case2: expected already_in_organization, but call succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%already_in_organization%' then
      raise exception 'case2: wrong error %', sqlerrm;
    end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Case 3: name too short — switch to the second (profile-less) user and try a
-- 1-char name. Validates the guard fires before any insert.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);

do $$
begin
  begin
    perform create_organization('A');
    raise exception 'case3: expected org_name_too_short, but call succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%org_name_too_short%' then
      raise exception 'case3: wrong error %', sqlerrm;
    end if;
  end;
  -- No profile should have been created on the failed call.
  if exists (select 1 from profiles where id = '20000000-0000-0000-0000-000000000002') then
    raise exception 'case3: a profile was created despite name-too-short rejection';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Case 4: slug collision falls back to a numbered slug. The second user
-- (still profile-less) creates an org whose name slugifies to "acme-payments"
-- — already taken by case 1 — and should get "acme-payments-2".
-- ---------------------------------------------------------------------------
do $$
declare
  v_org_id uuid;
  o        organizations%rowtype;
begin
  select org_id into v_org_id from create_organization('Acme Payments');
  select * into o from organizations where id = v_org_id;
  if o.slug <> 'acme-payments-2' then
    raise exception 'case4: expected slug acme-payments-2 on collision, got %', o.slug;
  end if;
end $$;

\echo 'ALL create_organization TESTS PASSED'

rollback;
