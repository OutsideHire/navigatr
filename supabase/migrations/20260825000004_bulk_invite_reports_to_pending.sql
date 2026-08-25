-- Bulk CSV import: let a rep's reports_to resolve against a manager who is
-- ALSO being invited (a pending invite, not yet an active profile).
--
-- Why: org_invites.manager_id is a FK to profiles(id), so a rep invited in the
-- same file as their manager can't point at that manager yet (the manager has
-- no profile until they accept). Before this migration admin_bulk_invite
-- resolved reports_to only against existing ACTIVE profiles, so the natural
-- "manager + their reps in one CSV" flow failed every rep row with
-- reports_to_not_found (the shipped sample-agents.csv failed 2 of 3 rows).
--
-- Fix: store the reporting line as an EMAIL (reports_to_email) on the invite,
-- and resolve manager_id at ACCEPT time, order-independently:
--   * admin_bulk_invite: accept a reports_to email that is an active member OR
--     is being invited in this same batch OR already has a pending invite in
--     the org. Set manager_id now if the manager is active; otherwise defer via
--     reports_to_email. Unknown references (and self-references) still error.
--   * claim_invite_code: on accept, resolve manager_id from reports_to_email if
--     it wasn't set at invite time, AND backfill manager_id onto anyone who was
--     invited reporting to THIS person but accepted before this person existed.
--     Then rebuild the role_path subtree so hierarchy visibility is correct
--     regardless of who accepts first.

-- 1) Persist the deferred reporting line as an email on both tables.
alter table org_invites add column if not exists reports_to_email text;
alter table profiles    add column if not exists reports_to_email text;

-- 2) admin_bulk_invite: batch-aware, pending-aware reports_to resolution.
create or replace function admin_bulk_invite(p_invites jsonb)
returns table (email text, id uuid, ok boolean, error text)
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id       uuid;
  v_caller       role_level;
  v_seat_cap     int;
  v_used         int;
  v_remaining    int;
  v_row          jsonb;
  v_email        text;
  v_name         text;
  v_level        role_level;
  v_reports      text;
  v_reports_email text;
  v_mgr          uuid;
  v_new_id       uuid;
  v_batch_emails text[];
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

  -- Every email being invited in THIS call, so a rep row can reference a
  -- manager row that appears later in the same array.
  select coalesce(array_agg(lower(trim(elem->>'email'))), '{}'::text[]) into v_batch_emails
    from jsonb_array_elements(p_invites) elem;

  for v_row in select * from jsonb_array_elements(p_invites)
  loop
    v_email         := lower(trim(v_row->>'email'));
    v_name          := nullif(trim(coalesce(v_row->>'full_name', '')), '');
    v_mgr           := null;
    v_reports_email := null;

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

    -- reports_to: optional. A profile id (existing active member) OR an email.
    -- An email may point at an active member (manager_id set now) OR at someone
    -- being invited in this same batch / already pending in the org (deferred
    -- to accept time via reports_to_email). Unknown / self => error row.
    v_reports := nullif(trim(coalesce(v_row->>'reports_to', '')), '');
    if v_reports is not null then
      if v_reports ~ '^[0-9a-fA-F-]{36}$' then
        select p.id into v_mgr from profiles p
         where p.id = v_reports::uuid and p.org_id = v_org_id and p.deactivated_at is null;
        if v_mgr is null then
          email := v_email; id := null; ok := false; error := 'reports_to_not_found';
          return next; continue;
        end if;
        select lower(u.email) into v_reports_email from auth.users u where u.id = v_mgr;
      else
        if lower(v_reports) = v_email then
          email := v_email; id := null; ok := false; error := 'reports_to_self';
          return next; continue;
        end if;
        v_reports_email := lower(v_reports);
        select p.id into v_mgr from profiles p
         join auth.users u on u.id = p.id
         where lower(u.email) = v_reports_email and p.org_id = v_org_id and p.deactivated_at is null;
        if v_mgr is null
           and not (v_reports_email = any(v_batch_emails))
           and not exists (
             select 1 from org_invites
              where org_id = v_org_id and lower(org_invites.email) = v_reports_email
                and accepted_at is null and revoked_at is null
           ) then
          email := v_email; id := null; ok := false; error := 'reports_to_not_found';
          return next; continue;
        end if;
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
    insert into org_invites (org_id, email, full_name, role, role_level, manager_id, reports_to_email, token, invited_by)
      values (
        v_org_id, v_email, v_name,
        case v_level
          when 'administrator' then 'admin'::user_role
          when 'sales_professional' then 'rep'::user_role
          else 'manager'::user_role
        end,
        v_level, v_mgr, v_reports_email, _admin_invite_token(), auth.uid()
      )
    returning org_invites.id into v_new_id;

    v_remaining := v_remaining - 1;
    email := v_email; id := v_new_id; ok := true; error := null;
    return next;
  end loop;
