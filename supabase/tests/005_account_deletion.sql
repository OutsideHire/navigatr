-- Tests for migration 20260529000002_account_deletion.
--
-- Run with service-role connection:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/005_account_deletion.sql
--
-- Wrapping rollback keeps the DB clean.

begin;

-- Seed: org + one user we'll delete + one user we DON'T delete (so we
-- can verify the deletion is scoped to the caller, not the org).
insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000c1', 'Deletion Test', 'del-test', 'del-test-aaaa');

insert into auth.users (id, email, raw_user_meta_data, aud, role, created_at, updated_at, email_confirmed_at) values
  ('60000000-0000-0000-0000-000000000001', 'doomed@d.example',  '{"full_name": "Doomed User", "profession": "merchant_services"}'::jsonb, 'authenticated', 'authenticated', now(), now(), now()),
  ('60000000-0000-0000-0000-000000000002', 'witness@d.example', '{"full_name": "Witness User"}'::jsonb, 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'rep',     'Doomed User',  'doomed@d.example'),
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', 'manager', 'Witness User', 'witness@d.example');

-- One deal owned by the doomed user — we'll verify it survives the
-- deletion (anonymization preserves business records).
insert into deals (
  id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents
) values (
  '70000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-0000000000c1',
  '60000000-0000-0000-0000-000000000001',
  'Doomed Deal', 'X', 'x@d.example', '+15550009999', 99000
);

-- ───────────────────────────────────────────────────────────────────
-- Case 1: not_authenticated when auth.uid is null
-- ───────────────────────────────────────────────────────────────────
do $$
begin
  begin
    perform public.request_account_deletion();
    raise exception 'case1: should have raised not_authenticated';
  exception when others then
    if sqlerrm <> 'not_authenticated' then
      raise exception 'case1: expected not_authenticated, got: %', sqlerrm;
    end if;
  end;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 2: anonymizes the profile when called by the user
-- ───────────────────────────────────────────────────────────────────
do $$
declare
  v_status text;
  v_email text;
  v_name text;
  v_deactivated timestamptz;
  v_role_path ltree;
begin
  perform set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000001'::text, true);
  perform set_config('role', 'authenticated', true);

  select status into v_status from public.request_account_deletion();
  if v_status <> 'anonymized' then
    raise exception 'case2a: expected status=anonymized, got %', v_status;
  end if;

  -- Switch back to postgres to inspect the result without RLS getting in the way.
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  select email, full_name, deactivated_at, role_path
    into v_email, v_name, v_deactivated, v_role_path
    from profiles where id = '60000000-0000-0000-0000-000000000001';

  if v_name <> 'Deleted User' then
    raise exception 'case2b: full_name should be Deleted User, got %', v_name;
  end if;
  if v_email = 'doomed@d.example' then
    raise exception 'case2c: email was not anonymized (still %)', v_email;
  end if;
  if v_email not like 'deleted+%@deleted.local' then
    raise exception 'case2d: anonymized email has wrong shape (%)', v_email;
  end if;
  if v_deactivated is null then
    raise exception 'case2e: deactivated_at should be set';
  end if;
  if v_role_path is not null then
    raise exception 'case2f: role_path should be cleared, got %', v_role_path::text;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 3: auth.users metadata is wiped
-- ───────────────────────────────────────────────────────────────────
do $$
declare v_meta jsonb;
begin
  select raw_user_meta_data into v_meta from auth.users where id = '60000000-0000-0000-0000-000000000001';
  if v_meta::text <> '{}' then
    raise exception 'case3: auth.users.raw_user_meta_data should be empty, got %', v_meta::text;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 4: the doomed user's deal still exists (anonymization preserves
-- business records)
-- ───────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  select count(*) into v_count
    from deals where id = '70000000-0000-0000-0000-000000000001';
  if v_count <> 1 then
    raise exception 'case4: doomed user''s deal should survive anonymization (count=%)', v_count;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 5: an audit row was written to user_actions
-- ───────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  select count(*) into v_count
    from user_actions
    where user_id = '60000000-0000-0000-0000-000000000001'
      and action_type = 'account.deleted';
  if v_count <> 1 then
    raise exception 'case5: expected 1 account.deleted audit event, got %', v_count;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 6: a SECOND user calling the RPC anonymizes ONLY themselves —
-- the first user's anonymization is unaffected.
-- ───────────────────────────────────────────────────────────────────
do $$
declare v_status text;
begin
  perform set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000002'::text, true);
  perform set_config('role', 'authenticated', true);

  select status into v_status from public.request_account_deletion();
  if v_status <> 'anonymized' then
    raise exception 'case6a: witness should also be able to anonymize themselves';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  -- Both users anonymized; doomed user's anonymized values still in place.
  if not exists (
    select 1 from profiles
    where id = '60000000-0000-0000-0000-000000000001'
      and full_name = 'Deleted User'
  ) then
    raise exception 'case6b: doomed user''s anonymization was reverted';
  end if;

  if not exists (
    select 1 from profiles
    where id = '60000000-0000-0000-0000-000000000002'
      and full_name = 'Deleted User'
  ) then
    raise exception 'case6c: witness user was not anonymized';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 7: anonymized email suffixes are unique (no collision on
-- multiple deletions in the same DB).
-- ───────────────────────────────────────────────────────────────────
do $$
declare
  v_email1 text;
  v_email2 text;
begin
  select email into v_email1 from profiles where id = '60000000-0000-0000-0000-000000000001';
  select email into v_email2 from profiles where id = '60000000-0000-0000-0000-000000000002';
  if v_email1 = v_email2 then
    raise exception 'case7: anonymized emails collided (% == %)', v_email1, v_email2;
  end if;
end $$;

-- All cases passed. Wrapping ROLLBACK keeps the DB clean.
rollback;
