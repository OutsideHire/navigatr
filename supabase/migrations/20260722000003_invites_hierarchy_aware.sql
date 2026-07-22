-- Hierarchy-aware invites (PRD 6.8.A, sub-project 1 phase 1B.1). Re-runnable.
--
-- Extends the admin-portal invite system so an invite carries an intended
-- role_level + manager (reporting line), applied on accept. Re-gates invite
-- RPCs to Administrator + CSO. Depends on 20260722000002 (role_level enum,
-- caller helpers, rebuild_role_path_subtree).

-- 1) org_invites: carry the intended layer + manager.
alter table org_invites add column if not exists role_level role_level;
alter table org_invites add column if not exists manager_id uuid references profiles(id) on delete set null;

-- 2) admin_bulk_invite: accept role_level + reports_to; validate against the 7
--    layers; store role_level + manager_id; gate on Administrator + CSO.
--    Input row shape: { email, full_name?, role_level?, reports_to? } where
--    reports_to is an existing profile id OR an email of an existing active
--    member in the org (resolved to manager_id); null/absent = no manager.
create or replace function admin_bulk_invite(p_invites jsonb)
returns table (email text, id uuid, ok boolean, error text)
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id    uuid;
  v_caller    role_level;
  v_seat_cap  int;
  v_used      int;
  v_remaining int;
  v_row       jsonb;
  v_email     text;
  v_name      text;
  v_level     role_level;
  v_reports   text;
  v_mgr       uuid;
  v_new_id    uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select p.org_id, p.role_level into v_org_id, v_caller
    from profiles p where p.id = auth.uid() and p.deactivated_at is null;
  if v_org_id is null or v_caller not in ('administrator','cso_cro') then
    raise exception 'forbidden';
  end if;

  select o.seat_limit into v_seat_cap from organizations o where o.id = v_org_id;

  select count(*) into v_used
    from (
      select 1 from profiles where org_id = v_org_id and deactivated_at is null
      union all
      select 1 from org_invites where org_id = v_org_id and accepted_at is null and revoked_at is null
    ) s;
  v_remaining := case when v_seat_cap is null then 2147483647 else v_seat_cap - v_used end;

  for v_row in select * from jsonb_array_elements(p_invites)
  loop
    v_email := lower(trim(v_row->>'email'));
    v_name  := nullif(trim(coalesce(v_row->>'full_name', '')), '');
    v_mgr   := null;

    -- role_level: default sales_professional; reject unknown values without
    -- aborting the batch (a bad cast would throw).
    if v_row ? 'role_level'
       and lower(v_row->>'role_level') not in
         ('administrator','cso_cro','svp_sales','vp_sales','director_sales','sales_manager','sales_professional') then
      email := v_email; id := null; ok := false; error := 'invalid_role_level';
      return next; continue;
    end if;
    v_level := coalesce((lower(v_row->>'role_level'))::role_level, 'sales_professional'::role_level);

    if v_email is null
       or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      email := v_row->>'email'; id := null; ok := false; error := 'invalid_email';
      return next; continue;
    end if;

    -- reports_to: optional. A profile id or an email of an existing active
    -- member of this org. Unresolvable => error row.
    v_reports := nullif(trim(coalesce(v_row->>'reports_to', '')), '');
    if v_reports is not null then
      if v_reports ~ '^[0-9a-fA-F-]{36}$' then
        select p.id into v_mgr from profiles p
         where p.id = v_reports::uuid and p.org_id = v_org_id and p.deactivated_at is null;
      else
        select p.id into v_mgr from profiles p
         join auth.users u on u.id = p.id
         where lower(u.email) = lower(v_reports) and p.org_id = v_org_id and p.deactivated_at is null;
      end if;
      if v_mgr is null then
        email := v_email; id := null; ok := false; error := 'reports_to_not_found';
        return next; continue;
      end if;
    end if;

    if exists (
      select 1 from profiles p join auth.users u on u.id = p.id
       where p.org_id = v_org_id and lower(u.email) = v_email and p.deactivated_at is null
    ) then
      email := v_email; id := null; ok := false; error := 'already_active';
      return next; continue;
    end if;

    if exists (
      select 1 from org_invites
       where org_id = v_org_id and lower(org_invites.email) = v_email
         and accepted_at is null and revoked_at is null
    ) then
      email := v_email; id := null; ok := false; error := 'already_invited';
      return next; continue;
    end if;

    if v_remaining <= 0 then
      email := v_email; id := null; ok := false; error := 'seat_cap_reached';
      return next; continue;
    end if;

    -- legacy `role` column stays consistent via the derive rule.
    insert into org_invites (org_id, email, full_name, role, role_level, manager_id, token, invited_by)
      values (
        v_org_id, v_email, v_name,
        case v_level
          when 'administrator' then 'admin'::user_role
          when 'sales_professional' then 'rep'::user_role
          else 'manager'::user_role
        end,
        v_level, v_mgr, _admin_invite_token(), auth.uid()
      )
    returning org_invites.id into v_new_id;

    v_remaining := v_remaining - 1;
    email := v_email; id := v_new_id; ok := true; error := null;
    return next;
  end loop;
