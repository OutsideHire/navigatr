-- Tests for migration 20260825000004_bulk_invite_reports_to_pending.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/022_bulk_invite_reports_to_pending.sql
--
-- Self-cleans via ROLLBACK. Verifies the "manager + their reps in one CSV"
-- flow: a rep whose reports_to names a manager who is ALSO being invited (a
-- pending invite, no profile yet) is accepted (not reports_to_not_found), the
-- reporting line is stored as an email, and manager_id resolves at accept time
-- REGARDLESS of who accepts first (forward-resolve OR backfill). Plus the two
-- error paths: unknown reference and self-reference still error.
--
-- Org A: manager accepts before the rep (forward-resolve at rep accept).
-- Org B: rep accepts before the manager (backfill at manager accept).
--
-- Note on roles: admin_bulk_invite and claim_invite_code are SECURITY DEFINER
-- and gate on auth.uid() (the request.jwt.claim.sub GUC), NOT on the session
-- role. This script therefore stays as the (superuser) test role so its direct
-- fixture reads/writes bypass RLS, and only sets the jwt claim to choose which
-- user each RPC call acts as. (Switching to role=authenticated here would make
-- the direct `select ... from org_invites` reads RLS-gated and return nothing.)

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000da', 'Bulk A', 'bulk-a', 'bulk-a-code'),
  ('00000000-0000-0000-0000-0000000000db', 'Bulk B', 'bulk-b', 'bulk-b-code'),
  ('00000000-0000-0000-0000-0000000000dc', 'Bulk C', 'bulk-c', 'bulk-c-code');

