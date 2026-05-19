-- 001_orgs_and_profiles.sql
-- Tenancy foundation: organizations + profiles + ENUMs + auth helpers + RLS.
-- See design doc § "Table Schemas" and § "Signup & Org Assignment".

-- ---------------------------------------------------------------------------
-- ENUMs (helper types). Stable vocabularies — use enum, not text+check.
-- ---------------------------------------------------------------------------
create type user_role     as enum ('rep', 'manager', 'admin');
create type deal_stage    as enum ('new', 'contacted', 'qualified', 'proposal', 'won');
create type disposition   as enum (
  'statement_secured', 'positive_engagement', 'connected_with_dm',
  'dm_unavailable', 'followup_requested', 'future_potential',
  'low_probability', 'not_interested', 'wrong_number', 'closed_lost'
);
create type activity_type as enum ('call', 'email', 'drop_in', 'appointment');
create type partner_type  as enum ('cpa', 'banker', 'attorney', 'insurance', 'consultant', 'other');

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  invite_code  text not null unique,
  is_disabled  boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table organizations enable row level security;

-- Authenticated users can read only their own org row (joined via profiles).
-- We define the policy after profiles exists; see end of file.

-- ---------------------------------------------------------------------------
-- profiles (extends auth.users)
-- ---------------------------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete restrict,
  role        user_role not null default 'rep',
  full_name   text,
  created_at  timestamptz not null default now()
);

create index profiles_org_id_idx on profiles (org_id);

alter table profiles enable row level security;

-- See own profile + others in same org.
-- Uses a self-join via auth.uid() so no recursion through helpers.
create policy profiles_select on profiles for select
  using (
    id = auth.uid()
    or org_id = (select p.org_id from profiles p where p.id = auth.uid())
  );

-- Only own profile, and cannot change org_id or role.
create policy profiles_update on profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and org_id = (select p.org_id from profiles p where p.id = auth.uid())
    and role   = (select p.role   from profiles p where p.id = auth.uid())
  );

-- No INSERT / DELETE policies: profile rows are created exclusively by the
-- signup trigger or claim_invite_code RPC (both SECURITY DEFINER).

-- ---------------------------------------------------------------------------
-- Auth helper functions. STABLE + SECURITY DEFINER so the planner can inline
-- them inside RLS policies without recursion.
--
-- These live in `public` (not `auth`) because hosted Supabase reserves the
-- `auth` schema for the platform — non-superuser roles cannot create objects
-- there. The design doc names them `auth.user_org_id` / `auth.user_role`;
-- we keep the same function names under `public` so callers read identically
-- once search_path includes public (the default).
-- ---------------------------------------------------------------------------
create or replace function public.user_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid()
$$;

create or replace function public.user_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

grant execute on function public.user_org_id() to authenticated;
grant execute on function public.user_role()   to authenticated;

-- ---------------------------------------------------------------------------
-- organizations select policy (now that public.user_org_id exists).
-- A user can see exactly their own organization row, nothing else.
-- ---------------------------------------------------------------------------
create policy organizations_select on organizations for select
  using (id = public.user_org_id());

-- No INSERT/UPDATE/DELETE policies on organizations. Founder manages via
-- Supabase Studio (service-role bypasses RLS).
