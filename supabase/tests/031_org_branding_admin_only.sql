-- Tests for 20260904000001_white_label_v2: update_org_branding.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/031_org_branding_admin_only.sql
--
-- Self-cleans via ROLLBACK. Verifies:
--   * an ADMIN can update branding, and the row is scoped to the admin's own org
--     and carries every field (incl. the new dark_logo_url),
--   * SET-DIRECTLY semantics: a blank logo / dark logo / color CLEARS that field
--     (needed for "Remove logo" and "Reset to defaults"),
--   * a MANAGER and a REP both get not_authorized (tightened from manager-or-admin
--     to admin-only).
-- Org-scoping is proven by the admin case: the returned row's org_id is the
-- caller's own org, and the RPC only ever inserts/updates that org's row.
--
-- Storage note: the org-logos storage.objects policies use the same
-- caller_is_admin() + org-folder gate; this DB-test harness runs postgres
-- without the storage service and the psql role does not own storage.objects
-- (see 019_deal_children_hierarchy_scope), so those policies are validated by
-- inspection, mirroring the proven deal-files pattern. Only the RPC is asserted.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000ba', 'Brand A', 'brand-a', 'brand-a-test01');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('ba000000-0000-0000-0000-000000000001', 'admin_a@b.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('ba000000-0000-0000-0000-000000000002', 'mgr_a@b.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('ba000000-0000-0000-0000-000000000003', 'rep_a@b.example',   'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('ba000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ba', 'admin',   'Admin A', 'admin_a@b.example', 'top'::ltree),
  ('ba000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000ba', 'manager', 'Mgr A',   'mgr_a@b.example',   'top.mgr'::ltree),
  ('ba000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000ba', 'rep',     'Rep A',   'rep_a@b.example',   'top.mgr.rep'::ltree);

-- Admin can update; row scoped to their org + carries every field.
do $$
declare r org_branding;
begin
  perform set_config('request.jwt.claim.sub', 'ba000000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  r := update_org_branding(
    p_product_name  := 'Brand A App',
    p_primary_color := '#2456e6',
    p_logo_url      := 'https://cdn.example.com/a-logo.png',
    p_dark_logo_url := 'https://cdn.example.com/a-dark.png'
  );
  if r.org_id <> '00000000-0000-0000-0000-0000000000ba' then
    raise exception 'branding wrote wrong org: %', r.org_id;
  end if;
  if r.product_name <> 'Brand A App'
     or r.primary_color <> '#2456e6'
     or r.logo_url <> 'https://cdn.example.com/a-logo.png'
     or r.dark_logo_url <> 'https://cdn.example.com/a-dark.png' then
    raise exception 'branding row not saved as sent: %', r;
  end if;
end $$;

-- Set-directly: blank logo / dark logo / color CLEARS the field.
do $$
declare r org_branding;
begin
  perform set_config('request.jwt.claim.sub', 'ba000000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  r := update_org_branding(
    p_product_name  := 'Brand A App',
    p_primary_color := null,
    p_logo_url      := '',
    p_dark_logo_url := ''
  );
  if r.logo_url is not null or r.dark_logo_url is not null or r.primary_color is not null then
    raise exception 'set-directly did not clear: logo=% dark=% color=%', r.logo_url, r.dark_logo_url, r.primary_color;
  end if;
end $$;

-- Manager is NOT allowed (admin-only).
do $$
declare allowed boolean := false;
begin
  perform set_config('request.jwt.claim.sub', 'ba000000-0000-0000-0000-000000000002', true);
  perform set_config('role', 'authenticated', true);
  begin
    perform update_org_branding(p_product_name := 'Hijack');
    allowed := true;
  exception when others then
    if sqlerrm not like '%not_authorized%' then
      raise exception 'manager: expected not_authorized, got %', sqlerrm;
    end if;
  end;
  if allowed then raise exception 'manager was allowed to edit branding'; end if;
end $$;

-- Rep is NOT allowed.
do $$
declare allowed boolean := false;
begin
  perform set_config('request.jwt.claim.sub', 'ba000000-0000-0000-0000-000000000003', true);
  perform set_config('role', 'authenticated', true);
  begin
    perform update_org_branding(p_product_name := 'Hijack');
    allowed := true;
  exception when others then
    if sqlerrm not like '%not_authorized%' then
      raise exception 'rep: expected not_authorized, got %', sqlerrm;
    end if;
  end;
  if allowed then raise exception 'rep was allowed to edit branding'; end if;
end $$;

rollback;
