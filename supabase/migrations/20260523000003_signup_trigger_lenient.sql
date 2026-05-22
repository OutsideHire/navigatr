-- 20260523000003_signup_trigger_lenient.sql
--
-- Bug caught in live QA: handle_new_user_signup raises 'invalid_invite_code'
-- when the user_metadata.invite_code doesn't match an organizations.invite_code
-- row. The new per-agent activation flow (org_invites tokens) routes signups
-- through AcceptInvitePage which passes a 32-hex token — which won't match
-- any org's invite_code, so every per-agent signup was failing with HTTP 500.
--
-- Fix: make the trigger lenient. When the code doesn't match an organization,
-- return WITHOUT raising. The user is left profile-less; AuthCallbackPage's
-- claim_invite_code() call (updated in 20260523000001 to know about org_invites
-- tokens) resolves the profile from there.
--
-- Trade-off: a typo'd invite code now lets the signup succeed and the user
-- lands on a profile-less state instead of getting a clear error during
-- signup. AuthCallbackPage already handles this by surfacing the appropriate
-- error from claim_invite_code (either invalid_invite_code or routing to
-- /create-organization for the self-serve path). The trigger's "fast fail"
-- behavior was a UX shortcut, not a correctness gate — losing it doesn't
-- break tenancy isolation (profiles still can't be inserted from the client).

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
  -- claim_invite_code, which handles both shared codes and per-agent tokens.
  if v_provider <> 'email' then
    return new;
  end if;

  -- Email/password WITHOUT invite code: leave profile-less. The frontend's
  -- RequireProfile guard routes them to /auth/callback, which sees the
  -- empty code and routes to /create-organization (self-serve path).
  if v_code is null or v_code = '' then
    return new;
  end if;

  -- Email/password WITH a code: only fast-path the case where the code
  -- matches a shared organizations.invite_code. If it doesn't (e.g. it's
  -- a per-agent org_invites.token, or just garbage), DO NOT raise — return
  -- new without creating a profile. /auth/callback's claim_invite_code will
  -- find the matching org_invites row (or surface invalid_invite_code if
  -- the token is truly bogus).
  select * into v_org from organizations o
   where o.invite_code = v_code and not o.is_disabled;
  if not found then
    return new;
  end if;

  -- Shared-code fast path: create the profile here.
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