end $$;
grant execute on function admin_bulk_invite(jsonb) to authenticated;

-- 3) claim_invite_code: resolve/backfill the reporting line at accept time.
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
  v_mgr      uuid;
  v_ancestors uuid[];
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

  -- Path A: per-agent token from org_invites (carries role_level + manager).
  select * into v_invite from org_invites o
   where o.token = p_code and o.accepted_at is null and o.revoked_at is null and o.expires_at > now();
  if found then
    -- Reporting line: prefer the manager_id stamped at invite time; otherwise
    -- resolve the deferred reports_to_email against a now-active member.
    v_mgr := v_invite.manager_id;
    if v_mgr is null and v_invite.reports_to_email is not null then
      select p.id into v_mgr from profiles p
       join auth.users u on u.id = p.id
       where lower(u.email) = lower(v_invite.reports_to_email)
         and p.org_id = v_invite.org_id and p.deactivated_at is null;
    end if;

    insert into profiles (id, org_id, role, role_level, manager_id, reports_to_email, full_name, email)
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
      v_mgr,
      v_invite.reports_to_email,
      coalesce(
        v_invite.full_name,
        (select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = auth.uid()),
        v_email
      ),
      v_email
    );
    update org_invites set accepted_at = now() where id = v_invite.id;

    -- Backfill: anyone invited reporting to THIS person (by email) who accepted
    -- before this person existed is now re-parented onto them. Only touches
    -- still-unplaced rows, so it never overrides a manager already resolved.
    --
    -- Exclude this person's OWN manager chain: re-parenting an ancestor onto
    -- auth.uid() would close a manager_id cycle (e.g. two people who list each
    -- other as reports_to in the same CSV). Such a node stays unplaced for an
    -- admin to resolve rather than corrupting the tree. (Active profiles are
    -- acyclic by invariant, so this upward walk terminates.)
    select coalesce(array_agg(id), '{}'::uuid[]) into v_ancestors
      from (
        with recursive up as (
          select v_mgr as id
          union all
          select p.manager_id from profiles p join up on p.id = up.id
           where p.manager_id is not null
        )
        select id from up where id is not null
      ) s;

    update profiles p set manager_id = auth.uid()
     where p.org_id = v_invite.org_id
       and p.id <> auth.uid()
       and p.manager_id is null
       and lower(p.reports_to_email) = lower(v_email)
       and p.id <> all(v_ancestors);

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

-- 4) Defense in depth: make rebuild_role_path_subtree cycle-safe. It walks the
-- subtree DOWN the manager_id chain with no termination guard; a manager_id
-- cycle (which the accept-time backfill above now prevents, but which any
-- future write path could still introduce) would recurse forever and hang the
-- caller. The CYCLE clause stops the recursion the moment an id repeats along a
-- path. Behavior is byte-for-byte identical for acyclic trees (every id appears
-- exactly once), so this is a pure safety net. `create or replace` preserves the
-- existing ACL; the revokes are re-stated to keep the function off the PostgREST
-- surface regardless.
create or replace function public.rebuild_role_path_subtree(p_root uuid)
returns void language sql as $$
  with recursive tree as (
    select m.id,
           case
             when m.role = 'admin' then null::ltree
             when parent.role_path is null then public.profile_role_label(m.id)
             else parent.role_path || public.profile_role_label(m.id)
           end as new_path
    from profiles m
    left join profiles parent on parent.id = m.manager_id
    where m.id = p_root
    union all
    select c.id,
           case
             when c.role = 'admin' then null::ltree
             when t.new_path is null then public.profile_role_label(c.id)
             else t.new_path || public.profile_role_label(c.id)
           end
    from profiles c
    join tree t on c.manager_id = t.id
  ) cycle id set is_cycle using cycle_path
  update profiles p set role_path = tree.new_path
  from tree where tree.id = p.id;
$$;
revoke all on function public.rebuild_role_path_subtree(uuid) from public;
revoke all on function public.rebuild_role_path_subtree(uuid) from anon;
revoke all on function public.rebuild_role_path_subtree(uuid) from authenticated;
