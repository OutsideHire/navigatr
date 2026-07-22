-- 7-layer role_level foundation (PRD 6.8.A, sub-project 1 phase 1A).
--
-- role_level is the new source of truth for a user's layer. The legacy
-- user_role enum (rep/manager/admin) is KEPT and kept consistent with
-- role_level via a derive rule, so the existing hierarchy RLS
-- (20260529000001) that reads user_role() / role continues to work unchanged.
-- role_level only adds finer distinctions among the manager band that the
-- permission matrix needs (invite, reporting lines, org settings, demo).
--
-- Derive rule:
--   administrator      <-> admin
--   cso_cro..sales_manager -> manager
--   sales_professional <-> rep
--
-- Apply via the Supabase SQL editor (not db push). DB change ships and is
-- applied BEFORE the frontend that reads role_level.

-- 1) The enum + columns.
create type role_level as enum (
  'administrator','cso_cro','svp_sales','vp_sales','director_sales','sales_manager','sales_professional'
);

alter table profiles add column role_level role_level;
alter table profiles add column view_as_enabled boolean not null default false;

-- 2) Backfill role_level from the legacy role.
update profiles set role_level = case role
  when 'admin'   then 'administrator'::role_level
  when 'manager' then 'sales_manager'::role_level
  else                'sales_professional'::role_level
end;

alter table profiles alter column role_level set not null;
-- NOTE: deliberately NO column default. A DEFAULT is applied by Postgres when
-- the tuple is formed, BEFORE the before-insert trigger runs, which would make
-- fill_role_level_from_role() a no-op (NEW.role_level would never be null).
-- Leaving it null-until-trigger lets the trigger derive role_level from role on
-- every insert path. The NOT NULL constraint is checked AFTER the trigger, so
-- the trigger always satisfies it.

-- view_as_enabled: PRD default true for L2-L6 (cso..sales_manager),
-- false for L1 (administrator) and L7 (sales_professional). Used in a later
-- sub-project; set the correct default now.
update profiles set view_as_enabled =
  role_level in ('cso_cro','svp_sales','vp_sales','director_sales','sales_manager');

-- 2b) Ensure every org has an Administrator (L1). Historically the org creator
--     was seeded as 'manager' (see create_organization / handle_new_user_signup
--     below, now fixed to seed 'admin'). Under the 7-role model L1 is the only
--     role that can administer the org, so any org that ended up with no admin
--     would be un-administerable. Promote the earliest active profile (the
--     creator) in each admin-less org to administrator, and set role_path null
--     (admins are org-wide). Orgs that already have an admin are untouched.
--     (role_path descendants are not rebuilt here because no org has a populated
--     reporting tree yet; the assignment tools rebuild paths when trees are set.)
with ranked as (
  select p.id, p.org_id,
         row_number() over (partition by p.org_id order by p.created_at asc, p.id asc) as rn
  from profiles p
  where p.deactivated_at is null
),
admin_less as (
  select o.id as org_id
  from organizations o
  where not exists (
    select 1 from profiles p
    where p.org_id = o.id and p.role = 'admin' and p.deactivated_at is null
  )
)
update profiles p
   set role = 'admin', role_level = 'administrator', view_as_enabled = false, role_path = null
  from ranked r
  join admin_less al on al.org_id = r.org_id
 where p.id = r.id and r.rn = 1;

-- 3) INSERT safety net: new profiles created by signup/invite set `role`
--    (3-value) but not role_level. Fill role_level from role on insert when
--    it wasn't provided, so legacy creation paths stay correct. Fires on
--    INSERT only, so it never clobbers an explicitly-set role_level on UPDATE
--    (the RPCs below set both columns explicitly).
create or replace function public.fill_role_level_from_role()
returns trigger language plpgsql as $$
begin
  if NEW.role_level is null then
    NEW.role_level := case NEW.role
      when 'admin'   then 'administrator'::role_level
      when 'manager' then 'sales_manager'::role_level
      else                'sales_professional'::role_level
    end;
  end if;
  return NEW;
end $$;

create trigger profiles_fill_role_level
  before insert on profiles
  for each row execute function public.fill_role_level_from_role();

-- 4) caller_role_level(): the current user's role_level (STABLE, SECURITY
--    DEFINER so it can read profiles inside other policies/RPCs).
create or replace function public.caller_role_level()
returns role_level language sql stable security definer set search_path = public as $$
  select role_level from profiles where id = auth.uid()
$$;
grant execute on function public.caller_role_level() to authenticated;

