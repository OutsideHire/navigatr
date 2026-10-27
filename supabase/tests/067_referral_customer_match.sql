-- Tests for 20261027000004_referral_customer_match (FR-PORT-44, Q4).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/067_referral_customer_match.sql
-- Self-cleans via ROLLBACK.
--
-- Org cm-a: boss administrator; mgr manager (under boss); rita rep (under mgr);
-- sam rep (under boss, a different subtree). Org cm-b: other ISO.
-- Won deals: W1 "Old Bakery" owned by rita; W2 "Far Cafe" owned by sam;
-- W3 "Other Org Diner" in org cm-b. Open deal O1 "Open Deli" owned by rita.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-000000001067', 'Match Org', 'cm-a', 'cm-a-a1'),
  ('00000000-0000-0000-0000-000000002067', 'Other Org', 'cm-b', 'cm-b-b1');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0670000-0000-0000-0000-000000000001', 'boss@cm.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0670000-0000-0000-0000-000000000002', 'mgr@cm.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0670000-0000-0000-0000-000000000003', 'rita@cm.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0670000-0000-0000-0000-000000000004', 'sam@cm.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0670000-0000-0000-0000-000000000005', 'zed@cm.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0670000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001067', 'admin', 'administrator',      'Boss', 'boss@cm.example', 'cmboss'::ltree,          null),
  ('a0670000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001067', 'rep',   'sales_manager',      'Mgr',  'mgr@cm.example',  'cmboss.mgr'::ltree,      'a0670000-0000-0000-0000-000000000001'),
  ('a0670000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001067', 'rep',   'sales_professional', 'Rita', 'rita@cm.example', 'cmboss.mgr.rita'::ltree, 'a0670000-0000-0000-0000-000000000002'),
  ('a0670000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001067', 'rep',   'sales_professional', 'Sam',  'sam@cm.example',  'cmboss.sam'::ltree,      'a0670000-0000-0000-0000-000000000001'),
  ('a0670000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000002067', 'admin', 'administrator',      'Zed',  'zed@cm.example',  'cmzed'::ltree,           null);

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a067d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001067', 'a0670000-0000-0000-0000-000000000003', 'Old Bakery',  '30 Pine Rd', 'C', 'o@cm.example', '555-010-0003', 100, 'won',  'path'),
  ('a067d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001067', 'a0670000-0000-0000-0000-000000000004', 'Far Cafe',    '9 Elm St',   'C', 'f@cm.example', '555-010-0004', 100, 'won',  'path'),
  ('a067d000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000002067', 'a0670000-0000-0000-0000-000000000005', 'Other Org Diner', '1 Oak', 'C', 'd@cm.example', '555-010-0005', 100, 'won',  'path'),
  ('a067d000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001067', 'a0670000-0000-0000-0000-000000000003', 'Open Deli',   '5 Main St',  'C', 'p@cm.example', '555-010-0006', 100, 'qualified', 'path');

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select _t_act('a0670000-0000-0000-0000-000000000003'); -- rita

-- 1. Name + address match on a won deal she can see.
do $$ declare r record; begin
  select * into r from public.referral_customer_match('Old Bakery LLC', null, '30 Pine Rd');
  if r.deal_id is distinct from 'a067d000-0000-0000-0000-000000000001'::uuid or r.company_name <> 'Old Bakery' then
    raise exception 'FAIL 1: expected Old Bakery won deal, got %', r;
  end if;
end $$;

-- 2. Phone match (different spelling of the number, different name).
do $$ declare r record; begin
  select * into r from public.referral_customer_match('Totally Different', '(555) 010-0003', null);
  if r.deal_id is distinct from 'a067d000-0000-0000-0000-000000000001'::uuid then
    raise exception 'FAIL 2: phone should match the won deal, got %', r;
  end if;
end $$;

-- 3. Name-only match when the address is blank.
do $$ declare r record; begin
  select * into r from public.referral_customer_match('The Old Bakery', null, null);
  if r.deal_id is distinct from 'a067d000-0000-0000-0000-000000000001'::uuid then
    raise exception 'FAIL 3: name-only should match when address is blank, got %', r;
  end if;
end $$;

-- 4. Same name at a different address does NOT match when an address is given.
do $$ declare n int; begin
  select count(*) into n from public.referral_customer_match('Old Bakery', null, '99 Other Rd');
  if n <> 0 then raise exception 'FAIL 4: different address must not match by name, got %', n; end if;
end $$;

-- 5. A won deal owned outside her subtree does not match.
do $$ declare n int; begin
  select count(*) into n from public.referral_customer_match('Far Cafe', '555-010-0004', '9 Elm St');
  if n <> 0 then raise exception 'FAIL 5: won deal outside the subtree must not match, got %', n; end if;
end $$;

-- 6. An open deal does not match.
do $$ declare n int; begin
  select count(*) into n from public.referral_customer_match('Open Deli', '555-010-0006', '5 Main St');
  if n <> 0 then raise exception 'FAIL 6: open deal must not match, got %', n; end if;
end $$;

-- 7. Another org's won deal does not match.
do $$ declare n int; begin
  select count(*) into n from public.referral_customer_match('Other Org Diner', '555-010-0005', '1 Oak');
  if n <> 0 then raise exception 'FAIL 7: other org deal must not match, got %', n; end if;
end $$;

-- 8. Nothing to match on returns nothing.
do $$ declare n int; begin
  select count(*) into n from public.referral_customer_match(null, null, null);
  if n <> 0 then raise exception 'FAIL 8: empty input must return no rows, got %', n; end if;
end $$;

-- 9. The admin sees Sam's won deal.
select _t_act('a0670000-0000-0000-0000-000000000001');
do $$ declare r record; begin
  select * into r from public.referral_customer_match('Far Cafe', null, '9 Elm St');
  if r.deal_id is distinct from 'a067d000-0000-0000-0000-000000000002'::uuid then
    raise exception 'FAIL 9: admin should see Far Cafe, got %', r;
  end if;
end $$;

-- 10. Only authenticated may execute it.
reset role;
do $$ begin
  if has_function_privilege('anon', 'public.referral_customer_match(text, text, text)', 'execute') then
    raise exception 'FAIL 10: anon must not execute referral_customer_match';
  end if;
  if not has_function_privilege('authenticated', 'public.referral_customer_match(text, text, text)', 'execute') then
    raise exception 'FAIL 10: authenticated must execute referral_customer_match';
  end if;
end $$;

rollback;
