-- Tests for 20261012000003_portal_referral_submit (Partner Portal Phase 1B).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/042_portal_referral_submit.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- Fixture, org A portal-submit (portal on, consent v3):
--   boss administrator; rep1 boss.rep1; rep2 boss.rep2 (rep1 and rep2 cannot see each other)
--   P1, P2, P4, P5 owned by rep1; P3 owned by rep2
--   U1..U4 active portal users for P1..P4; U5 suspended for P5
--   DV  rep1  Corner Cafe, 10 Elm Street, (555) 010-0001, contacted
--   DH  rep2  Hidden Gym,  20 Oak Ave,    555-010-0002,   new
--   DW  rep1  Old Bakery,  30 Pine Rd,    555-010-0003,   won
--   RX  P1 declined referral Declined Diner, 555-010-0004
--   U4 already sent 30 referrals ten minutes ago (rate limit)
-- Org B portal-submit-b (portal on, no consent text): bossB, PB, UB, deal DB Corner Cafe 555-010-0009.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, consent_text, consent_version) values
  ('00000000-0000-0000-0000-000000001042', 'Submit Org',   'portal-submit',   'portal-submit-a1', true, 'I may share these details.', 3),
  ('00000000-0000-0000-0000-000000001142', 'Submit Org B', 'portal-submit-b', 'portal-submit-b1', true, null, 0);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0420000-0000-0000-0000-000000000001', 'boss@sub.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0420000-0000-0000-0000-000000000002', 'rep1@sub.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0420000-0000-0000-0000-000000000003', 'rep2@sub.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0420000-0000-0000-0000-000000000004', 'bossb@sub.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0420000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001042', 'admin', 'administrator',      'Boss',  'boss@sub.example',  'subboss'::ltree,      null),
  ('a0420000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001042', 'rep',   'sales_professional', 'Rep1',  'rep1@sub.example',  'subboss.rep1'::ltree, 'a0420000-0000-0000-0000-000000000001'),
  ('a0420000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001042', 'rep',   'sales_professional', 'Rep2',  'rep2@sub.example',  'subboss.rep2'::ltree, 'a0420000-0000-0000-0000-000000000001'),
  ('a0420000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001142', 'admin', 'administrator',      'BossB', 'bossb@sub.example', 'subbossb'::ltree,     null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a042a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000002', 'a0420000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@sub.example'),
  ('a042a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000002', 'a0420000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@sub.example'),
  ('a042a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000003', 'a0420000-0000-0000-0000-000000000003', 'Lee CPA',  'Lee & Co',  'cpa', 'lee@sub.example'),
  ('a042a000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000002', 'a0420000-0000-0000-0000-000000000002', 'Max CPA',  'Max & Co',  'cpa', 'max@sub.example'),
  ('a042a000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000002', 'a0420000-0000-0000-0000-000000000002', 'Sus CPA',  'Sus & Co',  'cpa', 'sus@sub.example'),
  ('a042a000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001142', 'a0420000-0000-0000-0000-000000000004', 'a0420000-0000-0000-0000-000000000004', 'Bea CPA',  'Bea & Co',  'cpa', 'bea@sub.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a042b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001', 'jane@sub.example', 'active'),
  ('a042b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000002', 'kim@sub.example',  'active'),
  ('a042b000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000003', 'lee@sub.example',  'active'),
  ('a042b000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000004', 'max@sub.example',  'active'),
  ('a042b000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000005', 'sus@sub.example',  'suspended'),
  ('a042b000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001142', 'a042a000-0000-0000-0000-000000000006', 'bea@sub.example',  'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a042d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000002', 'Corner Cafe', '10 Elm Street', 'C', 'c@sub.example', '(555) 010-0001', 100, 'contacted', 'path'),
  ('a042d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000003', 'Hidden Gym',  '20 Oak Ave',    'C', 'h@sub.example', '555-010-0002',   100, 'new',       'path'),
  ('a042d000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001042', 'a0420000-0000-0000-0000-000000000002', 'Old Bakery',  '30 Pine Rd',    'C', 'o@sub.example', '555-010-0003',   100, 'won',       'path'),
  ('a042d000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001142', 'a0420000-0000-0000-0000-000000000004', 'Corner Cafe', '10 Elm Street', 'C', 'b@sub.example', '555-010-0009',   100, 'new',       'path');

insert into referrals (id, org_id, partner_id, status, company_name, contact_phone, assigned_user_id) values
  ('a042f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001', 'declined', 'Declined Diner', '555-010-0004', 'a0420000-0000-0000-0000-000000000002');

-- U4 already sent 30 referrals in the last hour.
insert into referrals (org_id, partner_id, source, company_name, contact_name, contact_phone, submitted_by_portal_user_id, submitted_at)
select '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000004', 'portal_signed_in',
       'Bulk ' || g, 'C', '555-020-' || lpad(g::text, 4, '0'), 'a042b000-0000-0000-0000-000000000004',
       now() - interval '10 minutes'
  from generate_series(1, 30) g;

create temp table _ids (k text primary key, v uuid);

-- Runs p_sql and asserts it raises an error whose message contains p_token.
create or replace function _t_raises(p_sql text, p_token text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_token in sqlerrm) = 0 then
      raise exception 'expected error %, got: %', p_token, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error % but the statement succeeded: %', p_token, p_sql;
end $$;

-- 1. Schema and privileges.
do $$ declare f text; begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'referrals' and column_name = 'urgency') then
    raise exception 'referrals.urgency should exist';
  end if;
  foreach f in array array[
    'public.portal_form_context(uuid, uuid)',
    'public.portal_dup_check(uuid, uuid, uuid, text, text, text, text)',
    'public.portal_submit_referral(uuid, uuid, uuid, text, text, text, text, text, text, text, text, boolean, integer, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
  foreach f in array array[
    'public._portal_assert_scope(uuid, uuid, uuid)',
    'public._portal_audit_referral(uuid, uuid, portal_audit_action, uuid, text)',
    'public._portal_referral_ref(uuid)',
    'public._portal_find_duplicates(uuid, uuid, text, text, text, uuid)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
       or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'private helper % must not be executable by any API role', f;
    end if;
  end loop;
end $$;

-- 2. Consent wording for the form.
do $$ declare r record; begin
  select * into r from public.portal_form_context('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001');
  if r.consent_text is distinct from 'I may share these details.' or r.consent_version is distinct from 3 then
    raise exception 'form context for org A is wrong: %', row_to_json(r);
  end if;
  select * into r from public.portal_form_context('00000000-0000-0000-0000-000000001142', 'a042a000-0000-0000-0000-000000000006');
  if r.consent_text is distinct from 'I have permission to share this business''s contact details.' or r.consent_version is distinct from 0 then
    raise exception 'an org with no consent text gets the default line: %', row_to_json(r);
  end if;
  if exists (select 1 from public.portal_form_context('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000006')) then
    raise exception 'a partner from another org must get nothing';
  end if;
end $$;

-- 3. Soft duplicate check, scoped by the partner owner's visibility.
do $$
declare
  o  uuid := '00000000-0000-0000-0000-000000001042';
  p1 uuid := 'a042a000-0000-0000-0000-000000000001';
  u1 uuid := 'a042b000-0000-0000-0000-000000000001';
  n  int;
begin
  if not public.portal_dup_check(o, p1, u1, 'Anything Co', '+1 555 010 0001', null, '10.42.0.1') then
    raise exception 'a phone match on a visible deal should warn';
  end if;
  if not public.portal_dup_check(o, p1, u1, 'Corner Cafe LLC', null, '10 Elm St', '10.42.0.1') then
    raise exception 'a name+address match should warn';
  end if;
  if not public.portal_dup_check(o, p1, u1, 'corner cafe', null, null, '10.42.0.1') then
    raise exception 'a name match with no address should warn';
  end if;
  if public.portal_dup_check(o, p1, u1, 'Corner Cafe', null, '99 Other Rd', '10.42.0.1') then
    raise exception 'the same name at a different known address must not warn';
  end if;
  if public.portal_dup_check(o, p1, u1, 'Hidden Gym', '555-010-0002', null, '10.42.0.1') then
    raise exception 'a deal the partner owner cannot see must not be reported';
  end if;
  if public.portal_dup_check(o, p1, u1, 'Old Bakery', null, '30 Pine Rd', '10.42.0.1') then
    raise exception 'a closed deal must not warn';
  end if;
  if public.portal_dup_check(o, p1, u1, 'Nobody Co', '555-010-0009', null, '10.42.0.1') then
    raise exception 'a deal in another org must not warn';
  end if;
  if public.portal_dup_check(o, p1, u1, 'Declined Diner', '555-010-0004', null, '10.42.0.1') then
    raise exception 'a declined referral must not warn';
  end if;
  if public.portal_dup_check(o, p1, u1, 'Brand New Co', null, null, '10.42.0.1') then
    raise exception 'an unrelated business must not warn';
  end if;
  if not public.portal_dup_check(o, 'a042a000-0000-0000-0000-000000000003', 'a042b000-0000-0000-0000-000000000003',
                                 'Hidden Gym', '555-010-0002', null, '10.42.0.3') then
    raise exception 'the owner of the hidden deal should be warned';
  end if;
  select count(*) into n from portal_audit_log where action = 'dup_check' and portal_user_id = u1;
  if n <> 9 then raise exception 'each dup check should audit once, got %', n; end if;
end $$;

-- 4. Submit: stored fields, routing, consent version, history, audit, attribution.
do $$
declare
  o uuid := '00000000-0000-0000-0000-000000001042';
  r record;
  v referrals;
  h record;
begin
  select * into r from public.portal_submit_referral(
    o, 'a042a000-0000-0000-0000-000000000001', 'a042b000-0000-0000-0000-000000000001',
    ' Corner Cafe ', 'Ann', 'ANN@cafe.example', '555 010 0001', null, 'restaurant', 'this_week',
    ' Busy at lunch ', true, 3, '10.42.0.1');
  insert into _ids values ('s1', r.id);
  if r.ref is distinct from 'REF-' || upper(left(r.id::text, 8)) then raise exception 'bad reference %', r.ref; end if;

  select * into v from referrals where id = r.id;
  if v.source <> 'portal_signed_in' or v.status <> 'submitted' or v.direction <> 'inbound' then
    raise exception 'wrong source, status or direction: %', row_to_json(v);
  end if;
  if v.company_name <> 'Corner Cafe' or v.contact_name <> 'Ann' or v.contact_email <> 'ann@cafe.example'
     or v.contact_phone <> '555 010 0001' or v.address is not null or v.place_id is not null
     or v.industry <> 'restaurant' or v.urgency <> 'this_week' or v.notes <> 'Busy at lunch' then
    raise exception 'submitted fields stored wrong: %', row_to_json(v);
  end if;
  if v.assigned_user_id is distinct from 'a0420000-0000-0000-0000-000000000002' then
    raise exception 'should route to the partner owner, got %', v.assigned_user_id;
  end if;
  if v.submitted_by_portal_user_id is distinct from 'a042b000-0000-0000-0000-000000000001'
     or v.submitted_by_user_id is not null then
    raise exception 'submitter should be the portal user only';
  end if;
  if v.consent_text_version is distinct from '3' then raise exception 'consent version should be stored from the org'; end if;
  if v.partner_company_snapshot is distinct from 'Jane & Co' then raise exception 'partner company should be snapshotted'; end if;
  if v.duplicate_of_deal_id is distinct from 'a042d000-0000-0000-0000-000000000001' or v.duplicate_of_referral_id is not null then
    raise exception 'first submission should flag only the visible deal: % %', v.duplicate_of_referral_id, v.duplicate_of_deal_id;
  end if;

  select * into h from referral_status_history where referral_id = r.id;
  if h.to_status <> 'submitted' or h.actor_type <> 'partner' or h.actor_id is distinct from 'a042b000-0000-0000-0000-000000000001' then
    raise exception 'history should record the partner: %', row_to_json(h);
  end if;
  if not exists (select 1 from portal_audit_log where action = 'submit' and referral_id = r.id
                   and portal_user_id = 'a042b000-0000-0000-0000-000000000001' and ip = '10.42.0.1') then
    raise exception 'submit should be audited with the referral';
  end if;
  if coalesce(current_setting('navigatr.referral_actor', true), '') <> ''
     or coalesce(current_setting('navigatr.referral_actor_id', true), '') <> '' then
    raise exception 'actor settings must be cleared after submit';
  end if;
end $$;

-- Same owner, other partner: the earlier referral keeps credit.
do $$ declare r record; v referrals; begin
  select * into r from public.portal_submit_referral(
    '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000002', 'a042b000-0000-0000-0000-000000000002',
    'Corner Cafe', 'Bob', null, '555-010-0001', null, null, null, '', true, 3, null);
  select * into v from referrals where id = r.id;
  if v.duplicate_of_referral_id is distinct from (select i.v from _ids i where i.k = 's1')
     or v.duplicate_of_deal_id is distinct from 'a042d000-0000-0000-0000-000000000001' then
    raise exception 'second submission should point at the first referral and the deal: %', row_to_json(v);
  end if;
  if v.urgency is not null or v.industry is not null or v.contact_email is not null then
    raise exception 'blank optional fields should be null';
  end if;
end $$;

-- The hidden deal's owner sees it; a partner of another owner does not.
do $$ declare r record; v referrals; begin
  select * into r from public.portal_submit_referral(
    '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000003', 'a042b000-0000-0000-0000-000000000003',
    'Hidden Gym', 'Cy', null, '555-010-0002', null, null, null, '', true, 3, null);
  select * into v from referrals where id = r.id;
  if v.duplicate_of_deal_id is distinct from 'a042d000-0000-0000-0000-000000000002' or v.duplicate_of_referral_id is not null then
    raise exception 'P3 should be flagged against its own owner''s deal only';
  end if;
  if v.assigned_user_id is distinct from 'a0420000-0000-0000-0000-000000000003' then
    raise exception 'P3 should route to rep2';
  end if;

  select * into r from public.portal_submit_referral(
    '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001', 'a042b000-0000-0000-0000-000000000001',
    'Hidden Gym', 'Di', null, '555-010-0002', null, null, null, '', true, 3, null);
  select * into v from referrals where id = r.id;
  if v.duplicate_of_deal_id is not null or v.duplicate_of_referral_id is not null then
    raise exception 'rep1''s partner must not be flagged against rep2''s deal or partner: %', row_to_json(v);
  end if;

  select * into r from public.portal_submit_referral(
    '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001', 'a042b000-0000-0000-0000-000000000001',
    'Declined Diner', 'Ed', null, '555-010-0004', null, null, null, '', true, 3, null);
  select * into v from referrals where id = r.id;
  if v.duplicate_of_referral_id is not null or v.duplicate_of_deal_id is not null then
    raise exception 'a declined referral must not take credit';
  end if;

  select * into r from public.portal_submit_referral(
    '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001', 'a042b000-0000-0000-0000-000000000001',
    'Fresh Start', 'Flo', 'flo@fresh.example', null, null, null, null, '', true, 3, null);
  select * into v from referrals where id = r.id;
  if v.duplicate_of_referral_id is not null or v.duplicate_of_deal_id is not null or v.contact_phone is not null then
    raise exception 'an email-only, unrelated submission should not be flagged';
  end if;
end $$;

-- 5. Validation (server side as well as in portal_api).
do $$
declare
  head text := $q$select * from public.portal_submit_referral('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000001', 'a042b000-0000-0000-0000-000000000001', $q$;
begin
  perform _t_raises(head || $q$'Co', 'Ann', null, '5550100100', null, null, null, '', false, 3, null)$q$, 'consent_required');
  perform _t_raises(head || $q$'Co', 'Ann', null, '5550100100', null, null, null, '', true, 2, null)$q$, 'consent_changed');
  perform _t_raises(head || $q$'   ', 'Ann', null, '5550100100', null, null, null, '', true, 3, null)$q$, 'invalid_input:companyName');
  perform _t_raises(head || format('%L', repeat('x', 161)) || $q$, 'Ann', null, '5550100100', null, null, null, '', true, 3, null)$q$, 'invalid_input:companyName');
  perform _t_raises(head || $q$'Co', '', null, '5550100100', null, null, null, '', true, 3, null)$q$, 'invalid_input:contactName');
  perform _t_raises(head || $q$'Co', 'Ann', 'not-an-email', null, null, null, null, '', true, 3, null)$q$, 'invalid_input:email');
  perform _t_raises(head || $q$'Co', 'Ann', null, null, null, null, null, '', true, 3, null)$q$, 'invalid_input:emailOrPhone');
  perform _t_raises(head || $q$'Co', 'Ann', null, '5550100100', null, 'casino', null, '', true, 3, null)$q$, 'invalid_input:industry');
  perform _t_raises(head || $q$'Co', 'Ann', null, '5550100100', null, null, 'asap', '', true, 3, null)$q$, 'invalid_input:urgency');
  perform _t_raises(head || $q$'Co', 'Ann', null, '5550100100', null, null, null, $q$ || format('%L', repeat('x', 4001)) || $q$, true, 3, null)$q$, 'invalid_input:notes');