-- 5) admin_set_role_level(): set a member's role_level (Administrator only per
--    the matrix). Keeps the legacy `role` consistent via the derive rule and
--    rebuilds role_path for the member + subtree (admin<=>NULL path flips).
create or replace function admin_set_role_level(p_profile_id uuid, p_level role_level)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller role_level;
  v_target role_level;
  v_new_role user_role;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select p.org_id, p.role_level into v_org_id, v_caller
    from profiles p where p.id = auth.uid() and p.deactivated_at is null;
  if v_org_id is null or v_caller <> 'administrator' then
    raise exception 'forbidden';
  end if;

  if p_profile_id = auth.uid() then
    raise exception 'cannot_change_own_role';
  end if;

  select p.role_level into v_target
    from profiles p
   where p.id = p_profile_id and p.org_id = v_org_id and p.deactivated_at is null;
  if v_target is null then raise exception 'profile_not_found'; end if;

  -- Sole-administrator protection: don't demote the last administrator.
  if v_target = 'administrator' and p_level <> 'administrator'
     and (select count(*) from profiles
            where org_id = v_org_id and role_level = 'administrator' and deactivated_at is null) <= 1 then
    raise exception 'cannot_demote_sole_admin';
  end if;

  v_new_role := case p_level
    when 'administrator'      then 'admin'::user_role
    when 'sales_professional' then 'rep'::user_role
    else                           'manager'::user_role
  end;

  update profiles
     set role_level = p_level, role = v_new_role
   where id = p_profile_id and org_id = v_org_id;

  -- Re-derive role_path for the member + all reports (admin<=>NULL flip).
  perform public.rebuild_role_path_subtree(p_profile_id);
end $$;
grant execute on function admin_set_role_level(uuid, role_level) to authenticated;

-- 6) Keep the legacy admin_set_role consistent: when it changes the 3-value
--    role, also update role_level via the derive rule so the two never drift.
--    (Body identical to 20260714000004 plus the role_level line.)
create or replace function admin_set_role(p_profile_id uuid, p_new_role user_role)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
  v_target_role user_role;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select p.org_id, p.role into v_org_id, v_caller
    from profiles p where p.id = auth.uid() and p.deactivated_at is null;
  if v_org_id is null or v_caller <> 'admin' then raise exception 'forbidden'; end if;

  if p_profile_id = auth.uid() then raise exception 'cannot_change_own_role'; end if;

  select p.role into v_target_role
    from profiles p
   where p.id = p_profile_id and p.org_id = v_org_id and p.deactivated_at is null;
  if v_target_role is null then raise exception 'profile_not_found'; end if;

  if v_target_role = 'admin' and p_new_role <> 'admin'
     and (select count(*) from profiles
            where org_id = v_org_id and role = 'admin' and deactivated_at is null) <= 1 then
    raise exception 'cannot_demote_sole_admin';
  end if;

  update profiles set role = p_new_role,
    role_level = case p_new_role
      when 'admin'   then 'administrator'::role_level
      when 'manager' then 'sales_manager'::role_level
      else                'sales_professional'::role_level
    end
   where id = p_profile_id and org_id = v_org_id;

  perform public.rebuild_role_path_subtree(p_profile_id);
end $$;
grant execute on function admin_set_role(uuid, user_role) to authenticated;

-- 7) Re-gate management RPCs that the matrix restricts more tightly than the
--    3-value role can express (Administrator + CSO only).

