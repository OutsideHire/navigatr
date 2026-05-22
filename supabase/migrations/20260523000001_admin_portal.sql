-- 20260523000001_admin_portal.sql
--
-- ISO Admin Portal v1: per-agent invitations, seat limits, soft-deactivation,
-- and profiles.email backfill.
-- See docs/superpowers/specs/2026-05-22-iso-admin-portal-design.md.

-- ---------------------------------------------------------------------------
-- org_invites: one row per per-agent invitation. Distinct from the existing
-- organizations.invite_code shared-code path (which stays for self-serve
-- signup); per-agent tokens give us revoke + audit per row.
-- ---------------------------------------------------------------------------
create table org_invites (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  email         text not null,
  full_name     text,
  role          user_role not null default 'rep',
  token         text not null unique,
  invited_by    uuid references profiles(id) on delete set null,
  expires_at    timestamptz not null default (now() + interval '14 days'),
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

-- Working index for the admin portal's "pending invites" list.
create index org_invites_org_pending_idx
  on org_invites (org_id)
  where accepted_at is null and revoked_at is null;

-- Idempotency: admin clicking "invite" twice for the same email becomes a
-- no-op rather than two rows. Active + revoked invites are excluded so a
-- previously-revoked email can be re-invited cleanly.
create unique index org_invites_email_per_org_pending_idx
  on org_invites (org_id, lower(email))
  where accepted_at is null and revoked_at is null;

alter table org_invites enable row level security;

-- Managers/admins can read their org's invites. No direct write — all
-- mutations go through SECURITY DEFINER RPCs added in Task 2.
create policy org_invites_select on org_invites for select
  using (
    org_id = public.user_org_id()
    and public.user_role() in ('manager', 'admin')
  );

-- ---------------------------------------------------------------------------
-- organizations.seat_limit: null = unlimited (matches existing orgs).
-- ---------------------------------------------------------------------------
alter table organizations
  add column seat_limit int;

-- ---------------------------------------------------------------------------
-- profiles.deactivated_at: soft-deactivation. Agent's deals stay attached
-- (visible to managers); the agent themselves can no longer authenticate
-- as active because the helper functions below return null for them.
-- ---------------------------------------------------------------------------
alter table profiles
  add column deactivated_at timestamptz;

create index profiles_active_idx
  on profiles (org_id)
  where deactivated_at is null;

-- ---------------------------------------------------------------------------
-- profiles.email: store the user's email on the profile row so the admin
-- portal can display it without joining to auth.users (which is not
-- accessible from client queries). Backfill from auth.users, then make
-- NOT NULL going forward.
-- ---------------------------------------------------------------------------
alter table profiles
  add column email text;

update profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id;

do $$
declare v_orphans int;
begin
  select count(*) into v_orphans from profiles where email is null;
  if v_orphans > 0 then
    raise exception 'cannot set profiles.email not null: % rows have no matching auth.users entry', v_orphans;
  end if;
end $$;

alter table profiles
  alter column email set not null;

-- ---------------------------------------------------------------------------
-- Helper functions: treat deactivated profiles as if they don't exist.
-- This is the load-bearing piece — every RLS policy in the schema reads
-- user_org_id() / user_role(), so updating these here propagates the
-- deactivation effect everywhere without rewriting individual policies.
-- ---------------------------------------------------------------------------
create or replace function public.user_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from profiles
   where id = auth.uid()
     and deactivated_at is null
$$;

create or replace function public.user_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles
   where id = auth.uid()
     and deactivated_at is null
$$;

-- profiles_select RLS already filters by org membership; we leave it as-is
-- since managers SHOULD still see deactivated profiles in their admin list
-- (so they can reactivate). UI filters the "active agents" view on
-- deactivated_at; the admin list does not.

-- ---------------------------------------------------------------------------
-- handle_new_user_signup trigger: add email to the profiles insert so
-- the new NOT NULL column is populated on every new signup going forward.
-- ---------------------------------------------------------------------------
create or replace function handle_new_user_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text := coalesce(new.raw_app_meta_data->>'provider', 'email');
  v_code     text := new.raw_user_meta_data->>'invite_code';
  v_org      organizations%rowtype;
  v_count    int;
  v_role     user_role;
begin
  -- OAuth users: trigger does nothing. /auth/callback calls claim_invite_code.
  if v_provider <> 'email' then
    return new;
  end if;

  -- Email/password path: invite code is required and must be valid.
  if v_code is null or v_code = '' then
    raise exception 'signup_requires_invite_code'
      using hint = 'Sign up with the link your account owner sent you.';
  end if;

  select * into v_org from organizations o
   where o.invite_code = v_code and not o.is_disabled;
  if not found then
    raise exception 'invalid_invite_code'
      using hint = 'That invite code is not active. Ask your account owner for a new link.';
  end if;

  select count(*) into v_count from profiles p where p.org_id = v_org.id;
  v_role := case when v_count = 0 then 'manager'::user_role else 'rep'::user_role end;

  insert into profiles (id, org_id, role, full_name, email)
  values (
    new.id, v_org.id, v_role,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  );

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- claim_invite_code RPC: add email to both insert branches (initial insert
-- and the idempotent early-return path already has the profile, so only the
-- new-profile insert branch needs updating).
-- ---------------------------------------------------------------------------
create or replace function claim_invite_code(p_code text)
returns table (out_org_id uuid, out_role user_role)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      organizations%rowtype;
  v_count    int;
  v_role     user_role;
  v_existing profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Idempotent: if profile already exists, return it as success.
  -- Every column reference inside this function is qualified with a table
  -- alias because the RETURNS TABLE(org_id, role) declares OUT parameters
  -- in function scope; bare `org_id` / `role` would be ambiguous and
  -- Postgres would raise SQLSTATE 42702 before the body even runs.
  select * into v_existing from profiles p where p.id = auth.uid();
  if found then
    return query select v_existing.org_id as out_org_id, v_existing.role as out_role;
    return;
  end if;

  if p_code is null or p_code = '' then
    raise exception 'invite_code_required'
      using hint = 'Open the original invite link from your account owner.';
  end if;

  select * into v_org from organizations o
   where o.invite_code = p_code and not o.is_disabled;
  if not found then
    raise exception 'invalid_invite_code';
  end if;

  select count(*) into v_count from profiles p where p.org_id = v_org.id;
  v_role := case when v_count = 0 then 'manager'::user_role else 'rep'::user_role end;

  insert into profiles (id, org_id, role, full_name, email)
  values (
    auth.uid(), v_org.id, v_role,
    coalesce(
      (select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = auth.uid()),
      (select u.raw_user_meta_data->>'name'      from auth.users u where u.id = auth.uid()),
      (select u.email from auth.users u where u.id = auth.uid())
    ),
    (select u.email from auth.users u where u.id = auth.uid())
  );

  return query select v_org.id as out_org_id, v_role as out_role;
end $$;

grant execute on function claim_invite_code(text) to authenticated;
