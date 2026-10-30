-- Tests for 20261029000005_portal_brand_powered_by (Partner Portal audit fixes, FR-PORT-82).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/076_portal_brand_powered_by.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- The "Powered by navigatr" switch (org_branding.show_powered_by) rides along
-- on every brand row the edge functions read: portal_brand, portal_issue_code
-- and portal_public_submit.
--
-- Org W1 pb-white: branded, show_powered_by false. Partner user jane, an admin and a tenant link.
-- Org W2 pb-default: branded, switch left at its default (true).
-- Org W3 pb-bare: no branding row at all.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, consent_text, consent_version) values
  ('00000000-0000-0000-0000-000000001076', 'White Org',   'pb-white',   'pb-white-a1',   true, 'I may share this.', 2),
  ('00000000-0000-0000-0000-000000001176', 'Default Org', 'pb-default', 'pb-default-a1', true, null, 0),
  ('00000000-0000-0000-0000-000000001276', 'Bare Org',    'pb-bare',    'pb-bare-a1',    true, null, 0);
update organizations set public_form_enabled = true where id = '00000000-0000-0000-0000-000000001076';

insert into org_branding (org_id, product_name, primary_color, logo_url, show_powered_by) values
  ('00000000-0000-0000-0000-000000001076', 'White Portal', '#0f766e', 'https://cdn.example/w.png', false);
insert into org_branding (org_id, product_name, primary_color) values
  ('00000000-0000-0000-0000-000000001176', 'Default Portal', '#112233');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0760000-0000-0000-0000-000000000001', 'boss@white.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('a0760000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001076', 'admin', 'administrator', 'Boss', 'boss@white.example', 'pbboss'::ltree);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a076a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001076', 'a0760000-0000-0000-0000-000000000001', 'a0760000-0000-0000-0000-000000000001', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@white.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a076b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001076', 'a076a000-0000-0000-0000-000000000001', 'jane@white.example', 'active');

insert into referral_form_links (id, org_id, link_type, user_id, token, retired_at) values
  ('a076c000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001076', 'tenant', null, 'whiteTenantToken0001', null);

-- 1. portal_brand: the switch is returned; a missing branding row means true.
do $$ declare r record; begin
  select * into r from public.portal_brand('pb-white');
  if r.show_powered_by is distinct from false then raise exception 'pb-white should hide Powered by: %', row_to_json(r); end if;
  if r.logo_url is distinct from 'https://cdn.example/w.png' or r.product_name is distinct from 'White Portal' then
    raise exception 'existing brand columns changed: %', row_to_json(r);
  end if;
  select * into r from public.portal_brand('pb-default');
  if r.show_powered_by is distinct from true then raise exception 'default should show Powered by'; end if;
  select * into r from public.portal_brand('pb-bare');
  if r.show_powered_by is distinct from true then raise exception 'a missing branding row should show Powered by'; end if;
end $$;

-- 2. The sign-in code row carries the switch too.
do $$ declare r record; begin
  select * into r from public.portal_issue_code('pb-white', 'jane@white.example', '10.7.6.1');
  if r.code is null or r.show_powered_by is distinct from false then
    raise exception 'issue_code should carry show_powered_by=false: %', row_to_json(r);
  end if;
  if r.logo_url is distinct from 'https://cdn.example/w.png' or r.org_slug is distinct from 'pb-white' then
    raise exception 'issue_code lost its existing columns: %', row_to_json(r);
  end if;
end $$;

-- 3. The public form confirmation row carries it as well.
do $$ declare r record; begin
  select * into r from public.portal_public_submit(
    'pb-white', 'whiteTenantToken0001', 'Switch Co', 'Sam', 'sam@switch.example', '5550760001', 'Notes.', null, null, 2, '198.51.100.76');
  if r.id is null or r.show_powered_by is distinct from false then
    raise exception 'public_submit should carry show_powered_by=false: %', row_to_json(r);
  end if;
end $$;

-- 4. Privileges are restated exactly: service_role only.
do $$ declare f text; begin
  foreach f in array array[
    'public.portal_brand(text)',
    'public.portal_issue_code(text, text, text)',
    'public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean, text, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception 'only service_role may execute %', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
end $$;

rollback;
