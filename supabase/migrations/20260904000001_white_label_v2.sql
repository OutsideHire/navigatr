-- 20260904000001_white_label_v2.sql
--
-- White-label v2: real logo uploads (public bucket), an optional dark-mode
-- logo, and admin-only branding edits. Builds on the org_branding table +
-- update_org_branding RPC from 20260528000001 / 20260528000003.
--
-- Three changes, all additive except the tightened authz:
--   1. org_branding.dark_logo_url column (optional dark-mode logo).
--   2. A PUBLIC storage bucket `org-logos` for uploaded logos, with
--      admin-only, org-scoped writes. Public because a logo must render on
--      the top bar (and, later, the login page + emails) without a signed
--      URL. Deal files / voice notes stay PRIVATE; this is the first public
--      bucket and holds only non-sensitive brand art.
--   3. update_org_branding: gated to ADMIN only (was manager-or-admin), and
--      it now also writes dark_logo_url. Since the settings form always
--      submits the FULL desired state, each field is set from its param
--      (null / '' clears the logo(s) and color) rather than coalesced-kept,
--      so "Remove logo" and "Reset to defaults" actually clear. product_name
--      and show_powered_by keep their not-null defaults.

-- 1. Optional dark-mode logo -------------------------------------------------
alter table org_branding add column if not exists dark_logo_url text;

-- 2. Public logo bucket + policies ------------------------------------------
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

-- Read: the bucket is public (served by public URL without auth); this SELECT
-- policy additionally allows the authenticated API to read/list objects.
drop policy if exists "org_logos_read" on storage.objects;
create policy "org_logos_read" on storage.objects
  for select using (bucket_id = 'org-logos');

-- Write (insert/update/delete): only an ADMIN, and only within their own
-- org's folder. Path convention is `<org_id>/<file>`, so foldername[1] is the
-- org id. Mirrors the org-scoping used by deal-files, tightened to admin.
drop policy if exists "org_logos_insert" on storage.objects;
create policy "org_logos_insert" on storage.objects
  for insert with check (
    bucket_id = 'org-logos'
    and public.caller_is_admin()
    and (storage.foldername(name))[1] = public.user_org_id()::text
  );

drop policy if exists "org_logos_update" on storage.objects;
create policy "org_logos_update" on storage.objects
  for update using (
    bucket_id = 'org-logos'
    and public.caller_is_admin()
    and (storage.foldername(name))[1] = public.user_org_id()::text
  );

drop policy if exists "org_logos_delete" on storage.objects;
create policy "org_logos_delete" on storage.objects
  for delete using (
    bucket_id = 'org-logos'
    and public.caller_is_admin()
    and (storage.foldername(name))[1] = public.user_org_id()::text
  );

-- 3. update_org_branding: admin-only + dark logo + set-directly -------------
-- Drop the old 4-arg signature so PostgREST resolves the new 5-arg one
-- unambiguously (a differing arg count would otherwise create an overload).
drop function if exists update_org_branding(text, text, text, boolean);

create or replace function update_org_branding(
  p_product_name     text default null,
  p_primary_color    text default null,
  p_logo_url         text default null,
  p_show_powered_by  boolean default null,
  p_dark_logo_url    text default null
)
returns org_branding
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id   uuid;
  v_caller   user_role;
  v_result   org_branding;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select p.org_id, p.role
    into v_org_id, v_caller
    from profiles p
   where p.id = auth.uid();

  if v_org_id is null then
    raise exception 'no_org';
  end if;
  -- Admin-only (tightened from manager-or-admin): branding is the org's
  -- identity, owned by the account administrator.
  if v_caller <> 'admin' then
    raise exception 'not_authorized';
  end if;

  -- Primary color: if provided non-empty, must be a #rrggbb hex.
  if p_primary_color is not null
     and p_primary_color <> ''
     and p_primary_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'invalid_primary_color';
  end if;

  -- Logo URLs: if provided non-empty, must look like an http(s) URL. We do
  -- not fetch them here (SECURITY DEFINER network calls are a footgun).
  if p_logo_url is not null and p_logo_url <> '' and p_logo_url !~* '^https?://' then
    raise exception 'invalid_logo_url';
  end if;
  if p_dark_logo_url is not null and p_dark_logo_url <> '' and p_dark_logo_url !~* '^https?://' then
    raise exception 'invalid_dark_logo_url';
  end if;

  -- Upsert the FULL desired state. The settings form always submits every
  -- field, so each column is set directly from its param: an empty/blank
  -- logo or a null color CLEARS that field (back to the design default),
  -- which is what "Remove logo" and "Reset to defaults" need. product_name
  -- and show_powered_by are not-null, so they fall back to their defaults.
  insert into org_branding (
    org_id, product_name, primary_color, logo_url, dark_logo_url, show_powered_by
  ) values (
    v_org_id,
    coalesce(p_product_name, 'navigatr'),
    nullif(p_primary_color, ''),
    nullif(p_logo_url, ''),
    nullif(p_dark_logo_url, ''),
    coalesce(p_show_powered_by, true)
  )
  on conflict (org_id) do update
    set product_name    = coalesce(p_product_name, 'navigatr'),
        primary_color   = nullif(p_primary_color, ''),
        logo_url        = nullif(p_logo_url, ''),
        dark_logo_url   = nullif(p_dark_logo_url, ''),
        show_powered_by = coalesce(p_show_powered_by, true),
        updated_at      = now()
  returning * into v_result;

  return v_result;
end $$;

grant execute on function update_org_branding(text, text, text, boolean, text) to authenticated;