end $$;

-- 6. Scope: the portal user must belong to this org and partner and be active.
do $$ begin
  perform _t_raises($q$select * from public.portal_submit_referral('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000002', 'a042b000-0000-0000-0000-000000000001', 'Co', 'Ann', null, '5550100100', null, null, null, '', true, 3, null)$q$, 'not_authorized');
  perform _t_raises($q$select * from public.portal_submit_referral('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000006', 'a042b000-0000-0000-0000-000000000006', 'Co', 'Ann', null, '5550100100', null, null, null, '', true, 3, null)$q$, 'not_authorized');
  perform _t_raises($q$select * from public.portal_submit_referral('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000005', 'a042b000-0000-0000-0000-000000000005', 'Co', 'Ann', null, '5550100100', null, null, null, '', true, 3, null)$q$, 'not_authorized');
  perform _t_raises($q$select public.portal_dup_check('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000002', 'a042b000-0000-0000-0000-000000000001', 'Co', null, null, null)$q$, 'not_authorized');
end $$;

-- 7. Rate limits.
do $$
declare
  call text := $q$select * from public.portal_submit_referral('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000004', 'a042b000-0000-0000-0000-000000000004', 'One More Co', 'Ann', null, '5550100100', null, null, null, '', true, 3, null)$q$;
  n int;
