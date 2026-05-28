-- 20260528000003_org_branding_rpc.sql
--
-- Writes for the org_branding table created in 20260528000001_v1_foundation.
-- The base migration intentionally left out a write policy so all branding
-- changes flow through a single audited RPC instead of arbitrary client
-- UPDATE statements. This file adds that RPC.
--
-- Why an RPC, not an RLS UPDATE policy:
--   1. Branding changes are rare + admin-only — exactly the shape that
--      benefits from a single SECURITY DEFINER entry point.
--   2. We can upsert without forcing the client to know whether a row
--      exists. The frontend just calls update_org_branding(...).
--   3. Future hooks (audit log, theme-cache invalidation, image moderation
--      on logo_url) plug into one function instead of every UPDATE site.
--
-- Authz: caller must be manager or admin in the org. Reps can read their
-- own org's branding via the existing select policy, but cannot change it.
--
-- All params are nullable. NULL = "don't change this field." That lets the
-- UI submit partial updates without re-sending every value.

create or replace function update_org_branding(
  p_product_name     text default null,
  p_primary_color    text default null,
  p_logo_url         text default null,
  p_show_powered_by  boolean default null
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
  -- Authz: caller must be authenticated + manager/admin of their org.
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
  if v_caller not in ('manager', 'admin') then
    raise exception 'not_authorized';
  end if;

  -- Primary color shape: if provided, must be a #rrggbb hex. Stricter
  -- formats (rgba, hsl, named themes) will be relaxed in a v1.1 migration
  -- once the picker UI supports them.
  if p_primary_color is not null
     and p_primary_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'invalid_primary_color';
  end if;

  -- Logo URL: if provided, must look like an http(s) URL. We don't fetch
  -- the resource here (network calls from SECURITY DEFINER are a footgun);
  -- the frontend is responsible for previewing and reporting load failures.
  if p_logo_url is not null
     and p_logo_url <> ''
     and p_logo_url !~* '^https?://' then
    raise exception 'invalid_logo_url';
  end if;

  -- Upsert. ON CONFLICT (org_id) lets us insert-if-missing without an
  -- explicit existence check. COALESCE on each column preserves the
  -- existing value when the caller passed null. EXCLUDED is the
  -- conflict-row's proposed values (i.e. the INSERT side of the upsert).
  insert into org_branding (
    org_id,
    product_name,
    primary_color,
    logo_url,
    show_powered_by
  ) values (
    v_org_id,
    coalesce(p_product_name, 'navigatr'),
    p_primary_color,
    nullif(p_logo_url, ''),
    coalesce(p_show_powered_by, true)
  )
  on conflict (org_id) do update
    set product_name    = coalesce(p_product_name,    org_branding.product_name),
        primary_color   = coalesce(p_primary_color,   org_branding.primary_color),
        logo_url        = coalesce(nullif(p_logo_url, ''),  org_branding.logo_url),
        show_powered_by = coalesce(p_show_powered_by, org_branding.show_powered_by),
        updated_at      = now()
  returning * into v_result;

  return v_result;
end $$;

grant execute on function update_org_branding(text, text, text, boolean) to authenticated;
