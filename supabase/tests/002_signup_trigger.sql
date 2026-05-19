-- Tests for migration 002 (handle_new_user_signup trigger + claim_invite_code RPC).
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
-- Case 3: missing invite_code on email signup raises and rolls back.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at, email_confirmed_at)
    values (
      '10000000-0000-0000-0000-000000000003',
      'noinvite@test-iso.example',
      '{}'::jsonb,
      jsonb_build_object('provider', 'email'),
      'authenticated', 'authenticated', now(), now(), now()
    );
    raise exception 'case3: expected trigger to raise, but insert succeeded';
  exception when sqlstate 'P0001' then
    -- expected. SQLERRM contains the raise message.
    if sqlerrm not like '%signup_requires_invite_code%' then
      raise exception 'case3: wrong error %', sqlerrm;
    end if;
  end;
end $$;

-- Confirm no orphan auth.users row exists.
do $$
declare c int;
begin
  select count(*) into c from auth.users where id = '10000000-0000-0000-0000-000000000003';
  if c <> 0 then raise exception 'case3: orphan auth.users row left behind'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Case 4: invalid invite_code raises.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at, email_confirmed_at)
    values (
      '10000000-0000-0000-0000-000000000004',
      'badcode@test-iso.example',
      jsonb_build_object('invite_code', 'does-not-exist'),
      jsonb_build_object('provider', 'email'),
      'authenticated', 'authenticated', now(), now(), now()
    );
    raise exception 'case4: expected trigger to raise';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%invalid_invite_code%' then
      raise exception 'case4: wrong error %', sqlerrm;
    end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Case 5: disabled org rejects signup.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at, email_confirmed_at)
    values (
      '10000000-0000-0000-0000-000000000005',
      'dead@dead-iso.example',
      jsonb_build_object('invite_code', 'dead-iso-bbbb'),
      jsonb_build_object('provider', 'email'),
      'authenticated', 'authenticated', now(), now(), now()
    );
    raise exception 'case5: expected disabled-org rejection';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%invalid_invite_code%' then
      raise exception 'case5: wrong error %', sqlerrm;
    end if;
  end;
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
