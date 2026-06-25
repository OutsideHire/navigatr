-- ---------------------------------------------------------------------------
-- RPC: rotate_invite_code
--
-- Regenerates the caller org's shared join code (organizations.invite_code),
-- instantly invalidating the old self-serve join link (/signup?code=...).
--
-- Admin-only. Rotating the link locks out everyone holding the old code, so
-- it is restricted to admins (managers can mutate other org settings via
-- update_org_branding, but not this). Per-agent org_invites tokens are a
-- separate system and are unaffected.
--
-- Returns the new code. The old code stops working the instant the row
-- updates, because claim_invite_code matches organizations.invite_code = code
-- exactly.
-- ---------------------------------------------------------------------------
create or replace function rotate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
  v_code   text;
  v_n      int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select p.org_id, p.role into v_org_id, v_caller
    from profiles p where p.id = auth.uid();

  -- Admin-only. coalesce guards a NULL role (deactivated / profile-less
  -- caller), which would otherwise make the comparison NULL, not TRUE.
  if v_org_id is null or coalesce(v_caller::text, '') <> 'admin' then
    raise exception 'forbidden';
  end if;

  -- Fresh 8-char base36-ish code, same generator as create_organization.
  -- Retry on the (astronomically unlikely) collision.
  for v_n in 1..8 loop
    v_code := lower(substring(encode(gen_random_bytes(8), 'hex') from 1 for 8));
    exit when not exists (select 1 from organizations o where o.invite_code = v_code);
    v_code := null;
  end loop;
  if v_code is null then
    raise exception 'invite_code_collision'
      using hint = 'Try again.';
  end if;

  update organizations set invite_code = v_code where id = v_org_id;
  return v_code;
end;
$$;

revoke all on function rotate_invite_code() from public;
grant execute on function rotate_invite_code() to authenticated;