begin
  -- 30 in the last hour.
  perform _t_raises(call, 'rate_limited');

  -- Move them out of the hour, then fill the day to 200.
  update referrals set submitted_at = now() - interval '2 hours'
   where submitted_by_portal_user_id = 'a042b000-0000-0000-0000-000000000004';
  insert into referrals (org_id, partner_id, source, company_name, contact_name, contact_phone, submitted_by_portal_user_id, submitted_at)
  select '00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000004', 'portal_signed_in',
         'Daily ' || g, 'C', '555-030-' || lpad(g::text, 4, '0'), 'a042b000-0000-0000-0000-000000000004',
         now() - interval '3 hours'
    from generate_series(1, 170) g;
  perform _t_raises(call, 'rate_limited');

  -- One drops out of the 24 hours: the next submission goes through.
  update referrals set submitted_at = now() - interval '25 hours'
   where id = (select id from referrals where company_name = 'Daily 1'
                 and submitted_by_portal_user_id = 'a042b000-0000-0000-0000-000000000004');
  execute call;
  select count(*) into n from referrals where company_name = 'One More Co';
  if n <> 1 then raise exception 'a submission under both limits should succeed'; end if;

  -- dup_check: 120 per portal user per hour.
  insert into portal_audit_log (org_id, portal_user_id, action, created_at)
  select '00000000-0000-0000-0000-000000001042', 'a042b000-0000-0000-0000-000000000002', 'dup_check', now() - interval '5 minutes'
    from generate_series(1, 120);
  perform _t_raises($q$select public.portal_dup_check('00000000-0000-0000-0000-000000001042', 'a042a000-0000-0000-0000-000000000002', 'a042b000-0000-0000-0000-000000000002', 'Co', null, null, null)$q$, 'rate_limited');
end $$;

rollback;
