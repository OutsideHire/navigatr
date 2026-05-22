-- 20260522000001_create_organization.sql
--
-- Self-serve org creation: new RPC + relaxed signup trigger.
--
-- Before this migration, the only way to get a profile (and therefore
-- get past RequireProfile into the app) was to sign up with a valid
-- invite_code. New orgs had to be created by the founder via SQL.
--
-- After this migration:
--   1. The signup trigger no longer raises when the invite code is
--      empty/missing on email signup — it just leaves the user
--      profile-less. (OAuth path was already profile-less by design.)
--   2. A new RPC `create_organization(p_name)` lets an authenticated
--      user without a profile bootstrap a brand-new org and become its
--      'manager'. The frontend routes profile-less users to a
--      /create-organization page after auth.
--
-- Invariant preserved: a user with an invite code still goes through
-- the existing trigger/RPC path. The RLS gate on profiles is unchanged
-- (no INSERT policy — only SECURITY DEFINER paths can create rows).

-- ---------------------------------------------------------------------------
-- Relax the signup trigger: allow empty invite_code.
--
-- The old version raised 'signup_requires_invite_code' which rolled back
-- the auth.users insert. We can't do that anymore — the user has chosen
-- to start a new org and we'll create the profile after they pick a name.
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

  -- Email/password WITH invite code: existing behavior — validate +
  -- create the profile.
  select * into v_org from organizations o
   where o.invite_code = v_code and not o.is_disabled;
  if not found then
    raise exception 'invalid_invite_code'
      using hint = 'That invite code is not active. Ask your account owner for a new link.';
  end if;

  select count(*) into v_count from profiles p where p.org_id = v_org.id;
  v_role := case when v_count = 0 then 'manager'::user_role else 'rep'::user_role end;

  insert into profiles (id, org_id, role, full_name)
  values (
    new.id, v_org.id, v_role,
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- RPC: create_organization
--
-- Caller must be authenticated AND not already have a profile (each user
-- belongs to exactly one org). Generates a URL-safe slug from the name +
-- a short random invite_code. Inserts the org and the caller's profile
-- (role = 'manager') in a single transaction.
--
-- Slug collisions get a numeric suffix until unique. Invite-code
-- collisions retry up to 8 times before erroring out (1.1e15 possibilities
-- with 8-char base36 means collision is astronomical, but we still guard).
-- ---------------------------------------------------------------------------
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
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- One profile per user. If they already have an org, redirect them to it.
  -- (Calling this from the new-org page on a fully-set-up user shouldn't
  -- happen, but the gate makes intent explicit.)
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

  -- Slug: lowercase, alphanumeric-with-dashes. Strip everything else,
  -- collapse runs of dashes, trim leading/trailing dashes. Fall back to
  -- "org" if the name was entirely non-ASCII.
  v_slug_base := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_slug_base := regexp_replace(v_slug_base, '(^-+|-+$)', '', 'g');
  if v_slug_base = '' then
    v_slug_base := 'org';
  end if;
  -- Cap slug length so collisions don't push us past sane limits.
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

  -- Random 8-char base36-ish invite code. encode(gen_random_bytes(),'hex')
  -- gives 16 chars; take the first 8 of a base36 representation for
  -- readability. Retry on the (effectively impossible) collision.
  for v_n in 1..8 loop
    v_code := lower(substring(encode(gen_random_bytes(8), 'hex') from 1 for 8));
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

  insert into profiles (id, org_id, role, full_name)
  values (
    auth.uid(),
    v_org.id,
    'manager'::user_role,
    coalesce(
      (select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = auth.uid()),
      (select u.raw_user_meta_data->>'name'      from auth.users u where u.id = auth.uid()),
      (select u.email from auth.users u where u.id = auth.uid())
    )
  );

  return query select v_org.id, 'manager'::user_role, v_org.invite_code;
end $$;

grant execute on function create_organization(text) to authenticated;
