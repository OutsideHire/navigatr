-- Tests for 20261018000003_public_form_submissions (Partner Portal Phase 2B-1,
-- FR-PORT-25, 26, 29..31, 34).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/058_public_form_submissions.sql
-- Self-cleans via ROLLBACK.
--
-- Org A pf-pub (portal on, public form on, consent v2 "I may share this."):
--   boss administrator; mia manager under boss; rita rep under mia; dee rep
--   under mia (deactivated); uma rep with no placement and no manager.
-- Org B pf-pub-b (portal on, public form off): bob administrator.
-- Org C pf-pub-c (portal off, public form on).
-- Links (org A unless noted): rita, dee, uma, tenant, a retired rita link, a
-- "foreign" user link pointing at bob (org B), org B tenant, org C tenant.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, consent_text, consent_version) values
  ('00000000-0000-0000-0000-000000001058', 'Public Org',   'pf-pub',   'pf-pub-a1',   true,  'I may share this.', 2),
  ('00000000-0000-0000-0000-000000001158', 'Public Org B', 'pf-pub-b', 'pf-pub-b-a1', true,  null,                0),
  ('00000000-0000-0000-0000-000000001258', 'Public Org C', 'pf-pub-c', 'pf-pub-c-a1', false, null,                0);
update organizations set public_form_enabled = true
 where id in ('00000000-0000-0000-0000-000000001058', '00000000-0000-0000-0000-000000001258');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0580000-0000-0000-0000-000000000001', 'boss@pub.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0580000-0000-0000-0000-000000000002', 'mia@pub.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0580000-0000-0000-0000-000000000003', 'rita@pub.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0580000-0000-0000-0000-000000000004', 'dee@pub.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0580000-0000-0000-0000-000000000005', 'uma@pub.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0580000-0000-0000-0000-000000000006', 'bob@pubb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0580000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001058', 'admin',   'administrator',      'Boss',     'boss@pub.example', 'pubboss'::ltree,          null,                                   null),
  ('a0580000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001058', 'manager', 'sales_manager',      'Mia Mgr',  'mia@pub.example',  'pubboss.mia'::ltree,      'a0580000-0000-0000-0000-000000000001', null),
  ('a0580000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001058', 'rep',     'sales_professional', 'Rita Rep', 'rita@pub.example', 'pubboss.mia.rita'::ltree, 'a0580000-0000-0000-0000-000000000002', null),
  ('a0580000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001058', 'rep',     'sales_professional', 'Dee Rep',  'dee@pub.example',  'pubboss.mia.dee'::ltree,  'a0580000-0000-0000-0000-000000000002', now()),
  ('a0580000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001058', 'rep',     'sales_professional', 'Uma Rep',  'uma@pub.example',  null,                      null,                                   null),
  ('a0580000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001158', 'admin',   'administrator',      'Bob',      'bob@pubb.example', 'pubbob'::ltree,           null,                                   null);

insert into referral_form_links (id, org_id, link_type, user_id, token, retired_at) values
  ('a058c000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001058', 'user',   'a0580000-0000-0000-0000-000000000003', 'ritaLinkToken0000001', null),
  ('a058c000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001058', 'user',   'a0580000-0000-0000-0000-000000000004', 'deeLinkToken00000001', null),
  ('a058c000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001058', 'user',   'a0580000-0000-0000-0000-000000000005', 'umaLinkToken00000001', null),
  ('a058c000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001058', 'tenant', null,                                   'tenantLinkToken00001', null),
  ('a058c000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001058', 'user',   'a0580000-0000-0000-0000-000000000003', 'retiredLinkToken0001', now()),
  ('a058c000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001058', 'user',   'a0580000-0000-0000-0000-000000000006', 'foreignLinkToken0001', null),
  ('a058c000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000001158', 'tenant', null,                                   'orgBTenantToken00001', null),
  ('a058c000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000001258', 'tenant', null,                                   'orgCTenantToken00001', null);

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

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