-- Admin callers + the (accountless-until-accept) invitees. All get an
-- auth.users row up front; only the admins get a profile in the seed.
insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('da000000-0000-0000-0000-000000000001', 'adminA@t.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('da000000-0000-0000-0000-000000000002', 'miaA@t.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('da000000-0000-0000-0000-000000000003', 'aliceA@t.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('da000000-0000-0000-0000-000000000004', 'bobA@t.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('db000000-0000-0000-0000-000000000001', 'adminB@t.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('db000000-0000-0000-0000-000000000002', 'miaB@t.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('db000000-0000-0000-0000-000000000003', 'aliceB@t.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('dc000000-0000-0000-0000-000000000001', 'adminC@t.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('dc000000-0000-0000-0000-000000000002', 'coX@t.example',    'authenticated', 'authenticated', now(), now(), now()),
  ('dc000000-0000-0000-0000-000000000003', 'coY@t.example',    'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('da000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000da', 'admin', 'administrator', 'Admin A', 'adminA@t.example', 'adminA'::ltree),
  ('db000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000db', 'admin', 'administrator', 'Admin B', 'adminB@t.example', 'adminB'::ltree),
  ('dc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000dc', 'admin', 'administrator', 'Admin C', 'adminC@t.example', 'adminC'::ltree);

-- ── Org A bulk invite: reps listed BEFORE the manager (the sample shape).
--    All three rows must succeed; the rep rows defer to reports_to_email. ──
do $$
declare n_ok int; n_fail int;
begin
  perform set_config('request.jwt.claim.sub', 'da000000-0000-0000-0000-000000000001', true);
  select count(*) filter (where ok), count(*) filter (where not ok) into n_ok, n_fail
    from admin_bulk_invite('[
      {"email":"aliceA@t.example","full_name":"Alice A","role_level":"sales_professional","reports_to":"miaA@t.example"},
      {"email":"bobA@t.example","full_name":"Bob A","role_level":"sales_professional","reports_to":"miaA@t.example"},
      {"email":"miaA@t.example","full_name":"Mia A","role_level":"sales_manager","reports_to":"adminA@t.example"}
    ]'::jsonb);
  if n_ok <> 3 or n_fail <> 0 then
    raise exception 'bulk A: expected 3 ok / 0 fail, got % ok / % fail', n_ok, n_fail;
  end if;
end $$;

-- Rep invite: manager_id deferred (null), reporting line held as an email.
do $$
declare v_mgr uuid; v_re text;
begin
  select manager_id, reports_to_email into v_mgr, v_re from org_invites
   where org_id = '00000000-0000-0000-0000-0000000000da' and lower(email) = 'alicea@t.example';
  if v_mgr is not null then raise exception 'A alice invite manager_id should be null (deferred), got %', v_mgr; end if;
  if lower(v_re) <> 'miaa@t.example' then raise exception 'A alice invite reports_to_email should be mia, got %', v_re; end if;
end $$;

-- ── Accept order A: MANAGER first, then rep (forward-resolve). ──
do $$
declare v_tok text;
begin
  select token into v_tok from org_invites
   where org_id = '00000000-0000-0000-0000-0000000000da' and lower(email) = 'miaa@t.example';
  perform set_config('request.jwt.claim.sub', 'da000000-0000-0000-0000-000000000002', true);
  perform * from claim_invite_code(v_tok);
end $$;

do $$
declare v_tok text;
begin
  select token into v_tok from org_invites
   where org_id = '00000000-0000-0000-0000-0000000000da' and lower(email) = 'alicea@t.example';
  perform set_config('request.jwt.claim.sub', 'da000000-0000-0000-0000-000000000003', true);
  perform * from claim_invite_code(v_tok);
end $$;

do $$
declare v_amgr uuid; v_apath ltree; v_mpath ltree;
begin
  select manager_id, role_path into v_amgr, v_apath from profiles where id = 'da000000-0000-0000-0000-000000000003';
  select role_path into v_mpath from profiles where id = 'da000000-0000-0000-0000-000000000002';
  if v_amgr <> 'da000000-0000-0000-0000-000000000002' then
    raise exception 'A forward-resolve: alice.manager_id should be mia, got %', v_amgr;
  end if;
  if v_apath is null or not (v_apath <@ v_mpath) or v_apath = v_mpath then
    raise exception 'A forward-resolve: alice.role_path (%) should be a strict descendant of mia (%)', v_apath, v_mpath;
  end if;
end $$;

-- ── Org B bulk invite (same shape), then accept order: REP first. ──
do $$
declare n_ok int;
begin
  perform set_config('request.jwt.claim.sub', 'db000000-0000-0000-0000-000000000001', true);
  select count(*) filter (where ok) into n_ok
    from admin_bulk_invite('[
      {"email":"aliceB@t.example","full_name":"Alice B","role_level":"sales_professional","reports_to":"miaB@t.example"},
      {"email":"miaB@t.example","full_name":"Mia B","role_level":"sales_manager","reports_to":"adminB@t.example"}
    ]'::jsonb);
  if n_ok <> 2 then raise exception 'bulk B: expected 2 ok, got %', n_ok; end if;
end $$;

-- Rep accepts BEFORE the manager exists -> stays unplaced for now.
do $$
declare v_tok text; v_mgr uuid;
begin
  select token into v_tok from org_invites
   where org_id = '00000000-0000-0000-0000-0000000000db' and lower(email) = 'aliceb@t.example';
  perform set_config('request.jwt.claim.sub', 'db000000-0000-0000-0000-000000000003', true);
  perform * from claim_invite_code(v_tok);
  select manager_id into v_mgr from profiles where id = 'db000000-0000-0000-0000-000000000003';
  if v_mgr is not null then raise exception 'B: alice should be unplaced before mia accepts, got manager %', v_mgr; end if;
end $$;

-- Manager accepts -> backfill re-parents the rep, role_path recomputed.
do $$
declare v_tok text; v_amgr uuid; v_apath ltree; v_mpath ltree;
begin
  select token into v_tok from org_invites
   where org_id = '00000000-0000-0000-0000-0000000000db' and lower(email) = 'miab@t.example';
  perform set_config('request.jwt.claim.sub', 'db000000-0000-0000-0000-000000000002', true);
  perform * from claim_invite_code(v_tok);

  select manager_id, role_path into v_amgr, v_apath from profiles where id = 'db000000-0000-0000-0000-000000000003';
  select role_path into v_mpath from profiles where id = 'db000000-0000-0000-0000-000000000002';
  if v_amgr <> 'db000000-0000-0000-0000-000000000002' then
    raise exception 'B backfill: alice.manager_id should be mia after mia accepts, got %', v_amgr;
  end if;
  if v_apath is null or not (v_apath <@ v_mpath) or v_apath = v_mpath then
    raise exception 'B backfill: alice.role_path (%) should be a strict descendant of mia (%)', v_apath, v_mpath;
  end if;
end $$;

-- ── Org C: two co-managers who list EACH OTHER as reports_to (a plausible
--    spreadsheet mistake). Both invites succeed; both accept without hanging;
--    and the result must NOT be a manager_id cycle -- the accept-time backfill
--    refuses to re-parent auth.uid()'s own ancestor onto it. If the cycle guard
--    were missing, the second claim_invite_code would recurse forever in
--    rebuild_role_path_subtree and this block would time out / error. ──
do $$
declare n_ok int;
begin
  perform set_config('request.jwt.claim.sub', 'dc000000-0000-0000-0000-000000000001', true);
  select count(*) filter (where ok) into n_ok
    from admin_bulk_invite('[
      {"email":"coX@t.example","full_name":"Co X","role_level":"sales_manager","reports_to":"coY@t.example"},
      {"email":"coY@t.example","full_name":"Co Y","role_level":"sales_manager","reports_to":"coX@t.example"}
    ]'::jsonb);
  if n_ok <> 2 then raise exception 'bulk C: expected 2 ok (mutual refs both deferred), got %', n_ok; end if;
end $$;

do $$
declare v_tok text;
begin
  select token into v_tok from org_invites
   where org_id = '00000000-0000-0000-0000-0000000000dc' and lower(email) = 'cox@t.example';
  perform set_config('request.jwt.claim.sub', 'dc000000-0000-0000-0000-000000000002', true);
  perform * from claim_invite_code(v_tok);

  select token into v_tok from org_invites
   where org_id = '00000000-0000-0000-0000-0000000000dc' and lower(email) = 'coy@t.example';
  perform set_config('request.jwt.claim.sub', 'dc000000-0000-0000-0000-000000000003', true);
  perform * from claim_invite_code(v_tok);
end $$;

do $$
declare v_x uuid; v_y uuid; v_xmgr uuid; v_ymgr uuid;
begin
  select id, manager_id into v_x, v_xmgr from profiles where id = 'dc000000-0000-0000-0000-000000000002';
  select id, manager_id into v_y, v_ymgr from profiles where id = 'dc000000-0000-0000-0000-000000000003';
  if v_x is null or v_y is null then
    raise exception 'C: both co-managers should have accepted (x=%, y=%)', v_x, v_y;
  end if;
  -- No 2-node cycle: they must not each point at the other.
  if v_xmgr = v_y and v_ymgr = v_x then
    raise exception 'C: manager_id cycle formed (x->y=% , y->x=%)', v_xmgr, v_ymgr;
  end if;
end $$;

-- ── Error paths still hold: unknown reference and self-reference. ──
do $$
declare v_err text;
begin
  perform set_config('request.jwt.claim.sub', 'da000000-0000-0000-0000-000000000001', true);

  select error into v_err from admin_bulk_invite(
    '[{"email":"ghost@t.example","reports_to":"nobody@nowhere.example"}]'::jsonb);
  if v_err <> 'reports_to_not_found' then raise exception 'unknown ref: expected reports_to_not_found, got %', v_err; end if;

  select error into v_err from admin_bulk_invite(
    '[{"email":"selfref@t.example","reports_to":"selfref@t.example"}]'::jsonb);
  if v_err <> 'reports_to_self' then raise exception 'self ref: expected reports_to_self, got %', v_err; end if;
end $$;

rollback;
