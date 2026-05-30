-- 20260529000003_signup_email_fix.sql
--
-- HOTFIX: profiles.email is NOT NULL since 20260523000001_admin_portal,
-- but the signup trigger + create_organization RPC (both written before
-- that migration) still insert profiles WITHOUT setting email. Any new
-- user signing up via self-serve org bootstrap hits a NOT NULL
-- constraint error and the frontend renders "Could not create workspace".
--
-- This was latent until rpatton@gmail.com became the first user to
-- exercise the self-serve path in production. The existing manager
-- accounts (ceo@outsidehire.com, etc.) were created before the admin
-- portal migration backfilled email, so they were unaffected.
--
-- Fix: rewrite both functions to pass email through from auth.users
-- into the profile insert. Idempotent — `create or replace function`
-- swaps the body in place with no policy changes.
--
-- All other behavior preserved verbatim. The only change is adding
-- `email` to the insert column list + value list.

-- ---------------------------------------------------------------------------
-- handle_new_user_signup — the auth.users INSERT trigger
-- ---------------------------------------------------------------------------
-- Fires when a new auth.users row appears (signup completion). For email
-- signups WITH an invite code, creates the profile immediately. Without
-- an invite code, leaves the user profile-less; the frontend bounces them
-- to /create-organization which calls create_organization() below.

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
  -- OAuth users: trigger does nothing. /auth/callback calls
  -- claim_invite_code, and if no invite is present routes to
  -- /create-organization.
  if v_provider <> 'email' then
    return new;
  end if;

  -- Email/password WITHOUT invite code: leave the user profile-less.
  -- The frontend's RequireProfile guard routes them to /auth/callback,
  -- which sees the empty code and routes to /create-organization.
  if v_code is null or v_code = '' then
    return new;
  end if;

  -- Email/password WITH invite code: validate + create the profile.
  select * into v_org from organizations o
   where o.invite_code = v_code and not o.is_disabled;
  if not found then
    -- Invalid / disabled invite code. Don't create the profile; the
    -- frontend will surface this at the AcceptInvite page.
    return new;
  end if;

  -- First user in the org becomes manager; subsequent users are reps.
  select count(*) into v_count from profiles where org_id = v_org.id;
  v_role := case when v_count = 0 then 'manager'::user_role else 'rep'::user_role end;

  -- Insert profile WITH email (was the bug — pre-admin-portal version
  -- omitted email which became NOT NULL on 2026-05-23).
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

-- ---------------------------------------------------------------------------
-- create_organization — self-serve org bootstrap RPC
-- ---------------------------------------------------------------------------
-- Re-create the function with the same body PLUS email in the insert.
-- Everything else stays verbatim: slug generation, invite code creation,
-- duplicate-profile guard, etc.

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

  -- One profile per user. If they already have an org, reject.
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

  -- Slug: lowercase, alphanumeric-with-dashes.
  v_slug_base := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_slug_base := regexp_replace(v_slug_base, '(^-+|-+$)', '', 'g');
  if v_slug_base = '' then
    v_slug_base := 'org';
  end if;
  if length(v_slug_base) > 40 then
    v_slug_base := substring(v_slug_base from 1 for 40);
  end if;

  -- Find a free slug. Try base, base-2, base-3, ...
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

  -- Random 8-char invite code; retry on collision (effectively impossible).
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

  -- Pull email + display name out of auth.users so we can populate them
  -- in the profile. email is required by the NOT NULL constraint on
  -- profiles.email (admin_portal migration).
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
    -- Shouldn't happen — auth.users.email is also NOT NULL — but guard
    -- anyway so we fail with a clear message instead of a generic NOT
    -- NULL violation that the frontend masks as "Could not create
    -- workspace".
    raise exception 'no_email_on_auth_user'
      using hint = 'Internal error: your authenticated user record has no email.';
  end if;

  insert into profiles (id, org_id, role, full_name, email)
  values (
    auth.uid(),
    v_org.id,
    'manager'::user_role,
    v_full_name,
    v_email
  );

  return query select v_org.id, 'manager'::user_role, v_org.invite_code;
end $$;

grant execute on function create_organization(text) to authenticated;