-- The three named submissions this user can see, by company, comma-joined.
create or replace function _t_seen(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform _t_act(p_user);
  select string_agg(s.company_name, ',' order by s.company_name) into v
    from referral_form_submissions s
   where s.id in (current_setting('t.s_rita')::uuid, current_setting('t.s_mia')::uuid, current_setting('t.s_queue')::uuid);
  return coalesce(v, '');
end $$;

-- 1. Privileges (before any role switch).
do $$ begin
  if not has_function_privilege('service_role', 'public.portal_public_form(text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.portal_public_counts(text, text, text)', 'EXECUTE') then
    raise exception 'service_role should execute the public form functions';
  end if;
  if has_function_privilege('authenticated', 'public.portal_public_form(text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_public_form(text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.portal_public_rate(text, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.portal_public_rate(text, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_public_rate(text, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.portal_public_counts(text, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_public_counts(text, text, text)', 'EXECUTE') then
    raise exception 'the public form functions are service role only, and portal_public_rate is internal to portal_public_counts';
  end if;
  if has_function_privilege('service_role', 'public._portal_public_link(text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._portal_public_link(text, text)', 'EXECUTE') then
    raise exception '_portal_public_link is private';
  end if;
  if not has_column_privilege('authenticated', 'public.referral_form_submissions', 'company_name', 'SELECT')
     or not has_column_privilege('authenticated', 'public.referral_form_submissions', 'assigned_user_id', 'SELECT')
     or has_column_privilege('authenticated', 'public.referral_form_submissions', 'submitter_ip', 'SELECT')
     or has_table_privilege('authenticated', 'public.referral_form_submissions', 'INSERT')
     or has_table_privilege('authenticated', 'public.referral_form_submissions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.referral_form_submissions', 'DELETE')
     or has_table_privilege('anon', 'public.referral_form_submissions', 'SELECT') then
    raise exception 'authenticated reads submissions (never the IP) and writes none; anon gets nothing';
  end if;
end $$;

-- 2. What the form shows, and the one generic "nothing" for every unavailable case.
do $$ declare v record; r record; n integer; begin
  select * into v from public.portal_public_form('  PF-PUB ', 'ritaLinkToken0000001');
  if v.org_name is distinct from 'Public Org' or v.rep_name is distinct from 'Rita Rep'
     or v.consent_text is distinct from 'I may share this.' or v.consent_version is distinct from 2 then
    raise exception 'rita''s link shows the org, her name and the consent line, got %', row_to_json(v);
  end if;
  select * into v from public.portal_public_form('pf-pub', 'tenantLinkToken00001');
  if v.org_name is distinct from 'Public Org' or v.rep_name is not null then
    raise exception 'the tenant link shows no rep name, got %', row_to_json(v);
  end if;
  select * into v from public.portal_public_form('pf-pub', 'deeLinkToken00000001');
  if v.org_name is distinct from 'Public Org' or v.rep_name is not null then
    raise exception 'a deactivated rep''s link works but shows no name, got %', row_to_json(v);
  end if;
  select * into v from public.portal_public_form('pf-pub', 'umaLinkToken00000001');
  if v.org_name is distinct from 'Public Org' or v.rep_name is not null then
    raise exception 'an unplaced rep''s link works but shows no name, got %', row_to_json(v);
  end if;
  select * into v from public.portal_public_form('pf-pub-b', 'orgBTenantToken00001');
  if v.org_name is not null then raise exception 'org B has the public form off'; end if;

  for r in select * from (values
      ('pf-pub'::text,   'retiredLinkToken0001'::text),
      ('pf-pub',         'noSuchLinkToken00001'),
      ('pf-pub-b',       'orgBTenantToken00001'),
      ('pf-pub-c',       'orgCTenantToken00001'),
      ('pf-pub',         'foreignLinkToken0001'),
      ('pf-pub-b',       'ritaLinkToken0000001'),
      ('pf-pub',         'RITALINKTOKEN0000001'),
      ('pf-pub',         null),
      (null,             'ritaLinkToken0000001')
    ) t(s, k) loop
    select count(*) into n from public.portal_public_form(r.s, r.k);
    if n <> 0 then raise exception 'expected nothing for % %', r.s, r.k; end if;
  end loop;
end $$;

-- 3. Submitting: what is stored and where it is routed.
do $$ declare v record; s referral_form_submissions; n integer; begin
  select * into v from public.portal_public_submit(
    'pf-pub', 'ritaLinkToken0000001', '  Fresh Bakery ', ' Ann Owner ', ' ANN@Bakery.Example ',
    '(555) 010-0100', ' Needs a new terminal. ', ' Joe at the bank ', ' Joe@Bank.Example ', 2, '198.51.100.1');
  if v.id is null or v.ref <> 'REF-' || upper(left(v.id::text, 8)) or v.org_name <> 'Public Org' then
    raise exception 'submit returns the id, the reference and the org name, got %', row_to_json(v);
  end if;
  select * into s from referral_form_submissions where id = v.id;
  if s.org_id <> '00000000-0000-0000-0000-000000001058'
     or s.assigned_user_id is distinct from 'a0580000-0000-0000-0000-000000000003'
     or s.link_type <> 'user' or s.form_link_id <> 'a058c000-0000-0000-0000-000000000001'
     or s.company_name <> 'Fresh Bakery' or s.contact_name <> 'Ann Owner'
     or s.contact_email <> 'ann@bakery.example' or s.contact_phone <> '(555) 010-0100'
     or s.notes <> 'Needs a new terminal.' or s.referred_by_text <> 'Joe at the bank'
     or s.referrer_email is distinct from 'joe@bank.example'
     or s.consent_version <> 2 or s.consent_text_snapshot <> 'I may share this.'
     or s.submitter_ip <> '198.51.100.1' or s.triaged_at is not null or s.outcome is not null then
    raise exception 'stored submission is wrong: %', row_to_json(s);
  end if;
  perform set_config('t.s_rita', v.id::text, true);
  -- The IP lives only on the submission row, where the 2B-2 purge can erase it; the audit row has none.
  if not exists (select 1 from portal_audit_log a
                  where a.org_id = '00000000-0000-0000-0000-000000001058' and a.action = 'public_submit'
                    and a.ip is null and a.portal_user_id is null and a.actor_user_id is null) then
    raise exception 'a public submission is audited';
  end if;
  if exists (select 1 from portal_audit_log a where a.action = 'public_submit' and a.ip is not null) then
    raise exception 'a public submission audit row never carries the IP';
  end if;

  select * into v from public.portal_public_submit(
    'pf-pub', 'deeLinkToken00000001', 'Corner Cafe', 'Cal', 'cal@cafe.example', '555 010 0101', 'Wants a quote.', '  ', null, 2, '198.51.100.2');
  select * into s from referral_form_submissions where id = v.id;
  if s.assigned_user_id is distinct from 'a0580000-0000-0000-0000-000000000002' or s.referred_by_text is not null
     or s.referrer_email is not null then
    raise exception 'a deactivated rep''s link routes to their manager; blank "who referred" and no referrer email are null';
  end if;
  perform set_config('t.s_mia', v.id::text, true);

  select * into v from public.portal_public_submit(
    'pf-pub', 'umaLinkToken00000001', 'Uma Co', 'Una', 'una@uma.example', '555 010 0102', 'Call after 3.', null, null, 2, '198.51.100.3');
  if (select assigned_user_id from referral_form_submissions where id = v.id) is not null then
    raise exception 'an unplaced rep with no manager routes to the administrator queue';
  end if;

  select * into v from public.portal_public_submit(
    'pf-pub', 'tenantLinkToken00001', 'Tenant Co', 'Tia', 'tia@tenant.example', '555 010 0103', 'Saw the website.', null, null, 2, '198.51.100.4');
  select * into s from referral_form_submissions where id = v.id;
  if s.assigned_user_id is not null or s.link_type <> 'tenant' then
    raise exception 'the tenant link goes to the administrator queue';
  end if;
  perform set_config('t.s_queue', v.id::text, true);

  select count(*) into n from referral_form_submissions;
  if (select count(*) from public.portal_public_submit(
        'pf-pub', 'retiredLinkToken0001', 'Ghost Co', 'G', 'g@ghost.example', '555 010 0104', 'n', null, null, 2, '198.51.100.5')) <> 0
     or (select count(*) from public.portal_public_submit(
        'pf-pub-b', 'orgBTenantToken00001', 'Ghost Co', 'G', 'g@ghost.example', '555 010 0104', 'n', null, null, 0, '198.51.100.5')) <> 0 then
    raise exception 'an unavailable link answers with nothing';
  end if;
  if (select count(*) from referral_form_submissions) <> n then
    raise exception 'an unavailable link writes nothing';
  end if;
end $$;

-- 4. Field rules and the consent version.
do $$ begin
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','  ','Ann','a@b.example','5550100100','Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:companyName');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001',repeat('x',161),'Ann','a@b.example','5550100100','Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:companyName');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','','a@b.example','5550100100','Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:contactName');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','nope','5550100100','Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:email');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann',null,'5550100100','Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:email');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','555-01',  'Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:phone');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example',null,'Notes.',null,null,2,'198.51.100.9')$q$, 'invalid_input:phone');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','5550100100','  ',null,null,2,'198.51.100.9')$q$, 'invalid_input:notes');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','5550100100',repeat('n',4001),null,null,2,'198.51.100.9')$q$, 'invalid_input:notes');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','5550100100','Notes.',repeat('r',161),null,2,'198.51.100.9')$q$, 'invalid_input:referredBy');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','5550100100','Notes.',null,'not-an-email',2,'198.51.100.9')$q$, 'invalid_input:referrerEmail');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','5550100100','Notes.',null,repeat('e',250) || '@b.co',2,'198.51.100.9')$q$, 'invalid_input:referrerEmail');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Co','Ann','a@b.example','5550100100','Notes.',null,null,1,'198.51.100.9')$q$, 'consent_changed');
end $$;

