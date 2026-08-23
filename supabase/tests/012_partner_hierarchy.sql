-- Tests for migration 20260820000006_hier_bundle2_partner_ownership
-- (PRD 6.12.A Bundle 2: partner ownership + hierarchy scope).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/012_partner_hierarchy.sql
--
-- Self-cleans via the wrapping transaction's ROLLBACK. Verifies:
--   * partners are visible only to the owner + their management chain (+ admin),
--   * partner touches inherit that visibility (FR-HIER-52) and a peer in a
--     sibling subtree sees none of them (FR-HIER-54),
--   * partner writes are owner-based: the owner and anyone above them can edit,
--     a peer cannot, and a peer cannot log a touch either (FR-HIER-15).
--
-- Hierarchy:  top (admin) -> mgr (manager) -> rep ;  peer is a sibling of mgr.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000c3', 'Partner Test', 'partner-test', 'partner-test-a');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('80000000-0000-0000-0000-000000000001', 'top@p.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('80000000-0000-0000-0000-000000000002', 'mgr@p.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('80000000-0000-0000-0000-000000000003', 'rep@p.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('80000000-0000-0000-0000-000000000004', 'peer@p.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c3', 'admin',   'Top',  'top@p.example',  'top'::ltree),
  ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c3', 'manager', 'Mgr',  'mgr@p.example',  'top.mgr'::ltree),
  ('80000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c3', 'rep',     'Rep',  'rep@p.example',  'top.mgr.rep'::ltree),
  ('80000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000c3', 'rep',     'Peer', 'peer@p.example', 'top.peer'::ltree);

-- One partner per owner. created_by mirrors the owner (seed convention).
insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('81000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c3', '80000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000003', 'Rep CPA',  'Rep CPA LLC',  'cpa'),
  ('81000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c3', '80000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', 'Mgr CPA',  'Mgr CPA LLC',  'cpa'),
  ('81000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c3', '80000000-0000-0000-0000-000000000004', '80000000-0000-0000-0000-000000000004', 'Peer CPA', 'Peer CPA LLC', 'cpa');

-- A touch on the rep-owned partner, logged by the rep. Seeded as superuser
-- (before any role switch) so RLS doesn't block the fixture.
insert into partner_activities (org_id, partner_id, logged_by, type, notes) values
  ('00000000-0000-0000-0000-0000000000c3', '81000000-0000-0000-0000-0000000000a1', '80000000-0000-0000-0000-000000000003', 'call', 'rep touch on rep partner');

-- Helpers: count visible partners / partner touches as a given caller.
create or replace function _pt_partners(p_user uuid) returns int language plpgsql as $$
declare c int; begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into c from partners;
  return c;
end $$;

create or replace function _pt_touches(p_user uuid) returns int language plpgsql as $$
declare c int; begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into c from partner_activities;
  return c;
end $$;

-- ─── Partner visibility (hierarchy scope) ─────────────────────────────
do $$
declare n int;
begin
  n := _pt_partners('80000000-0000-0000-0000-000000000003');       -- rep
  if n <> 1 then raise exception 'rep should see 1 partner (own), got %', n; end if;
  n := _pt_partners('80000000-0000-0000-0000-000000000002');       -- mgr
  if n <> 2 then raise exception 'mgr should see 2 partners (own + rep), got %', n; end if;
  n := _pt_partners('80000000-0000-0000-0000-000000000004');       -- peer
  if n <> 1 then raise exception 'peer should see 1 partner (own only), got %', n; end if;
  n := _pt_partners('80000000-0000-0000-0000-000000000001');       -- admin
  if n <> 3 then raise exception 'admin should see all 3 partners, got %', n; end if;
end $$;

-- ─── Partner-touch inheritance + peer isolation (FR-HIER-52 / 54) ─────
do $$
declare n int;
begin
  n := _pt_touches('80000000-0000-0000-0000-000000000003');        -- rep (own)
  if n <> 1 then raise exception 'rep should see 1 touch (own partner), got %', n; end if;
  n := _pt_touches('80000000-0000-0000-0000-000000000002');        -- mgr (subtree)
  if n <> 1 then raise exception 'mgr should see 1 touch (rep partner in subtree), got %', n; end if;
  n := _pt_touches('80000000-0000-0000-0000-000000000001');        -- admin
  if n <> 1 then raise exception 'admin should see 1 touch, got %', n; end if;
  n := _pt_touches('80000000-0000-0000-0000-000000000004');        -- peer (sibling)
  if n <> 0 then raise exception 'FR-HIER-54: peer should see 0 touches, got %', n; end if;
end $$;

-- ─── Owner-based writes (FR-HIER-15) via UPDATE row counts ────────────
do $$
declare n int;
begin
  -- rep edits own partner -> allowed.
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000003', true);
  perform set_config('role', 'authenticated', true);
  update partners set notes = 'rep edit' where id = '81000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'rep should edit own partner (1 row), got %', n; end if;

  -- rep edits the manager's partner (up the tree) -> denied (0 rows).
  update partners set notes = 'rep sneaking' where id = '81000000-0000-0000-0000-0000000000a2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'rep must NOT edit manager partner, affected %', n; end if;
end $$;

do $$
declare n int;
begin
  -- mgr edits rep's partner (down the tree) -> allowed.
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000002', true);
  perform set_config('role', 'authenticated', true);
  update partners set notes = 'mgr edit' where id = '81000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'mgr should edit rep partner (1 row), got %', n; end if;
end $$;

do $$
declare n int;
begin
  -- peer edits rep's partner (sibling subtree) -> denied.
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000004', true);
  perform set_config('role', 'authenticated', true);
  update partners set notes = 'peer sneaking' where id = '81000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'peer must NOT edit rep partner, affected %', n; end if;
end $$;

-- ─── Peer cannot log a touch on a partner they cannot see ─────────────
do $$
declare denied boolean := false;
begin
  perform set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000004', true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into partner_activities (org_id, partner_id, logged_by, type, notes)
    values ('00000000-0000-0000-0000-0000000000c3', '81000000-0000-0000-0000-0000000000a1',
            '80000000-0000-0000-0000-000000000004', 'call', 'peer sneaking a touch');
  exception when others then
    denied := true;
  end;
  if not denied then raise exception 'FR-HIER-54: peer must NOT log a touch on a rep-owned partner'; end if;
end $$;

rollback;
