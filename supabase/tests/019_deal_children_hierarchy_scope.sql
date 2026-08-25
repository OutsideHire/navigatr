-- Tests for migration 20260825000001_deal_children_hierarchy_scope.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/019_deal_children_hierarchy_scope.sql
--
-- Self-cleans via the wrapping ROLLBACK. Verifies that the deal CHILD tables
-- (deal_contacts / deal_notes / deal_files / deal_stage_history) inherit the
-- parent deal's hierarchy visibility for BOTH reads and writes: if you can see
-- the deal you see (and may write) its children; if you can't, you can't.
--
-- Storage note: the deal-files storage.objects policies get the same gate in
-- the migration, but this DB-test harness runs postgres WITHOUT the storage
-- service (test.yml: -x storage-api) and the psql role does not OWN
-- storage.objects, so its RLS cannot be toggled or reliably exercised here. The
-- storage policies mirror the deal_files table policies verbatim and are
-- validated by inspection; only the table policies are asserted below.
--
-- Hierarchy:
--   ceo (admin)
--    └─ vp (manager, ceo.vp)
--        └─ rep1 (rep, ceo.vp.rep1)   ← owns the deal + all child rows
--    └─ vp2 (manager, ceo.vp2)        ← sibling subtree, must NOT see/write rep1's children

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000c9', 'Deal Children Scope', 'deal-child-scope', 'deal-child-aa');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('c9000000-0000-0000-0000-000000000001', 'ceo@dc.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('c9000000-0000-0000-0000-000000000002', 'vp@dc.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('c9000000-0000-0000-0000-000000000003', 'rep1@dc.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('c9000000-0000-0000-0000-000000000004', 'vp2@dc.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('c9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c9', 'admin',   'CEO',  'ceo@dc.example',  'ceo'::ltree),
  ('c9000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c9', 'manager', 'VP',   'vp@dc.example',   'ceo.vp'::ltree),
  ('c9000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c9', 'rep',     'Rep1', 'rep1@dc.example', 'ceo.vp.rep1'::ltree),
  ('c9000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000c9', 'manager', 'VP2',  'vp2@dc.example',  'ceo.vp2'::ltree);

-- rep1 owns the deal (this INSERT auto-creates a deal_stage_history row).
insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('c9d00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c9', 'c9000000-0000-0000-0000-000000000003', 'Rep1 Co', 'C', 'c@dc.example', '+15550009001', 12345);

-- Child rows on rep1's deal (org_id filled by each table's trigger from the deal).
insert into deal_contacts (deal_id, name, email, phone, created_by) values
  ('c9d00000-0000-0000-0000-000000000001', 'Jane Contact', 'jane@customer.example', '+15550009999', 'c9000000-0000-0000-0000-000000000003');
insert into deal_notes (deal_id, body, created_by) values
  ('c9d00000-0000-0000-0000-000000000001', 'private note on rep1 deal', 'c9000000-0000-0000-0000-000000000003');
insert into deal_files (deal_id, path, name, size_bytes, uploaded_by) values
  ('c9d00000-0000-0000-0000-000000000001', 'c9d00000-0000-0000-0000-000000000001/doc.pdf', 'doc.pdf', 100, 'c9000000-0000-0000-0000-000000000003');

-- Assert the visible child-row counts for a given user against the expected
-- value (1 = visible for in-scope users, 0 = hidden for cross-subtree).
create or replace function _dc_assert(p_user uuid, p_expected int, p_label text)
returns void language plpgsql as $$
declare c int; s int;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into c from deal_contacts where deal_id = 'c9d00000-0000-0000-0000-000000000001';
  if c <> p_expected then raise exception '%: deal_contacts expected %, got %', p_label, p_expected, c; end if;

  select count(*) into c from deal_notes where deal_id = 'c9d00000-0000-0000-0000-000000000001';
  if c <> p_expected then raise exception '%: deal_notes expected %, got %', p_label, p_expected, c; end if;

  select count(*) into c from deal_files where deal_id = 'c9d00000-0000-0000-0000-000000000001';
  if c <> p_expected then raise exception '%: deal_files expected %, got %', p_label, p_expected, c; end if;

  -- stage_history has >=1 row for a visible deal (the auto "created" transition);
  -- exactly 0 when hidden.
  select count(*) into s from deal_stage_history where deal_id = 'c9d00000-0000-0000-0000-000000000001';
  if p_expected = 0 and s <> 0 then raise exception '%: deal_stage_history expected 0, got %', p_label, s; end if;
  if p_expected > 0 and s < 1 then raise exception '%: deal_stage_history expected >=1, got %', p_label, s; end if;
end $$;

-- rep1 owns the deal -> sees everything.
do $$ begin perform _dc_assert('c9000000-0000-0000-0000-000000000003', 1, 'rep1 (owner)'); end $$;
-- vp is rep1's manager (ancestor) -> sees everything.
do $$ begin perform _dc_assert('c9000000-0000-0000-0000-000000000002', 1, 'vp (manager/ancestor)'); end $$;
-- ceo is admin -> exempt, sees everything.
do $$ begin perform _dc_assert('c9000000-0000-0000-0000-000000000001', 1, 'ceo (admin)'); end $$;
-- vp2 is a sibling subtree -> must NOT see any of rep1's deal children.
do $$ begin perform _dc_assert('c9000000-0000-0000-0000-000000000004', 0, 'vp2 (cross-subtree)'); end $$;

-- WRITE gate: vp2 must NOT be able to write into rep1's out-of-scope deal.
-- (The companion hole the review flagged: even knowing the deal_id, an
-- out-of-scope rep must not be able to INSERT a note/contact.)
do $$
declare blocked boolean;
begin
  perform set_config('request.jwt.claim.sub', 'c9000000-0000-0000-0000-000000000004'::text, true);
  perform set_config('role', 'authenticated', true);

  blocked := false;
  begin
    insert into deal_notes (deal_id, body, created_by)
      values ('c9d00000-0000-0000-0000-000000000001', 'vp2 intrusion', 'c9000000-0000-0000-0000-000000000004');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'vp2 must NOT be able to insert a note on rep1 out-of-scope deal'; end if;

  blocked := false;
  begin
    insert into deal_contacts (deal_id, name, created_by)
      values ('c9d00000-0000-0000-0000-000000000001', 'Intruder', 'c9000000-0000-0000-0000-000000000004');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'vp2 must NOT be able to insert a contact on rep1 out-of-scope deal'; end if;
end $$;

-- Positive control: rep1 (owner) CAN write to their own deal's children. If the
-- write gate wrongly blocked the owner, this insert would raise and fail.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'c9000000-0000-0000-0000-000000000003'::text, true);
  perform set_config('role', 'authenticated', true);
  insert into deal_notes (deal_id, body, created_by)
    values ('c9d00000-0000-0000-0000-000000000001', 'owner note', 'c9000000-0000-0000-0000-000000000003');
end $$;

rollback;
