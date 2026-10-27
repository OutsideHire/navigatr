-- Tests for 20261027000006_referral_partner_names (FR-PORT-55).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/068_referral_partner_names.sql
-- Self-cleans via ROLLBACK.
--
-- Org pn-a: boss administrator; rita rep and sam rep and tom rep, each directly
-- under boss in separate subtrees. Partner P1 "Jane CPA" (Jane & Co) is owned by
-- sam. Referral R1 from P1 is assigned to sam and converted to deal D1, owned by
-- rita: rita sees the referral (through her deal) but not the partner. Tom sees
-- neither. Org pn-b: admin zed with his own partner and referral R2.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-000000001068', 'Names Org', 'pn-a', 'pn-a-a1'),
  ('00000000-0000-0000-0000-000000002068', 'Other Org', 'pn-b', 'pn-b-b1');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0680000-0000-0000-0000-000000000001', 'boss@pn.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0680000-0000-0000-0000-000000000002', 'rita@pn.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0680000-0000-0000-0000-000000000003', 'sam@pn.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0680000-0000-0000-0000-000000000004', 'tom@pn.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0680000-0000-0000-0000-000000000005', 'zed@pn.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0680000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001068', 'admin', 'administrator',      'Boss', 'boss@pn.example', 'pnboss'::ltree,      null),
  ('a0680000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001068', 'rep',   'sales_professional', 'Rita', 'rita@pn.example', 'pnboss.rita'::ltree, 'a0680000-0000-0000-0000-000000000001'),
  ('a0680000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001068', 'rep',   'sales_professional', 'Sam',  'sam@pn.example',  'pnboss.sam'::ltree,  'a0680000-0000-0000-0000-000000000001'),
  ('a0680000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001068', 'rep',   'sales_professional', 'Tom',  'tom@pn.example',  'pnboss.tom'::ltree,  'a0680000-0000-0000-0000-000000000001'),
  ('a0680000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000002068', 'admin', 'administrator',      'Zed',  'zed@pn.example',  'pnzed'::ltree,       null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a068a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001068', 'a0680000-0000-0000-0000-000000000003', 'a0680000-0000-0000-0000-000000000003', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@pn.example'),
  ('a068a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000002068', 'a0680000-0000-0000-0000-000000000005', 'a0680000-0000-0000-0000-000000000005', 'Bea CPA',  'Bea & Co',  'cpa', 'bea@pnb.example');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a068d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001068', 'a0680000-0000-0000-0000-000000000002', 'Fresh Bakery', '5 Oak St', 'Ann', 'ann@pn.example', '5550680001', 100000, 'contacted', 'partner_referral');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, assigned_user_id, deal_id) values
  ('a068f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001068', 'a068a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'accepted',  'Fresh Bakery', 'a0680000-0000-0000-0000-000000000003', 'a068d000-0000-0000-0000-000000000001'),
  ('a068f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000002068', 'a068a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'submitted', 'Other Org Co', 'a0680000-0000-0000-0000-000000000005', null);

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- 0. Only authenticated may call it.
do $$ begin
  if has_function_privilege('anon', 'public.referral_partner_names(uuid[])', 'execute') then
    raise exception 'FAIL 0: anon must not execute referral_partner_names';
  end if;
  if not has_function_privilege('authenticated', 'public.referral_partner_names(uuid[])', 'execute') then
    raise exception 'FAIL 0: authenticated must execute referral_partner_names';
  end if;
end $$;

-- 1. Rita owns the deal but cannot open the partner: she still gets the name,
--    marked not visible. Sanity: the partners embed really is hidden from her.
select _t_act('a0680000-0000-0000-0000-000000000002'); -- rita
do $$ declare r record; n int; begin
  select count(*) into n from partners where id = 'a068a000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FAIL 1a: fixture broken, rita should not see partner P1 (got %)', n; end if;
  select count(*) into n from referrals where id = 'a068f000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'FAIL 1b: fixture broken, rita should see referral R1 (got %)', n; end if;

  select count(*) into n from public.referral_partner_names(array[
    'a068f000-0000-0000-0000-000000000001'::uuid, 'a068f000-0000-0000-0000-000000000002'::uuid]);
  if n <> 1 then raise exception 'FAIL 1c: rita should get exactly one row, got %', n; end if;

  select * into r from public.referral_partner_names(array['a068f000-0000-0000-0000-000000000001'::uuid]);
  if r.referral_id is distinct from 'a068f000-0000-0000-0000-000000000001'::uuid
     or r.partner_id is distinct from 'a068a000-0000-0000-0000-000000000001'::uuid
     or r.name is distinct from 'Jane CPA' or r.company is distinct from 'Jane & Co'
     or r.visible is distinct from false then
    raise exception 'FAIL 1d: expected Jane CPA / Jane & Co / visible=false, got %', r;
  end if;
end $$;

-- 2. Tom cannot see the referral at all: no row.
select _t_act('a0680000-0000-0000-0000-000000000004'); -- tom
do $$ declare n int; begin
  select count(*) into n from public.referral_partner_names(array['a068f000-0000-0000-0000-000000000001'::uuid]);
  if n <> 0 then raise exception 'FAIL 2: tom must get no row for a referral he cannot select, got %', n; end if;
end $$;

-- 3. Sam owns the partner: name with visible=true.
select _t_act('a0680000-0000-0000-0000-000000000003'); -- sam
do $$ declare r record; begin
  select * into r from public.referral_partner_names(array['a068f000-0000-0000-0000-000000000001'::uuid]);
  if r.name is distinct from 'Jane CPA' or r.visible is distinct from true then
    raise exception 'FAIL 3: sam should see Jane CPA with visible=true, got %', r;
  end if;
end $$;

-- 4. Administrator: visible=true.
select _t_act('a0680000-0000-0000-0000-000000000001'); -- boss
do $$ declare r record; begin
  select * into r from public.referral_partner_names(array['a068f000-0000-0000-0000-000000000001'::uuid]);
  if r.visible is distinct from true then raise exception 'FAIL 4: admin should see visible=true, got %', r; end if;
end $$;

-- 5. Another ISO's administrator gets nothing for org pn-a's referral, but his own.
select _t_act('a0680000-0000-0000-0000-000000000005'); -- zed
do $$ declare n int; r record; begin
  select count(*) into n from public.referral_partner_names(array['a068f000-0000-0000-0000-000000000001'::uuid]);
  if n <> 0 then raise exception 'FAIL 5a: cross-org caller must get no row, got %', n; end if;
  select * into r from public.referral_partner_names(array['a068f000-0000-0000-0000-000000000002'::uuid]);
  if r.name is distinct from 'Bea CPA' or r.visible is distinct from true then
    raise exception 'FAIL 5b: zed should see his own partner, got %', r;
  end if;
end $$;

-- 6. Empty and null input return nothing (no error).
do $$ declare n int; begin
  select count(*) into n from public.referral_partner_names(array[]::uuid[]);
  if n <> 0 then raise exception 'FAIL 6a: empty input should return no rows, got %', n; end if;
  select count(*) into n from public.referral_partner_names(null);
  if n <> 0 then raise exception 'FAIL 6b: null input should return no rows, got %', n; end if;
end $$;

rollback;
