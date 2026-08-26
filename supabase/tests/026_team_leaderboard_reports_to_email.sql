-- Tests for migration 20260826000003_team_leaderboard_reports_to_email.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/026_team_leaderboard_reports_to_email.sql
--
-- Self-cleans via ROLLBACK. Verifies team_leaderboard now returns the
-- reports_to_email column and carries it for a PENDING invite whose manager is
-- ALSO a pending invite (manager_id null, reports_to_email set) -- the data the
-- org chart needs to nest a bulk-CSV-imported team before anyone accepts. Also
-- checks an active profile row exposes the column (null for a top-level admin).
--
-- Roles: team_leaderboard is SECURITY DEFINER and gates on auth.uid() (the
-- request.jwt.claim.sub GUC) + the caller's profile role, NOT the session role.
-- This script stays the (superuser) test role so direct fixture reads bypass
-- RLS, and only sets the jwt claim to act as the admin caller.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000ea', 'LB Org', 'lb-org', 'lb-org-code');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('ea000000-0000-0000-0000-000000000001', 'adminlb@t.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('ea000000-0000-0000-0000-000000000002', 'm2lb@t.example',    'authenticated', 'authenticated', now(), now(), now());

-- Admins carry a NULL role_path (rebuild_role_path_subtree yields null for
-- role='admin'); team_leaderboard's invite branch lists manager_id-null invites
-- only to a caller whose caller_role_path() is null, so the admin fixture MUST
-- have null role_path or the pending-invite rows this test asserts on are
-- filtered out.
insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('ea000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ea', 'admin',   'administrator', 'Admin LB', 'adminlb@t.example', null),
  ('ea000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000ea', 'manager', 'sales_manager', 'M2 LB',    'm2lb@t.example',    'm2'::ltree);

-- A manager invite (top of the imported team, no reporting line) and a rep
-- invite that reports to the manager BY EMAIL (manager_id still null: the
-- manager has no profile yet). This is exactly what admin_bulk_invite writes
-- for "manager + reps in one CSV".
-- A THIRD invite reports to the ALREADY-ACTIVE manager M2, so its manager_id
-- is resolved at invite time. Its reports_to_email must be SUPPRESSED (null) in
-- the RPC output: the resolved manager_id already points at a visible node, and
-- emitting a stale email there is the cross-scope leak the fix closes.
insert into org_invites (org_id, email, full_name, role, role_level, manager_id, reports_to_email, token, invited_by, expires_at) values
  ('00000000-0000-0000-0000-0000000000ea', 'mgrlb@t.example',  'Mgr LB',  'manager', 'sales_manager',      null,                                     null,               'tok-mgr-lb',  'ea000000-0000-0000-0000-000000000001', now() + interval '14 days'),
  ('00000000-0000-0000-0000-0000000000ea', 'replb@t.example',  'Rep LB',  'rep',     'sales_professional', null,                                     'mgrlb@t.example',  'tok-rep-lb',  'ea000000-0000-0000-0000-000000000001', now() + interval '14 days'),
  ('00000000-0000-0000-0000-0000000000ea', 'rep2lb@t.example', 'Rep2 LB', 'rep',     'sales_professional', 'ea000000-0000-0000-0000-000000000002', 'm2lb@t.example',   'tok-rep2-lb', 'ea000000-0000-0000-0000-000000000001', now() + interval '14 days');

-- ── The rep invite carries reports_to_email; the manager invite carries null;
--    the admin profile carries the column too (null). ──
do $$
declare
  v_rep_rte  text;
  v_rep_mgr  uuid;
  v_mgr_rte  text;
  v_admin_seen boolean;
  v_admin_rte text;
begin
  perform set_config('request.jwt.claim.sub', 'ea000000-0000-0000-0000-000000000001', true);

  select reports_to_email, manager_id into v_rep_rte, v_rep_mgr
    from team_leaderboard(30) where email = 'replb@t.example';
  if v_rep_rte is distinct from 'mgrlb@t.example' then
    raise exception 'rep invite must expose reports_to_email=mgrlb@t.example, got %', v_rep_rte;
  end if;
  if v_rep_mgr is not null then
    raise exception 'rep invite manager_id must still be null (manager unaccepted), got %', v_rep_mgr;
  end if;

  select reports_to_email into v_mgr_rte
    from team_leaderboard(30) where email = 'mgrlb@t.example';
  if v_mgr_rte is not null then
    raise exception 'manager invite reports_to_email must be null, got %', v_mgr_rte;
  end if;

  select true, reports_to_email into v_admin_seen, v_admin_rte
    from team_leaderboard(30) where email = 'adminlb@t.example';
  if v_admin_seen is not true then
    raise exception 'admin profile row must be returned';
  end if;
  if v_admin_rte is not null then
    raise exception 'admin profile reports_to_email must be null, got %', v_admin_rte;
  end if;
end $$;

-- ── Suppression: an invite whose manager_id is already resolved must NOT leak
--    its (now-redundant) reports_to_email through the RPC. ──
do $$
declare v_rte text; v_mgr uuid;
begin
  perform set_config('request.jwt.claim.sub', 'ea000000-0000-0000-0000-000000000001', true);
  select reports_to_email, manager_id into v_rte, v_mgr
    from team_leaderboard(30) where email = 'rep2lb@t.example';
  if v_mgr is distinct from 'ea000000-0000-0000-0000-000000000002'::uuid then
    raise exception 'rep2 invite manager_id must be the active manager M2, got %', v_mgr;
  end if;
  if v_rte is not null then
    raise exception 'rep2 invite reports_to_email must be suppressed (null) when manager_id is set, got %', v_rte;
  end if;
end $$;

rollback;
