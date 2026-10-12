-- Tests for 20261014000005_portal_code_email_brand (Partner Portal Phase 1C).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/049_portal_code_email_brand.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only function).
--
-- Fixture: org portal-brand (with a branding row) and org portal-plain (without),
-- each with one active portal user.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001049', 'Brand ISO', 'portal-brand', 'portal-brand-a1', true),
  ('00000000-0000-0000-0000-000000001149', 'Plain ISO', 'portal-plain', 'portal-plain-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0490000-0000-0000-0000-000000000001', 'boss@brand.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0490000-0000-0000-0000-000000000002', 'boss@plain.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('a0490000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001049', 'admin', 'administrator', 'Boss', 'boss@brand.example', 'brandboss'::ltree),
  ('a0490000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001149', 'admin', 'administrator', 'Boss', 'boss@plain.example', 'plainboss'::ltree);

insert into org_branding (org_id, logo_url, primary_color) values
  ('00000000-0000-0000-0000-000000001049', 'https://cdn.example/brand-iso.png', '#0A7C45');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a049a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001049', 'a0490000-0000-0000-0000-000000000001', 'a0490000-0000-0000-0000-000000000001', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@brand.example'),
  ('a049a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001149', 'a0490000-0000-0000-0000-000000000002', 'a0490000-0000-0000-0000-000000000002', 'Pat CPA',  'Pat & Co',  'cpa', 'pat@plain.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a049b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001049', 'a049a000-0000-0000-0000-000000000001', 'jane@brand.example', 'active'),
  ('a049b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001149', 'a049a000-0000-0000-0000-000000000002', 'pat@plain.example',  'active');

-- Privileges survive the drop and recreate.
do $$ begin
  if has_function_privilege('authenticated', 'public.portal_issue_code(text, text, text)', 'EXECUTE') then raise exception 'authenticated must not execute portal_issue_code'; end if;
  if has_function_privilege('anon', 'public.portal_issue_code(text, text, text)', 'EXECUTE') then raise exception 'anon must not execute portal_issue_code'; end if;
  if not has_function_privilege('service_role', 'public.portal_issue_code(text, text, text)', 'EXECUTE') then raise exception 'service_role should execute portal_issue_code'; end if;
end $$;

-- A branded org returns its logo and color with the code.
do $$ declare r record; begin
  select * into r from public.portal_issue_code('portal-brand', 'jane@brand.example', '10.49.0.1');
  if r.code is null or r.code !~ '^\d{6}$' then raise exception 'a code should still be issued, got %', r.code; end if;
  if r.recipient <> 'jane@brand.example' or r.org_name <> 'Brand ISO' or r.org_slug <> 'portal-brand' then
    raise exception 'the 1A columns must be unchanged: %', row_to_json(r);
  end if;
  if r.logo_url is distinct from 'https://cdn.example/brand-iso.png' or r.primary_color is distinct from '#0A7C45' then
    raise exception 'the brand columns are wrong: %', row_to_json(r);
  end if;
end $$;

-- An org without a branding row returns nulls.
do $$ declare r record; begin
  select * into r from public.portal_issue_code('portal-plain', 'pat@plain.example', '10.49.0.2');
  if r.code is null then raise exception 'plain org should still issue a code'; end if;
  if r.logo_url is not null or r.primary_color is not null then
    raise exception 'no branding row means null brand columns: %', row_to_json(r);
  end if;
end $$;

-- Unknown email: still zero rows, still audited (1A behavior kept).
do $$ declare n int; before int; begin
  select count(*) into before from portal_audit_log where action = 'code_request' and ip = '10.49.0.3';
  select count(*) into n from public.portal_issue_code('portal-brand', 'nobody@brand.example', '10.49.0.3');
  if n <> 0 then raise exception 'an unknown email gets no row'; end if;
  if (select count(*) from portal_audit_log where action = 'code_request' and ip = '10.49.0.3') <> before + 1 then
    raise exception 'every request still counts toward the per-IP limit';
  end if;
end $$;

rollback;