-- 5. The per-IP count spans every org and only the window.
do $$ begin
  insert into referral_form_submissions
    (org_id, form_link_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
     consent_version, consent_text_snapshot, submitter_ip, submitted_at) values
    ('00000000-0000-0000-0000-000000001158', 'a058c000-0000-0000-0000-000000000007', 'tenant', 'Rate Co 1', 'R', 'r@x.example', '5550100100', 'n', 0, 'c', '192.0.2.50', now() - interval '10 minutes'),
    ('00000000-0000-0000-0000-000000001058', 'a058c000-0000-0000-0000-000000000004', 'tenant', 'Rate Co 2', 'R', 'r@x.example', '5550100100', 'n', 2, 'c', '192.0.2.50', now() - interval '20 minutes'),
    ('00000000-0000-0000-0000-000000001058', 'a058c000-0000-0000-0000-000000000004', 'tenant', 'Rate Co 3', 'R', 'r@x.example', '5550100100', 'n', 2, 'c', '192.0.2.50', now() - interval '2 hours');
  if public.portal_public_rate('192.0.2.50', 60) <> 2 then
    raise exception 'the last hour counts across orgs, got %', public.portal_public_rate('192.0.2.50', 60);
  end if;
  if public.portal_public_rate('192.0.2.50', 180) <> 3 then
    raise exception 'a wider window counts more';
  end if;
  if public.portal_public_rate('192.0.2.51', 60) <> 0
     or public.portal_public_rate(null, 60) <> 0
     or public.portal_public_rate('  ', 60) <> 0 then
    raise exception 'an unseen or blank IP counts zero';
  end if;
