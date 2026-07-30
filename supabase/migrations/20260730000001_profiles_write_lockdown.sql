-- Security fix: close the self-service privilege-escalation hole on profiles.
--
-- The profiles_update policy (last defined in 20260518000003) pinned exactly
-- three columns in its WITH CHECK:
--
--   with check (id = auth.uid() and org_id = user_org_id() and role = user_role())
--
-- That was complete when it was written. Every authorization-bearing column
-- added to profiles afterwards was left unconstrained, so a rep could PATCH
-- their own row through PostgREST and rewrite it:
--
--   role_level      (20260722000002) → 'administrator' passes the WITH CHECK
--                   because `role` is untouched. role_level is the gate for
--                   admin_set_role_level / admin_bulk_invite / admin_set_manager
--                   / update_org_value_bands, all SECURITY DEFINER and granted
--                   to `authenticated`. admin_bulk_invite then mints a genuine
--                   administrator invite (legacy role='admin' is derived from
--                   role_level at 20260722000003) and admin_resend_invite hands
--                   the token straight back to the caller → full org admin.
--   role_path       (20260528000001) → NULL makes user_can_see_owner() hit its
--                   backward-compat "caller has no path, show everything"
--                   branch, which is ANDed into the SELECT policies for deals,
--                   activities, coverage_snapshot and persistence_index_snapshot
--                   (plus team_leaderboard / coverage_rollup /
--                   appointments_awaiting_rollup). A leaf rep goes from
--                   own-records-only to reading the whole org's pipeline and
--                   every colleague's performance scores. A shallow ltree value
--                   instead of NULL grafts them onto a chosen manager's subtree.
--   deactivated_at  (20260523000001) → USING (id = auth.uid()) still matches a
--                   soft-deactivated user (their JWT keeps working), so they
--                   could null it and undo admin_deactivate_member. That
--                   defeats admin_reactivate_member, which is deliberately
--                   admin-only "to keep privilege escalation impossible".
--   manager_id      (20260714000004) → same hierarchy predicate as role_path.
--
-- Fix: stop patching the column list and make the table fail closed instead.
-- Nothing writes profiles as the end user. Every legitimate write already goes
-- through a SECURITY DEFINER function (handle_new_user_signup,
-- claim_invite_code, admin_set_role, admin_set_role_level, admin_set_manager,
-- admin_deactivate_member, admin_reactivate_member, rebuild_role_path_subtree,
-- delete_own_account), which runs as the owner and is unaffected by both layers
-- below. The frontend only ever SELECTs profiles; the settings page saves
-- full_name to auth.users user_metadata, not here. Verified: zero
-- .update()/.upsert()/.insert() call sites against "profiles" in apps/app/src.
--
-- This also matches how INSERT on profiles already works: there is no
-- profiles_insert policy, so direct client inserts are already denied and
-- signup flows through the trigger. UPDATE now behaves the same way.
--
-- Two independent layers, so re-introducing one hole is not enough to reopen
-- the vulnerability:
--   1. Column privileges: authenticated/anon simply cannot UPDATE the table.
--      Crucially this is deny-by-default for columns added in FUTURE
--      migrations, which is the actual root cause here.
--   2. RLS: with the policy dropped, RLS denies every UPDATE for any role that
--      does not bypass RLS, even if someone re-GRANTs the table privilege.
--
-- To add narrow self-service editing later, do it deliberately and explicitly,
-- e.g. for a display-name field:
--   grant update (full_name) on profiles to authenticated;
--   create policy profiles_update_self on profiles for update to authenticated
--     using (id = auth.uid()) with check (id = auth.uid());
-- The column-level grant is what keeps that safe: listing full_name does not
-- silently extend to role_level, role_path, manager_id or deactivated_at.
--
-- Idempotent / safe to re-run.

-- ── Layer 1: revoke the table privilege ──
revoke update on profiles from authenticated;
revoke update on profiles from anon;

-- ── Layer 2: remove the permissive policy (RLS then denies by default) ──
drop policy if exists profiles_update on profiles;

-- ── Layer 3: close the alternate RPC route to role_path ──
-- rebuild_role_path_subtree is the internal helper that recomputes role_path for
-- a member and their whole subtree. It is plain `language sql` (SECURITY
-- INVOKER) with no REVOKE, and Postgres grants EXECUTE on new functions to
-- PUBLIC by default, so it is callable over PostgREST as
-- `POST /rest/v1/rpc/rebuild_role_path_subtree`. Under the old policy that was a
-- second way to rewrite your own role_path, independent of a direct PATCH.
--
-- The revoke below is belt and braces: once UPDATE on profiles is revoked, a
-- direct client call already fails on the privilege check. Removing EXECUTE
-- makes the intent explicit and keeps the helper internal, matching how the
-- demo seeders are locked down in 20260723000001.
--
-- The legitimate callers are unaffected: admin_set_manager,
-- admin_set_role_level, admin_set_role and claim_invite_code are all SECURITY
-- DEFINER, so the nested call runs as the function owner, which retains EXECUTE
-- implicitly as owner and bypasses both RLS and the column privileges.
revoke all on function public.rebuild_role_path_subtree(uuid) from public;
revoke all on function public.rebuild_role_path_subtree(uuid) from anon;
revoke all on function public.rebuild_role_path_subtree(uuid) from authenticated;

comment on table profiles is
  'User profile + org membership. Writes are SECURITY DEFINER only: UPDATE is '
  'revoked from authenticated/anon and there is no UPDATE or INSERT policy, so '
  'role_level / role_path / manager_id / deactivated_at cannot be self-assigned. '
  'See 20260730000001_profiles_write_lockdown.sql before adding a write path.';