-- admin_set_manager: Administrator or CSO may set reporting lines (was admin
-- only). Body identical to 20260714000004 except the caller gate now reads
-- role_level.
create or replace function admin_set_manager(p_member uuid, p_manager uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller role_level;
  v_member_role user_role;
  v_is_cycle boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select p.org_id, p.role_level into v_org_id, v_caller
    from profiles p where p.id = auth.uid() and p.deactivated_at is null;
  if v_org_id is null or v_caller not in ('administrator','cso_cro') then
    raise exception 'forbidden';
  end if;

  select p.role into v_member_role
    from profiles p
   where p.id = p_member and p.org_id = v_org_id and p.deactivated_at is null;
  if v_member_role is null then raise exception 'member_not_found'; end if;
  if v_member_role = 'admin' then raise exception 'cannot_place_admin'; end if;

  if p_manager is not null then
    if p_manager = p_member then raise exception 'cannot_report_to_self'; end if;
    if not exists (
      select 1 from profiles p
       where p.id = p_manager and p.org_id = v_org_id and p.deactivated_at is null
    ) then raise exception 'manager_not_found'; end if;

    with recursive up as (
      select p_manager as id
      union all
      select pr.manager_id from profiles pr join up on pr.id = up.id
      where pr.manager_id is not null
    )
    select exists (select 1 from up where id = p_member) into v_is_cycle;
    if v_is_cycle then raise exception 'cycle_detected'; end if;
  end if;

  update profiles set manager_id = p_manager where id = p_member and org_id = v_org_id;
  if p_manager is not null then
    perform public.rebuild_role_path_subtree(p_manager);
  else
    perform public.rebuild_role_path_subtree(p_member);
  end if;
end $$;
grant execute on function admin_set_manager(uuid, uuid) to authenticated;

-- update_org_value_bands: Administrator or CSO only (was manager+admin). Only
-- the caller gate changes; validation body preserved verbatim from
-- 20260716000004. Recreated in full so the SQL editor run is self-contained.
create or replace function update_org_value_bands(p_low_cents int, p_high_cents int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_level  role_level;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select p.org_id, p.role_level
    into v_org_id, v_level
    from profiles p
   where p.id = auth.uid();
  if v_level not in ('administrator','cso_cro') then
    raise exception 'not_authorized';
  end if;

  -- Both NULL = reset to app defaults.
  if p_low_cents is null and p_high_cents is null then
    update organizations
       set aw_value_band_low_cents = null, aw_value_band_high_cents = null
     where id = v_org_id;
    return;
  end if;

  -- Both-or-neither, and a strictly increasing, non-negative pair.
  if p_low_cents is null or p_high_cents is null
     or p_low_cents < 0 or p_high_cents <= p_low_cents then
    raise exception 'invalid_bands';
  end if;

  update organizations
     set aw_value_band_low_cents = p_low_cents,
         aw_value_band_high_cents = p_high_cents
   where id = v_org_id;
end $$;
grant execute on function update_org_value_bands(int, int) to authenticated;

-- 8) Org creator becomes the Administrator (L1), not a manager. Both
--    self-serve org-bootstrap paths seeded the first user as 'manager', which
--    under the 7-role model leaves the org with no L1 administrator. Recreate
--    both with the first-user role = 'admin'. Bodies are otherwise verbatim
--    from 20260529000003_signup_email_fix.sql; the fill_role_level_from_role
--    INSERT trigger derives role_level='administrator' from role='admin'.

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
  if v_provider <> 'email' then
    return new;
  end if;

  if v_code is null or v_code = '' then
    return new;
  end if;

  select * into v_org from organizations o
   where o.invite_code = v_code and not o.is_disabled;
  if not found then
    return new;
  end if;

  -- First user in the org becomes the Administrator; subsequent users are reps.
  select count(*) into v_count from profiles where org_id = v_org.id;
  v_role := case when v_count = 0 then 'admin'::user_role else 'rep'::user_role end;

  insert into profiles (id, org_id, role, full_name, email)
  values (
    new.id,
    v_org.id,
    v_role,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  );

  return new;
end $$;

create or replace function create_organization(p_name text)
returns table (org_id uuid, role user_role, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name      text := trim(p_name);
  v_slug_base text;
  v_slug      text;
  v_code      text;
  v_org       organizations%rowtype;
  v_existing  profiles%rowtype;
  v_n         int;
  v_email     text;
  v_full_name text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_existing from profiles p where p.id = auth.uid();
  if found then
    raise exception 'already_in_organization'
      using hint = 'Your account already belongs to an organization.';
  end if;

  if v_name is null or length(v_name) < 2 then
    raise exception 'org_name_too_short'
      using hint = 'Pick a name with at least 2 characters.';
  end if;
  if length(v_name) > 80 then
    raise exception 'org_name_too_long'
      using hint = 'Pick a name shorter than 80 characters.';
  end if;

  v_slug_base := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_slug_base := regexp_replace(v_slug_base, '(^-+|-+$)', '', 'g');
  if v_slug_base = '' then
    v_slug_base := 'org';
  end if;
  if length(v_slug_base) > 40 then
    v_slug_base := substring(v_slug_base from 1 for 40);
  end if;

  v_slug := v_slug_base;
  v_n := 1;
  while exists (select 1 from organizations o where o.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_slug_base || '-' || v_n;
    if v_n > 1000 then
      raise exception 'org_slug_collision'
        using hint = 'Could not allocate a unique slug. Try a different name.';
    end if;
  end loop;

  for v_n in 1..8 loop
    v_code := lower(substring(encode(extensions.gen_random_bytes(8), 'hex') from 1 for 8));
    exit when not exists (select 1 from organizations o where o.invite_code = v_code);
    v_code := null;
  end loop;
  if v_code is null then
    raise exception 'invite_code_collision'
      using hint = 'Try creating the org again.';
  end if;

  insert into organizations (name, slug, invite_code)
  values (v_name, v_slug, v_code)
  returning * into v_org;

  select u.email,
         coalesce(
           u.raw_user_meta_data->>'full_name',
           u.raw_user_meta_data->>'name',
           u.email
         )
    into v_email, v_full_name
    from auth.users u
   where u.id = auth.uid();

  if v_email is null then
    raise exception 'no_email_on_auth_user'
      using hint = 'Internal error: your authenticated user record has no email.';
  end if;

  -- Org creator is the Administrator (L1). role_level is derived by the
  -- fill_role_level_from_role INSERT trigger.
  insert into profiles (id, org_id, role, full_name, email)
  values (
    auth.uid(),
    v_org.id,
    'admin'::user_role,
    v_full_name,
    v_email
  );

  return query select v_org.id, 'admin'::user_role, v_org.invite_code;
end $$;

grant execute on function create_organization(text) to authenticated;