end $$;

-- 6. The hard limit: 30 per IP per hour, whatever the edge decided (even with a passed check).
do $$ begin
  for i in 1..30 loop
    perform public.portal_public_submit('pf-pub', 'tenantLinkToken00001', 'Cap Co ' || i, 'Cap', 'cap@cap.example',
                                        '555 010 0110', 'Needs a terminal.', null, null, 2, '203.0.113.30', true);
  end loop;
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub','tenantLinkToken00001','Cap Co 31','Cap','cap@cap.example','555 010 0110','Needs a terminal.',null,null,2,'203.0.113.30',true)$q$, 'rate_limited');
  if (select count(*) from public.portal_public_submit('pf-pub', 'tenantLinkToken00001', 'Other IP Co', 'Oz', 'oz@other.example',
                                                       '555 010 0111', 'Fine.', null, null, 2, '203.0.113.31', true)) <> 1 then
    raise exception 'another IP is not limited';
  end if;
end $$;

-- 6b. Server-keyed limits (R6): per link soft count, 50 per link and 200 per org per hour.
do $$ declare c record; begin
  insert into organizations (id, name, slug, invite_code, portal_enabled, consent_text, consent_version) values
    ('00000000-0000-0000-0000-000000001358', 'Public Org D', 'pf-pub-d', 'pf-pub-d-a1', true, null, 0);
  update organizations set public_form_enabled = true where id = '00000000-0000-0000-0000-000000001358';
  insert into referral_form_links (id, org_id, link_type, user_id, token, retired_at) values
    ('a058c000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000001358', 'tenant', null, 'orgDTenantToken00001', null),
    ('a058c000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000001358', 'tenant', null, 'orgDRetiredToken0001', now());

  select * into c from public.portal_public_counts('pf-pub-d', 'orgDTenantToken00001', '198.51.100.77');
  if c.ip_count <> 0 or c.link_count <> 0 then raise exception 'fresh counts are zero'; end if;
  select * into c from public.portal_public_counts('pf-pub-d', 'nopeNopeNopeNope0001', '198.51.100.77');
  if c.link_count <> 0 then raise exception 'a dead link counts zero, got %', c.link_count; end if;

  -- 12 recent on the link (different IPs), one old: link_count is 12 and the IP count is separate.
  insert into referral_form_submissions
    (org_id, form_link_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
     consent_version, consent_text_snapshot, submitter_ip, submitted_at)
  select '00000000-0000-0000-0000-000000001358', 'a058c000-0000-0000-0000-0000000000d1', 'tenant', 'Link Co ' || g, 'L',
         'l@x.example', '5550100100', 'n', 0, 'c', '192.0.2.' || (100 + g), now() - interval '5 minutes'
    from generate_series(1, 12) g;
  insert into referral_form_submissions
    (org_id, form_link_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
     consent_version, consent_text_snapshot, submitter_ip, submitted_at) values
    ('00000000-0000-0000-0000-000000001358', 'a058c000-0000-0000-0000-0000000000d1', 'tenant', 'Old Co', 'L',
     'l@x.example', '5550100100', 'n', 0, 'c', '192.0.2.99', now() - interval '3 hours');
  select * into c from public.portal_public_counts('pf-pub-d', 'orgDTenantToken00001', '192.0.2.101');
  if c.link_count <> 12 or c.ip_count <> 1 then raise exception 'link 12 / ip 1, got % / %', c.link_count, c.ip_count; end if;
  select * into c from public.portal_public_counts('pf-pub-d', 'orgDTenantToken00001', null);
  if c.link_count <> 12 or c.ip_count <> 0 then raise exception 'a null IP counts zero but the link still counts'; end if;

  -- Link hard cap: top up to 50, the 51st is refused whatever the IP; the org is not full.
  insert into referral_form_submissions
    (org_id, form_link_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
     consent_version, consent_text_snapshot, submitter_ip, submitted_at)
  select '00000000-0000-0000-0000-000000001358', 'a058c000-0000-0000-0000-0000000000d1', 'tenant', 'Link Co x' || g, 'L',
         'l@x.example', '5550100100', 'n', 0, 'c', '192.0.3.' || g, now() - interval '5 minutes'
    from generate_series(1, 38) g;
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub-d','orgDTenantToken00001','Over','Ann','a@b.example','5550100100','Notes.',null,null,0,'198.51.100.200')$q$, 'rate_limited');

  -- Org hard cap: 150 on a retired link brings the org to 200; a fresh link with no recent rows is still refused.
  delete from referral_form_submissions where form_link_id = 'a058c000-0000-0000-0000-0000000000d1' and submitted_at > now() - interval '1 hour';
  insert into referral_form_submissions
    (org_id, form_link_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
     consent_version, consent_text_snapshot, submitter_ip, submitted_at)
  select '00000000-0000-0000-0000-000000001358', 'a058c000-0000-0000-0000-0000000000d2', 'tenant', 'Org Co ' || g, 'L',
         'l@x.example', '5550100100', 'n', 0, 'c', '192.0.4.' || (g % 250), now() - interval '5 minutes'
    from generate_series(1, 199) g;
  if (select count(*) from public.portal_public_submit('pf-pub-d','orgDTenantToken00001','Org 200','Ann','a@b.example','5550100100','Notes.',null,null,0,'198.51.100.201')) <> 1 then
    raise exception 'the 200th in the org is allowed';
  end if;
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub-d','orgDTenantToken00001','Org 201','Ann','a@b.example','5550100100','Notes.',null,null,0,'198.51.100.202')$q$, 'rate_limited');
end $$;

