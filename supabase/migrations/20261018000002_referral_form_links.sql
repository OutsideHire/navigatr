-- 20261018000002_referral_form_links.sql
--
-- Partner Portal Phase 2B-1 (PRD FR-PORT-24..28). Public referral form links.
-- Every active internal user can have one personal link and each tenant one
-- company link. A link is a routing key a rep re-copies and prints as a QR
-- code, not a credential, so the token is stored as is. Links never expire;
-- regenerating retires the old one (FR-PORT-27).
--
-- Ships dark: organizations.public_form_enabled defaults to false and has no
-- UI until Phase 2B-2, and while it is false the link RPCs create nothing.
--
-- Access model: referral_form_links has RLS on, no grants and no policies.
-- The three RPCs below are the only way in; portal_public_* (20261018000003)
-- reads links as the service role.

-- 1. Tenant switch (FR-PORT-28) ---------------------------------------------------
alter table organizations
  add column if not exists public_form_enabled boolean not null default false;

-- 2. Links ---------------------------------------------------------------------------
create table referral_form_links (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  link_type  text not null check (link_type in ('tenant','user')),
  user_id    uuid references profiles(id) on delete cascade,
  token      text not null unique constraint referral_form_links_token_check check (token ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint referral_form_links_user_matches_type check ((link_type = 'tenant') = (user_id is null))
);
create unique index referral_form_links_tenant_active_uidx
  on referral_form_links (org_id) where link_type = 'tenant' and retired_at is null;
create unique index referral_form_links_user_active_uidx
  on referral_form_links (org_id, user_id) where link_type = 'user' and retired_at is null;

alter table referral_form_links enable row level security;
-- Default privileges (20260813000002) gave authenticated full DML on new tables.
revoke all on referral_form_links from anon, authenticated;

-- 3. Routing for a user (FR-PORT-25, spec 4.4) ----------------------------------------
-- The user if active and placed (or an administrator), else the user's active
-- manager, else NULL = the administrator queue. referral_route_assignee
-- (20261007000001) is the same rule for a partner's owner, so it now calls this.
create or replace function public.referral_route_user(p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  with o as (
    select pr.id, pr.manager_id, pr.deactivated_at, pr.role_path, pr.role_level
    from profiles pr
    where pr.id = p_user
  ),
  m as (
    select pr.id, pr.deactivated_at from profiles pr where pr.id = (select manager_id from o)
  )
  select case
    when exists (select 1 from o)
         and (select deactivated_at from o) is null
         and ((select role_path from o) is not null or (select role_level from o) = 'administrator')
      then (select id from o)
    when exists (select 1 from m) and (select deactivated_at from m) is null
      then (select id from m)
    else null
  end
$$;

create or replace function public.referral_route_assignee(p_partner uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select public.referral_route_user((select p.owner_id from partners p where p.id = p_partner))
$$;

-- 4. Private helpers ---------------------------------------------------------------------

-- 16 random bytes, base64url without padding: 22 characters.
create or replace function public._referral_link_token()
returns text language sql volatile security definer set search_path = public, extensions as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=')
$$;

-- Is the public form on for this tenant? One definition for the RPCs below and
-- the public side (20261018000003).
create or replace function public._referral_form_open(p_org uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from organizations o
     where o.id = p_org and o.portal_enabled and o.public_form_enabled and not o.is_disabled
  )
$$;

-- The active link for (org, tenant) or (org, user), created when missing.
-- Serialized per link owner so two first calls cannot both insert.
create or replace function public._referral_form_link(p_org uuid, p_link_type text, p_user uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('referral_form_link:' || p_org::text || ':' || coalesce(p_user::text, 'tenant'), 0));
  select l.token into v_token
    from referral_form_links l
   where l.org_id = p_org and l.link_type = p_link_type
     and l.user_id is not distinct from p_user and l.retired_at is null;
  if v_token is null then
    v_token := public._referral_link_token();
    insert into referral_form_links (org_id, link_type, user_id, token, created_by)
    values (p_org, p_link_type, p_user, v_token, auth.uid());
  end if;
  return v_token;
end $$;

-- 5. RPCs (authenticated) ------------------------------------------------------------------

-- The caller's personal link (FR-PORT-24). Every active user can own partners
-- (Bundle 2: partners_insert only checks the org), so every active user has one.
create or replace function public.get_my_referral_link()
returns table (link_token text, org_slug text, public_form_enabled boolean)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org organizations;
begin
  select o.* into v_org from organizations o where o.id = public.user_org_id();
  if v_org.id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public._referral_form_open(v_org.id) then
    return query select null::text, v_org.slug, false;
    return;
  end if;
  return query select public._referral_form_link(v_org.id, 'user', auth.uid()), v_org.slug, true;
end $$;

-- The tenant link for websites and printed material (FR-PORT-26).
create or replace function public.get_tenant_referral_link()
returns table (link_token text, org_slug text, public_form_enabled boolean)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org organizations;
begin
  select o.* into v_org from organizations o where o.id = public.user_org_id();
  if v_org.id is null or not public.caller_is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public._referral_form_open(v_org.id) then
    return query select null::text, v_org.slug, false;
    return;
  end if;
  return query select public._referral_form_link(v_org.id, 'tenant', null), v_org.slug, true;
end $$;

-- Retire a link and issue a new one (FR-PORT-27). A user may regenerate their
-- own; an administrator may regenerate any user's link in the org and the
-- tenant link.
create or replace function public.regenerate_referral_link(p_link_type text, p_user_id uuid default null)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid    uuid := auth.uid();
  v_org    uuid := public.user_org_id();
  v_target uuid;
  v_token  text;
begin
  if v_org is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_link_type = 'tenant' then
    if p_user_id is not null or not public.caller_is_admin() then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
    v_target := null;
  elsif p_link_type = 'user' then
    v_target := coalesce(p_user_id, v_uid);
    if v_target <> v_uid and not public.caller_is_admin() then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
    if not exists (select 1 from profiles pr where pr.id = v_target and pr.org_id = v_org) then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  else
    raise exception 'invalid_link_type' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('referral_form_link:' || v_org::text || ':' || coalesce(v_target::text, 'tenant'), 0));
  update referral_form_links l
     set retired_at = now()
   where l.org_id = v_org and l.link_type = p_link_type
     and l.user_id is not distinct from v_target and l.retired_at is null;
  v_token := public._referral_form_link(v_org, p_link_type, v_target);
  perform public._portal_audit(v_org, null, 'link_regenerate', null, v_uid);
  return v_token;
end $$;

-- 6. Privileges ------------------------------------------------------------------------------
revoke execute on function public.referral_route_user(uuid)                      from public, anon, authenticated;
revoke execute on function public._referral_link_token()                         from public, anon, authenticated, service_role;
revoke execute on function public._referral_form_open(uuid)                      from public, anon, authenticated, service_role;
revoke execute on function public._referral_form_link(uuid, text, uuid)          from public, anon, authenticated, service_role;

revoke execute on function public.get_my_referral_link()                         from public, anon;
revoke execute on function public.get_tenant_referral_link()                     from public, anon;
revoke execute on function public.regenerate_referral_link(text, uuid)           from public, anon;
grant  execute on function public.get_my_referral_link()                         to authenticated;
grant  execute on function public.get_tenant_referral_link()                     to authenticated;
grant  execute on function public.regenerate_referral_link(text, uuid)           to authenticated;
