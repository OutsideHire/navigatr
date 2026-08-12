-- Regression tests for migration 20260730000001_profiles_write_lockdown.
--
-- Run with a service-role connection, AFTER applying the migration:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/008_profiles_write_lockdown.sql
--
-- Self-cleans via the wrapping transaction's rollback. Each case raises with a
-- clear label on failure.
--
-- These fail BEFORE the migration and pass after. The vulnerability: the
-- profiles_update policy pinned only id/org_id/role in its WITH CHECK, so a rep
-- could PATCH their own row through PostgREST and set role_level =
-- 'administrator' (full org admin via admin_bulk_invite), null out role_path
-- (org-wide read of every colleague's deals, activities and scores), null out
-- deactivated_at (self-reinstatement after being deactivated), or reassign
-- manager_id.
--
-- Each escalation case asserts on the STORED VALUE after the attempt, not just
-- on the error, so it passes whichever layer does the blocking (the revoked
-- column privilege raises insufficient_privilege; RLS with no UPDATE policy
-- would instead silently affect zero rows) and fails loudly if the write lands.
--
-- Fixture, one org:
--   admin   role_level administrator      (target for the negative RPC case)
--   rep     role_level sales_professional, role_path set, active
--   revoked role_level sales_professional, deactivated_at set

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000c1', 'Lockdown Test', 'lockdown-test', 'lockdown-aaaa');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('60000000-0000-0000-0000-000000000001', 'admin@lock.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('60000000-0000-0000-0000-000000000002', 'rep@lock.example',     'authenticated', 'authenticated', now(), now(), now()),
  ('60000000-0000-0000-0000-000000000003', 'revoked@lock.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email, role_level, role_path, deactivated_at) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1',
   'admin', 'Admin', 'admin@lock.example', 'administrator', null, null),
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1',
   'rep', 'Rep', 'rep@lock.example', 'sales_professional', 'urep'::ltree, null),
  ('60000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c1',
   'rep', 'Revoked', 'revoked@lock.example', 'sales_professional', 'urevoked'::ltree, now());

-- ───────────────────────────────────────────────────────────────────
-- Case 1: the UPDATE privilege is gone for both client roles
-- ───────────────────────────────────────────────────────────────────
-- Asserted via has_table_privilege rather than by inspecting the REVOKE, so a
-- residual grant by any other route (a PUBLIC grant, a later re-GRANT) is
-- caught too.
do $$
begin
  if has_table_privilege('authenticated', 'profiles', 'UPDATE') then
    raise exception 'case1: authenticated still holds UPDATE on profiles';
  end if;
  if has_table_privilege('anon', 'profiles', 'UPDATE') then
    raise exception 'case1: anon still holds UPDATE on profiles';
  end if;
  -- SELECT must survive: the app reads profiles on every page load.
  if not has_table_privilege('authenticated', 'profiles', 'SELECT') then
    raise exception 'case1: authenticated lost SELECT on profiles (app would break)';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Case 2: no UPDATE policy remains (the second, independent layer)
-- ───────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'profiles'
     and cmd in ('UPDATE', 'ALL');
  if n <> 0 then
    raise exception 'case2: expected 0 UPDATE/ALL policies on profiles, found %', n;
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass) then
    raise exception 'case2: RLS is not enabled on profiles';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Cases 3-6: an active rep cannot escalate by writing their own row
-- ───────────────────────────────────────────────────────────────────
select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000002', true);
set local role authenticated;

-- Case 3: the headline escalation. role_level is the gate for
-- admin_set_role_level / admin_bulk_invite / admin_set_manager /
-- update_org_value_bands, all SECURITY DEFINER and granted to authenticated.
do $$
declare v_level role_level;
begin
  begin
    update profiles set role_level = 'administrator'
     where id = '60000000-0000-0000-0000-000000000002';
  exception when insufficient_privilege then
    null;  -- expected
  end;
  select role_level into v_level from profiles
   where id = '60000000-0000-0000-0000-000000000002';
  if v_level <> 'sales_professional' then
    raise exception 'case3: rep escalated own role_level to %', v_level;
  end if;
end $$;

-- Case 4: role_path drives hierarchy visibility through user_can_see_owner().
-- NULL hits its "caller has no path, show everything" branch, which is ANDed
-- into the SELECT policies for deals, activities, coverage_snapshot and
-- persistence_index_snapshot.
do $$
declare v_path ltree;
begin
  begin
    update profiles set role_path = null
     where id = '60000000-0000-0000-0000-000000000002';
  exception when insufficient_privilege then
    null;  -- expected
  end;
  select role_path into v_path from profiles
   where id = '60000000-0000-0000-0000-000000000002';
  if v_path is distinct from 'urep'::ltree then
    raise exception 'case4: rep changed own role_path to %', coalesce(v_path::text, 'NULL');
  end if;
end $$;

-- Case 5: a shallow ltree instead of NULL is the targeted variant, grafting the
-- rep onto a chosen manager's subtree. Must be blocked the same way.
do $$
declare v_path ltree;
begin
  begin
    update profiles set role_path = 'uadmin'::ltree
     where id = '60000000-0000-0000-0000-000000000002';
  exception when insufficient_privilege then
    null;  -- expected
  end;
  select role_path into v_path from profiles
   where id = '60000000-0000-0000-0000-000000000002';
  if v_path is distinct from 'urep'::ltree then
    raise exception 'case5: rep grafted own role_path to %', coalesce(v_path::text, 'NULL');
  end if;
