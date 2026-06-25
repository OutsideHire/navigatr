-- admin_set_role: change a member's role (rep/manager/admin). Admin-only —
-- stricter than admin_revoke_member's manager+admin gate (whose structure this
-- otherwise follows). Guards: not self, not the sole admin's
-- demotion. role_path (reporting hierarchy) is NOT touched here — visibility
-- (deals/activities RLS, coverage rollup) is unchanged.

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
    from profiles p
   where p.id = auth.uid() and p.deactivated_at is null;
  if v_org_id is null or v_caller <> 'admin' then
    raise exception 'forbidden';
  end if;

  if p_profile_id = auth.uid() then
    raise exception 'cannot_change_own_role';
  end if;

  select p.role into v_target_role
    from profiles p
   where p.id = p_profile_id and p.org_id = v_org_id and p.deactivated_at is null;
  if v_target_role is null then
    raise exception 'profile_not_found';
  end if;

  -- TODO(sole-admin-race): two concurrent demotions of different admins can each
  -- pass this check and drop the org to zero admins. Acceptable for now (admin-
  -- only, low concurrency) — mirrors the documented TODO(seat-cap-race) in
  -- admin_portal_rpcs.sql. Hard fix: `select ... for update` the admin rows
  -- before counting.
  if v_target_role = 'admin' and p_new_role <> 'admin'
     and (select count(*) from profiles
            where org_id = v_org_id and role = 'admin' and deactivated_at is null) <= 1 then
    raise exception 'cannot_demote_sole_admin';
  end if;

  update profiles set role = p_new_role where id = p_profile_id and org_id = v_org_id;
end $$;

grant execute on function admin_set_role(uuid, user_role) to authenticated;