end $$;
grant execute on function admin_bulk_invite(jsonb) to authenticated;

-- 3) claim_invite_code: apply the invite's role_level + manager on accept and
--    rebuild role_path so the new hire nests correctly. Path B first-user is
--    seeded as administrator for consistency with create_organization.
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
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_existing from profiles p where p.id = auth.uid();
  if found then
    return query select v_existing.org_id as out_org_id, v_existing.role as out_role;
    return;
  end if;

  if p_code is null or p_code = '' then
    raise exception 'invite_code_required'
      using hint = 'Open the original invite link from your account owner.';
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  -- Path A: per-agent token from org_invites (now carries role_level + manager).
  select * into v_invite from org_invites o
   where o.token = p_code and o.accepted_at is null and o.revoked_at is null and o.expires_at > now();
  if found then
    insert into profiles (id, org_id, role, role_level, manager_id, full_name, email)
    values (
      auth.uid(),
      v_invite.org_id,
      v_invite.role,
      coalesce(v_invite.role_level,
        case v_invite.role
          when 'admin' then 'administrator'::role_level
          when 'manager' then 'sales_manager'::role_level
          else 'sales_professional'::role_level
        end),
      v_invite.manager_id,
      coalesce(
        v_invite.full_name,
        (select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = auth.uid()),
        v_email
      ),
      v_email
    );
    update org_invites set accepted_at = now() where id = v_invite.id;
    perform public.rebuild_role_path_subtree(auth.uid());
    return query select v_invite.org_id as out_org_id, v_invite.role as out_role;
    return;
  end if;

  -- Path B: shared organizations.invite_code (self-serve). First user is the
  -- Administrator; subsequent users are reps. role_level derived by trigger.
  select * into v_org from organizations o
   where o.invite_code = p_code and not o.is_disabled;
  if not found then raise exception 'invalid_invite_code'; end if;

  select count(*) into v_count from profiles p where p.org_id = v_org.id;
  v_role := case when v_count = 0 then 'admin'::user_role else 'rep'::user_role end;

  insert into profiles (id, org_id, role, full_name, email)
  values (
    auth.uid(), v_org.id, v_role,
    coalesce((select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = auth.uid()), v_email),
    v_email
  );

  return query select v_org.id as out_org_id, v_role as out_role;
end $$;
grant execute on function claim_invite_code(text) to authenticated;

-- 4) Re-gate the remaining invite RPCs to Administrator + CSO.
create or replace function admin_resend_invite(p_invite_id uuid)
returns table (id uuid, email text, token text)
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller role_level;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select p.org_id, p.role_level into v_org_id, v_caller
    from profiles p where p.id = auth.uid() and p.deactivated_at is null;
  if v_org_id is null or v_caller not in ('administrator','cso_cro') then
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

-- rotate_invite_code: Administrator + CSO (was admin only). Generator tail
-- reproduced verbatim from 20260625000003 (bare gen_random_bytes).
create or replace function rotate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller role_level;
  v_code   text;
  v_n      int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select p.org_id, p.role_level into v_org_id, v_caller
    from profiles p where p.id = auth.uid();

  if v_org_id is null or v_caller not in ('administrator','cso_cro') then
    raise exception 'forbidden';
  end if;

  -- Fresh 8-char code; retry on the (astronomically unlikely) collision.
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
