-- 002_signup_trigger.sql
-- Server-side signup enforcement: trigger handles email/password,
-- RPC handles OAuth + refresh-recovery. See design doc § "Signup & Org
-- Assignment" for the load-bearing split of responsibilities.

-- ---------------------------------------------------------------------------
-- Trigger: handle_new_user_signup (email/password only).
--
-- Fires AFTER INSERT on auth.users. Reads raw_user_meta_data->>'invite_code',
-- looks up the org, creates the profiles row, picks role = 'manager' for the
-- first signup per org and 'rep' for every subsequent one.
--
-- For OAuth users (provider != 'email') the trigger returns early — OAuth
-- providers don't carry our custom invite_code metadata, so the /auth/callback
-- route calls claim_invite_code() instead.
--
-- If the code is missing/invalid/org-disabled, this RAISES — Supabase rolls
-- back the auth.users insert and the user does not exist after the failure.
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

  insert into profiles (id, org_id, role, full_name)
  values (
    new.id, v_org.id, v_role,
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user_signup();

-- ---------------------------------------------------------------------------
-- RPC: claim_invite_code (OAuth signup + refresh-recovery).
--
-- IDEMPOTENT — /auth/callback runs on every OAuth completion (sign-in or
-- sign-up); we cannot distinguish first-time from returning at the OAuth
-- layer. If a profile already exists, return it as success no-op.
--
-- The RequireProfile guard also routes through /auth/callback on a
-- broken-state recovery, which is why idempotency matters.
-- ---------------------------------------------------------------------------
create or replace function claim_invite_code(p_code text)
returns table (org_id uuid, role user_role)
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
    return query select v_existing.org_id, v_existing.role;
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

  insert into profiles (id, org_id, role, full_name)
  values (
    auth.uid(), v_org.id, v_role,
    coalesce(
      (select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = auth.uid()),
      (select u.raw_user_meta_data->>'name'      from auth.users u where u.id = auth.uid()),
      (select u.email from auth.users u where u.id = auth.uid())
    )
  );

  return query select v_org.id, v_role;
end $$;

grant execute on function claim_invite_code(text) to authenticated;