-- 6c. The soft limits in SQL too, so a parallel burst cannot race past the edge's
-- pre-check: 10 per link or 5 per IP an hour (or no IP at all) needs a passed check.
do $$ begin
  insert into organizations (id, name, slug, invite_code, portal_enabled, consent_text, consent_version) values
    ('00000000-0000-0000-0000-000000001458', 'Public Org E', 'pf-pub-e', 'pf-pub-e-a1', true, null, 0),
    ('00000000-0000-0000-0000-000000001558', 'Public Org F', 'pf-pub-f', 'pf-pub-f-a1', true, null, 0);
  update organizations set public_form_enabled = true
   where id in ('00000000-0000-0000-0000-000000001458', '00000000-0000-0000-0000-000000001558');
  insert into referral_form_links (id, org_id, link_type, user_id, token, retired_at) values
    ('a058c000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000001458', 'tenant', null, 'orgETenantToken00001', null),
    ('a058c000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000001558', 'tenant', null, 'orgFTenantToken00001', null);

  -- Link: 9 recent (distinct IPs) and one over an hour old, which does not count.
  insert into referral_form_submissions
    (org_id, form_link_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
     consent_version, consent_text_snapshot, submitter_ip, submitted_at)
  select '00000000-0000-0000-0000-000000001458', 'a058c000-0000-0000-0000-0000000000e1', 'tenant', 'Soft Co ' || g, 'L',
         'l@x.example', '5550100100', 'n', 0, 'c', '192.0.5.' || g, now() - interval '5 minutes'
    from generate_series(1, 9) g;
  insert into referral_form_submissions
    (org_id, form_link_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
     consent_version, consent_text_snapshot, submitter_ip, submitted_at) values
    ('00000000-0000-0000-0000-000000001458', 'a058c000-0000-0000-0000-0000000000e1', 'tenant', 'Soft Old', 'L',
     'l@x.example', '5550100100', 'n', 0, 'c', '192.0.5.200', now() - interval '61 minutes');
  if (select count(*) from public.portal_public_submit('pf-pub-e','orgETenantToken00001','Tenth','Ann','a@b.example','5550100100','Notes.',null,null,0,'198.51.100.210')) <> 1 then
    raise exception 'at 9 on the link a send without the check goes through (the old row is not counted)';
  end if;
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub-e','orgETenantToken00001','Eleventh','Ann','a@b.example','5550100100','Notes.',null,null,0,'198.51.100.211')$q$, 'captcha_required');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub-e','orgETenantToken00001','Eleventh','Ann','a@b.example','5550100100','Notes.',null,null,0,'198.51.100.211',false)$q$, 'captcha_required');
  if (select count(*) from public.portal_public_submit('pf-pub-e','orgETenantToken00001','Eleventh','Ann','a@b.example','5550100100','Notes.',null,null,0,'198.51.100.211',true)) <> 1 then
    raise exception 'at 10 on the link a passed check goes through';
  end if;

  -- Link hard cap boundary: 11 recent now; top up to 49, the 50th goes through, the 51st does not.
  insert into referral_form_submissions
    (org_id, form_link_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
     consent_version, consent_text_snapshot, submitter_ip, submitted_at)
  select '00000000-0000-0000-0000-000000001458', 'a058c000-0000-0000-0000-0000000000e1', 'tenant', 'Soft Co x' || g, 'L',
         'l@x.example', '5550100100', 'n', 0, 'c', '192.0.6.' || g, now() - interval '5 minutes'
    from generate_series(1, 38) g;
  if (select count(*) from public.portal_public_submit('pf-pub-e','orgETenantToken00001','Fiftieth','Ann','a@b.example','5550100100','Notes.',null,null,0,'198.51.100.212',true)) <> 1 then
    raise exception 'the 50th on the link is allowed';
  end if;
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub-e','orgETenantToken00001','Fifty-first','Ann','a@b.example','5550100100','Notes.',null,null,0,'198.51.100.213',true)$q$, 'rate_limited');

  -- IP: 4 recent from one address on another org's link and one old; the 5th goes through, then the check is needed.
  insert into referral_form_submissions
    (org_id, form_link_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
     consent_version, consent_text_snapshot, submitter_ip, submitted_at)
  select '00000000-0000-0000-0000-000000001158', 'a058c000-0000-0000-0000-000000000007', 'tenant', 'Ip Co ' || g, 'L',
         'l@x.example', '5550100100', 'n', 0, 'c', '203.0.113.60', now() - interval '5 minutes'
    from generate_series(1, 4) g;
  insert into referral_form_submissions
    (org_id, form_link_id, link_type, company_name, contact_name, contact_email, contact_phone, notes,
     consent_version, consent_text_snapshot, submitter_ip, submitted_at) values
    ('00000000-0000-0000-0000-000000001158', 'a058c000-0000-0000-0000-000000000007', 'tenant', 'Ip Old', 'L',
     'l@x.example', '5550100100', 'n', 0, 'c', '203.0.113.60', now() - interval '61 minutes');
  if (select count(*) from public.portal_public_submit('pf-pub-f','orgFTenantToken00001','Ip Fifth','Ann','a@b.example','5550100100','Notes.',null,null,0,'203.0.113.60')) <> 1 then
    raise exception 'at 4 from an IP a send without the check goes through (the old row is not counted)';
  end if;
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub-f','orgFTenantToken00001','Ip Sixth','Ann','a@b.example','5550100100','Notes.',null,null,0,'203.0.113.60')$q$, 'captcha_required');
  if (select count(*) from public.portal_public_submit('pf-pub-f','orgFTenantToken00001','Ip Sixth','Ann','a@b.example','5550100100','Notes.',null,null,0,'203.0.113.60',true)) <> 1 then
    raise exception 'at 5 from an IP a passed check goes through';
  end if;

  -- No IP at all counts as over the per-IP limit (R3).
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub-f','orgFTenantToken00001','No Ip','Ann','a@b.example','5550100100','Notes.',null,null,0,null)$q$, 'captcha_required');
  perform _t_raises($q$select * from public.portal_public_submit('pf-pub-f','orgFTenantToken00001','No Ip','Ann','a@b.example','5550100100','Notes.',null,null,0,'   ')$q$, 'captcha_required');
  if (select count(*) from public.portal_public_submit('pf-pub-f','orgFTenantToken00001','No Ip','Ann','a@b.example','5550100100','Notes.',null,null,0,null,true)) <> 1 then
    raise exception 'no IP with a passed check goes through';
  end if;
end $$;

-- 7. Who can read a submission (role switches from here on).
do $$ declare v text; begin
  v := _t_seen('a0580000-0000-0000-0000-000000000003');
  if v <> 'Fresh Bakery' then raise exception 'rita sees only her own, got %', v; end if;
  v := _t_seen('a0580000-0000-0000-0000-000000000002');
  if v <> 'Corner Cafe,Fresh Bakery' then raise exception 'mia sees hers and her rep''s, got %', v; end if;
  v := _t_seen('a0580000-0000-0000-0000-000000000001');
  if v <> 'Corner Cafe,Fresh Bakery,Tenant Co' then raise exception 'an administrator sees everything including the queue, got %', v; end if;
  v := _t_seen('a0580000-0000-0000-0000-000000000005');
  if v <> '' then raise exception 'an unplaced rep sees nobody else''s, got %', v; end if;
  v := _t_seen('a0580000-0000-0000-0000-000000000006');
  if v <> '' then raise exception 'another org sees nothing, got %', v; end if;
end $$;

rollback;
