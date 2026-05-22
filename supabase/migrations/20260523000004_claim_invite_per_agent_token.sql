-- 20260523000004_claim_invite_per_agent_token.sql
--
-- Bug caught in live QA: claim_invite_code only knew how to validate
-- shared organizations.invite_code values; it never consulted
-- org_invites.token, so every per-agent activation flow returned
-- invalid_invite_code. The Task 2 migration was supposed to extend
-- this function, but the dispatcher prompt didn't include that step.
--
-- This migration adds the missing per-agent path. Behavior:
--   1. Idempotent fast-path: caller already has a profile → return it.
--   2. Empty code: raise invite_code_required (unchanged).
--   3. **NEW** — code matches an unaccepted/unrevoked/unexpired
--      org_invites.token row: create the profile from that invite's
--      org_id/role/full_name/email, mark accepted_at, return.
--   4. Code matches a non-disabled organizations.invite_code (shared
--      self-serve path): create the profile, pick manager for the
--      first signup or rep for the rest, return.
--   5. Otherwise raise invalid_invite_code.

create or replace function claim_invite_code(p_code text)
returns table (out_org_id uuid, out_role user_role)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite   org_invites%rowtype;
  v_org      organizations%rowtype;
  v_count    int;
  v_role     user_role;
  v_existing profiles%rowtype;
  v_email    text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  -- Idempotent: existing profile → return it as no-op success.
  select * into v_existing from profiles p where p.id = auth.uid();
  if found then
    return query select v_existing.org_id as out_org_id, v_existing.role as out_role;
    return;
  end if;

  if p_code is null or p_code = '' then
    raise exception 'invite_code_required'
      using hint = 'Open the original invite link from your account owner.';
  end if;

  -- Caller's email — needed for both insert paths.
  select u.email into v_email from auth.users u where u.id = auth.uid();

  -- Path A: per-agent token from org_invites.
  select * into v_invite from org_invites o
   where o.token = p_code
     and o.accepted_at is null
     and o.revoked_at is null
     and o.expires_at > now();
  if found then
    insert into profiles (id, org_id, role, full_name, email)
    values (
      auth.uid(),
      v_invite.org_id,
      v_invite.role,
      coalesce(
        v_invite.full_name,
        (select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = auth.uid()),
        v_email
      ),
      v_email
    );
    update org_invites set accepted_at = now() where id = v_invite.id;
    return query select v_invite.org_id as out_org_id, v_invite.role as out_role;
    return;
  end if;

  -- Path B: shared organizations.invite_code (self-serve / legacy path).
  select * into v_org from organizations o
   where o.invite_code = p_code and not o.is_disabled;
  if not found then
    raise exception 'invalid_invite_code';
  end if;

  select count(*) into v_count from profiles p where p.org_id = v_org.id;
  v_role := case when v_count = 0 then 'manager'::user_role else 'rep'::user_role end;

  insert into profiles (id, org_id, role, full_name, email)
  values (
    auth.uid(),
    v_org.id,
    v_role,
    coalesce(
      (select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = auth.uid()),
      v_email
    ),
    v_email
  );

  return query select v_org.id as out_org_id, v_role as out_role;
end $$;

grant execute on function claim_invite_code(text) to authenticated;