end $$;

-- Case 6: manager_id feeds the same hierarchy predicate as role_path.
do $$
declare v_mgr uuid;
begin
  begin
    update profiles set manager_id = '60000000-0000-0000-0000-000000000001'
     where id = '60000000-0000-0000-0000-000000000002';
  exception when insufficient_privilege then
    null;  -- expected
  end;
  select manager_id into v_mgr from profiles
   where id = '60000000-0000-0000-0000-000000000002';
  if v_mgr is not null then
    raise exception 'case6: rep assigned own manager_id to %', v_mgr;
  end if;
end $$;

-- Case 6b: the alternate RPC route to role_path is closed too.
-- rebuild_role_path_subtree is SECURITY INVOKER and, absent a REVOKE, Postgres
-- grants EXECUTE to PUBLIC, so it was callable as
-- POST /rest/v1/rpc/rebuild_role_path_subtree.
do $$
declare v_path ltree;
begin
  -- Asserted via has_function_privilege rather than by calling the function and
  -- catching insufficient_privilege.
  --
  -- The original version invoked it. That reliably segfaulted Postgres in CI
  -- ("server process was terminated by signal 11"), taking the rest of the
  -- suite down with it, while passing on the development machine. The EXECUTE
  -- revoke is demonstrably in effect in both (grants read as `postgres,
  -- service_role` in CI), so the function is not even running; the crash is in
  -- the surrounding machinery and is environment-specific.
  --
  -- Checking the grant is also the better test. It asserts the security
  -- property directly instead of inferring it from an exception, and it cannot
  -- be satisfied by the call failing for some unrelated reason.
  if has_function_privilege('authenticated', 'public.rebuild_role_path_subtree(uuid)', 'EXECUTE') then
    raise exception 'case6b: authenticated can execute rebuild_role_path_subtree';
  end if;

  -- And the row is untouched regardless.
  select role_path into v_path from profiles
   where id = '60000000-0000-0000-0000-000000000002';
  if v_path is distinct from 'urep'::ltree then
    raise exception 'case6b: role_path changed to %', coalesce(v_path::text, 'NULL');
  end if;
end $$;

-- Case 7: reads still work for the rep. This fix revokes writes, not access.
do $$
declare n int;
begin
  select count(*) into n from profiles where id = '60000000-0000-0000-0000-000000000002';
  if n <> 1 then
    raise exception 'case7: rep can no longer read own profile, got % rows', n;
  end if;
end $$;

reset role;

-- ───────────────────────────────────────────────────────────────────
-- Case 8: a deactivated member cannot reinstate themselves
-- ───────────────────────────────────────────────────────────────────
-- USING (id = auth.uid()) still matched a deactivated user, whose JWT keeps
-- working, so this previously undid admin_deactivate_member and defeated
-- admin_reactivate_member's deliberate admin-only gate.
select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000003', true);
set local role authenticated;

do $$
declare v_deact timestamptz;
begin
  begin
    update profiles set deactivated_at = null
     where id = '60000000-0000-0000-0000-000000000003';
  exception when insufficient_privilege then
    null;  -- expected
  end;
  select deactivated_at into v_deact from profiles
   where id = '60000000-0000-0000-0000-000000000003';
  if v_deact is null then
    raise exception 'case8: deactivated member reinstated themselves';
  end if;
end $$;

reset role;

-- ───────────────────────────────────────────────────────────────────
-- Case 9: the legitimate admin path still works
-- ───────────────────────────────────────────────────────────────────
-- The whole fix rests on every real write going through a SECURITY DEFINER
-- function, which runs as the owner and is unaffected by the revoke and the
-- dropped policy. If this case fails, the lockdown broke admin functionality.
select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000001', true);
set local role authenticated;

do $$
declare v_level role_level;
begin
  perform admin_set_role_level('60000000-0000-0000-0000-000000000002', 'sales_manager');
  select role_level into v_level from profiles
   where id = '60000000-0000-0000-0000-000000000002';
  if v_level <> 'sales_manager' then
    raise exception 'case9: admin_set_role_level did not apply, role_level is %',
      coalesce(v_level::text, 'NULL');
  end if;
end $$;

reset role;

-- ───────────────────────────────────────────────────────────────────
-- Case 10: that SECURITY DEFINER path is not itself a way around the lockdown
-- ───────────────────────────────────────────────────────────────────
select set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000002', true);
set local role authenticated;

do $$
declare blocked boolean := false;
begin
  begin
    -- The rep is sales_manager after case 9, still not an administrator.
    perform admin_set_role_level('60000000-0000-0000-0000-000000000001', 'sales_professional');
  exception when sqlstate 'P0001' then
    blocked := true;
    if sqlerrm not in ('forbidden', 'cannot_demote_sole_admin') then
      raise exception 'case10: expected forbidden, got "%"', sqlerrm;
    end if;
  end;
  if not blocked then
    raise exception 'case10: non-administrator was allowed to call admin_set_role_level';
  end if;
end $$;

reset role;

rollback;
