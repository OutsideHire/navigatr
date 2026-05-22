-- 20260523000002_admin_portal_rpcs.sql
--
-- Writes on org_invites + soft-deactivation on profiles. All paths
-- enforce caller is a manager/admin of the target org via SECURITY DEFINER.
-- See docs/superpowers/plans/2026-05-22-iso-admin-portal.md, Task 2.

-- ---------------------------------------------------------------------------
-- _admin_invite_token(): internal token generator — 32 hex chars (16 bytes
-- of randomness). Only called from other SECURITY DEFINER functions in this
-- file; no grant needed.
--
-- gen_random_bytes lives in the pgcrypto extension, which Supabase installs
-- in the `extensions` schema. We qualify explicitly so SECURITY DEFINER's
-- search_path=public doesn't lose it. (`language sql` functions validate
-- their body at create-time, so an unqualified reference here would abort
-- the migration with "function does not exist".)
-- ---------------------------------------------------------------------------
create or replace function _admin_invite_token() returns text
language sql volatile security definer set search_path = public as $$
  select encode(extensions.gen_random_bytes(16), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- admin_bulk_invite: accept a JSON array of {email, full_name?, role?}.
-- Returns one row per input with (email, id, ok, error) — the `id` column
-- carries the new org_invites.id so the frontend can fire invite emails by
-- id after the insert lands (Task 11 contract, baked in upfront).
--
-- Validation order per row: email format → already active → already pending
-- → seat cap. Per-row failures don't abort the batch; the function continues
-- accumulating results and RETURNS NEXT for each row including failures.
-- When seat_limit is null the cap is treated as effectively infinite.
--
-- Error codes: invalid_email | invalid_role | already_active | already_invited
--              | seat_cap_reached
-- ---------------------------------------------------------------------------
create or replace function admin_bulk_invite(p_invites jsonb)
returns table (email text, id uuid, ok boolean, error text)
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id    uuid;
  v_caller    user_role;
  v_seat_cap  int;
  v_used      int;
  v_remaining int;
  v_row       jsonb;
  v_email     text;
  v_name      text;
  v_role      user_role;
  v_new_id    uuid;
begin
  -- authz: caller must be authenticated + manager/admin of their org
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select p.org_id, p.role
    into v_org_id, v_caller
    from profiles p
   where p.id = auth.uid()
     and p.deactivated_at is null;
  if v_org_id is null or v_caller not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  -- seat math: read cap once, deduct as rows succeed
  select o.seat_limit into v_seat_cap
    from organizations o
   where o.id = v_org_id;

  -- TODO(seat-cap-race): two concurrent admin_bulk_invite calls can each
  -- pass the seat check then over-fill. Acceptable for sprint 1 (admin-only,
  -- low concurrency); add a row-level lock on organizations before counting
  -- when it becomes a problem.
  select count(*) into v_used
    from (
      select 1 from profiles
       where org_id = v_org_id and deactivated_at is null
      union all
      select 1 from org_invites
       where org_id = v_org_id and accepted_at is null and revoked_at is null
    ) s;

  -- null seat_limit = unlimited; use max int as a sentinel so the cap-check
  -- arithmetic works without special-casing everywhere
  v_remaining := case when v_seat_cap is null then 2147483647
                      else v_seat_cap - v_used
                 end;

  -- iterate input rows
  for v_row in select * from jsonb_array_elements(p_invites)
  loop
    v_email := lower(trim(v_row->>'email'));
    v_name  := nullif(trim(coalesce(v_row->>'full_name', '')), '');

    -- Pre-validate role string so a bad value can't abort the batch via cast error.
    if v_row ? 'role'
       and lower(v_row->>'role') not in ('rep', 'manager') then
      email := v_email; id := null; ok := false; error := 'invalid_role';
      return next; continue;
    end if;
    v_role  := coalesce((lower(v_row->>'role'))::user_role, 'rep'::user_role);

    -- validation: email format (ASCII-safe; avoids \s which PG interprets
    -- as a literal backslash-s in basic regex mode)
    if v_email is null
       or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    then
      email := v_row->>'email'; id := null; ok := false; error := 'invalid_email';
      return next; continue;
    end if;

    -- validation: not already an active profile in this org
    if exists (
      select 1
        from profiles p
        join auth.users u on u.id = p.id
       where p.org_id = v_org_id
         and lower(u.email) = v_email
         and p.deactivated_at is null
    ) then
      email := v_email; id := null; ok := false; error := 'already_active';
      return next; continue;
    end if;

    -- validation: not already a pending invite for this org
    if exists (
      select 1
        from org_invites
       where org_id = v_org_id
         and lower(org_invites.email) = v_email
         and accepted_at is null
         and revoked_at is null
    ) then
      email := v_email; id := null; ok := false; error := 'already_invited';
      return next; continue;
    end if;

    -- validation: seat cap not exceeded
    if v_remaining <= 0 then
      email := v_email; id := null; ok := false; error := 'seat_cap_reached';
      return next; continue;
    end if;

    -- all checks passed: insert and return the new row id
    insert into org_invites (org_id, email, full_name, role, token, invited_by)
      values (v_org_id, v_email, v_name, v_role, _admin_invite_token(), auth.uid())
    returning org_invites.id into v_new_id;

    v_remaining := v_remaining - 1;
    email := v_email; id := v_new_id; ok := true; error := null;
    return next;
  end loop;
end $$;

grant execute on function admin_bulk_invite(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_resend_invite: bump expires_at by 14 days for a pending invite and
-- rotates the invite token so a leaked link is invalidated.
-- Returns (id, email, token) so the caller can immediately queue the
-- send_invite_email edge function without a second round-trip.
-- ---------------------------------------------------------------------------
create or replace function admin_resend_invite(p_invite_id uuid)
returns table (id uuid, email text, token text)
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select p.org_id, p.role
    into v_org_id, v_caller
    from profiles p
   where p.id = auth.uid()
     and p.deactivated_at is null;
  if v_org_id is null or v_caller not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  update org_invites
     set expires_at = now() + interval '14 days',
         token      = _admin_invite_token()
   where org_invites.id = p_invite_id
     and org_invites.org_id = v_org_id
     and org_invites.accepted_at is null
     and org_invites.revoked_at is null
  returning org_invites.id, org_invites.email, org_invites.token
       into id, email, token;

  if id is null then
    raise exception 'invite_not_found_or_already_resolved';
  end if;

  return next;
end $$;

grant execute on function admin_resend_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_revoke_member: soft-revoke a pending invite (p_kind='invite') OR
-- soft-deactivate an active profile (p_kind='profile').
--
-- Guards:
--   - Callers cannot deactivate themselves.
--   - Managers cannot deactivate other managers or admins (only admins can).
-- ---------------------------------------------------------------------------
create or replace function admin_revoke_member(p_target uuid, p_kind text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select p.org_id, p.role
    into v_org_id, v_caller
    from profiles p
   where p.id = auth.uid()
     and p.deactivated_at is null;
  if v_org_id is null or v_caller not in ('manager', 'admin') then
    raise exception 'forbidden';
  end if;

  if p_kind = 'invite' then
    update org_invites
       set revoked_at = now()
     where id = p_target
       and org_id = v_org_id
       and accepted_at is null
       and revoked_at is null;
    if not found then raise exception 'invite_not_found_or_already_resolved'; end if;

  elsif p_kind = 'profile' then
    -- cannot deactivate yourself
    if p_target = auth.uid() then
      raise exception 'cannot_deactivate_self';
    end if;

    -- managers cannot deactivate other managers or admins
    if v_caller = 'manager' and exists (
      select 1 from profiles
       where id = p_target
         and role in ('manager', 'admin')
    ) then
      raise exception 'forbidden';
    end if;

    update profiles
       set deactivated_at = now()
     where id = p_target
       and org_id = v_org_id
       and deactivated_at is null;
    if not found then raise exception 'profile_not_found_or_already_deactivated'; end if;

  else
    raise exception 'invalid_kind';
  end if;
end $$;

grant execute on function admin_revoke_member(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_reactivate_member: undo a soft-deactivation. Admins only — managers
-- can revoke but only admins can reinstate to keep privilege escalation
-- impossible (a rogue manager couldn't reactivate a deactivated admin).
-- ---------------------------------------------------------------------------
create or replace function admin_reactivate_member(p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller user_role;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select p.org_id, p.role
    into v_org_id, v_caller
    from profiles p
   where p.id = auth.uid()
     and p.deactivated_at is null;
  if v_org_id is null or v_caller is null or v_caller <> 'admin' then
    raise exception 'forbidden';
  end if;

  update profiles
     set deactivated_at = null
   where id = p_profile_id
     and org_id = v_org_id
     and deactivated_at is not null;
  if not found then raise exception 'profile_not_found_or_active'; end if;
end $$;

grant execute on function admin_reactivate_member(uuid) to authenticated;
