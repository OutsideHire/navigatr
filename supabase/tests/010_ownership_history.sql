-- Tests for migration 20260820000004_hier_bundle1_ownership_history
-- (PRD 6.12.A Bundle 1, FR-HIER-01 + FR-HIER-02).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/010_ownership_history.sql
--
-- Self-cleans via the wrapping transaction's ROLLBACK. Verifies that:
--   * deal ownership changes are captured (initial + reassignment),
--   * reporting-line changes are captured (initial + manager change + role change),
--   * the history is append-only (no UPDATE/DELETE policy),
--   * the audit read is admin-only.

begin;

-- ─── Seed: org + admin + rep ──────────────────────────────────────────
insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000c1', 'History Test', 'hist-test', 'hist-test-aaaa');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('60000000-0000-0000-0000-000000000001', 'admin@hist.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('60000000-0000-0000-0000-000000000002', 'rep@hist.example',   'authenticated', 'authenticated', now(), now(), now());

-- admin inserted first (no manager); rep reports to admin at creation. Each
-- insert fires the reporting-line capture trigger.
insert into profiles (id, org_id, role, full_name, email, manager_id) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'admin', 'Admin', 'admin@hist.example', null),
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', 'rep',   'Rep',   'rep@hist.example',   '60000000-0000-0000-0000-000000000001');

-- A deal owned by the rep (fires the deal-owner capture trigger, initial row).
insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('61000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', '60000000-0000-0000-0000-000000000002', 'Hist Co', 'C', 'c@h.example', '+15550009001', 10000);

-- ─── FR-HIER-01: deal ownership history ───────────────────────────────
-- Initial assignment recorded (previous null, new = rep).
do $$
declare n int;
begin
  select count(*) into n from deal_owner_history
    where deal_id = '61000000-0000-0000-0000-000000000001'
      and previous_owner_id is null
      and new_owner_id = '60000000-0000-0000-0000-000000000002';
  if n <> 1 then raise exception 'deal history: expected 1 initial-assignment row, got %', n; end if;
end $$;

-- Reassign the deal to the admin -> one more row (previous = rep, new = admin).
update deals set owner_id = '60000000-0000-0000-0000-000000000001'
  where id = '61000000-0000-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from deal_owner_history
    where deal_id = '61000000-0000-0000-0000-000000000001'
      and previous_owner_id = '60000000-0000-0000-0000-000000000002'
      and new_owner_id = '60000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'deal history: expected 1 reassignment row, got %', n; end if;
  select count(*) into n from deal_owner_history where deal_id = '61000000-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'deal history: expected 2 rows total (initial + reassign), got %', n; end if;
end $$;

-- ─── FR-HIER-02: reporting-line history ───────────────────────────────
-- Initial placement recorded for the rep (new manager = admin).
do $$
declare n int;
begin
  select count(*) into n from reporting_line_history
    where user_id = '60000000-0000-0000-0000-000000000002'
      and previous_manager_id is null
      and new_manager_id = '60000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'reporting history: expected 1 initial-placement row, got %', n; end if;
end $$;

-- Change the rep's manager to null -> one more row (previous = admin, new null).
update profiles set manager_id = null where id = '60000000-0000-0000-0000-000000000002';
-- Change the rep's role_level -> one more row.
update profiles set role_level = 'sales_manager' where id = '60000000-0000-0000-0000-000000000002';
do $$
declare n int;
begin
  select count(*) into n from reporting_line_history
    where user_id = '60000000-0000-0000-0000-000000000002'
      and previous_manager_id = '60000000-0000-0000-0000-000000000001'
      and new_manager_id is null;
  if n <> 1 then raise exception 'reporting history: expected 1 manager-change row, got %', n; end if;
  select count(*) into n from reporting_line_history
    where user_id = '60000000-0000-0000-0000-000000000002'
      and previous_role_level = 'sales_professional'
      and new_role_level = 'sales_manager';
  if n <> 1 then raise exception 'reporting history: expected 1 role-change row, got %', n; end if;
end $$;

-- ─── Append-only: no UPDATE/DELETE/ALL policy on either history table ──
do $$
declare n int;
begin
  select count(*) into n from pg_policies
    where schemaname = 'public'
      and tablename in ('deal_owner_history', 'reporting_line_history')
      and cmd in ('UPDATE', 'DELETE', 'ALL');
  if n <> 0 then raise exception 'append-only: found % mutating policy(ies) on history tables', n; end if;
end $$;

-- ─── Audit read is admin-only ─────────────────────────────────────────
-- Admin sees the deal history rows.
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from deal_owner_history where deal_id = '61000000-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'audit read: admin should see 2 deal-history rows, got %', n; end if;
end $$;

-- Rep (non-admin) sees none (admin-only SELECT policy).
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', '60000000-0000-0000-0000-000000000002', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from deal_owner_history where deal_id = '61000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'audit read: non-admin rep should see 0 history rows, got %', n; end if;
end $$;

rollback;
