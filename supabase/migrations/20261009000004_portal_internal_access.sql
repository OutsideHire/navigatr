-- 20261009000004_portal_internal_access.sql
--
-- Partner Portal Phase 1A (spec 5.3 suspend/revoke, FR-PORT-13): the in-app
-- controls on the partner record. Callable by signed-in internal users; each
-- re-checks visibility of the partner.

-- Is the portal on for my org, and what is its address? Safe for any member.
create or replace function public.get_portal_status()
returns table (enabled boolean, slug text)
language sql stable security definer set search_path = public, extensions as $$
  select o.portal_enabled and not o.is_disabled, o.slug
    from organizations o
   where o.id = public.user_org_id()
$$;

-- Suspend, revoke, or restore a partner's portal access.
create or replace function public.portal_set_access(p_partner_id uuid, p_status text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_org  uuid := public.user_org_id();
  v_user portal_users;
begin
  if v_org is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('suspended', 'revoked', 'invited') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_user from portal_users u
   where u.partner_id = p_partner_id and u.org_id = v_org
   for update;
  if v_user.id is null then
    raise exception 'portal_user_not_found' using errcode = 'P0002';
  end if;

  if p_status = 'invited' then
    if v_user.status not in ('suspended', 'revoked') then
      raise exception 'portal_not_restorable' using errcode = '55000';
    end if;
    update portal_users set status = 'invited', updated_at = now() where id = v_user.id;
    perform public._portal_audit(v_org, v_user.id, 'restore', null, auth.uid());
    return 'invited';
  end if;

  -- Revoked is final short of a restore; it never steps back down to suspended.
  if p_status = 'suspended' and v_user.status = 'revoked' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  update portal_users set status = p_status::portal_user_status, updated_at = now() where id = v_user.id;
  -- Every request looks the session up, so the very next one fails (spec 5.3).
  update portal_sessions s set revoked_at = now()
   where s.portal_user_id = v_user.id and s.revoked_at is null;
  update portal_tokens t set revoked_at = now()
   where t.portal_user_id = v_user.id and t.consumed_at is null and t.revoked_at is null;
  perform public._portal_audit(
    v_org, v_user.id,
    (case when p_status = 'suspended' then 'suspend' else 'revoke' end)::portal_audit_action,
    null, auth.uid());
  return p_status;
end $$;

revoke execute on function public.get_portal_status()             from public, anon;
revoke execute on function public.portal_set_access(uuid, text)   from public, anon;
grant  execute on function public.get_portal_status()             to authenticated;
grant  execute on function public.portal_set_access(uuid, text)   to authenticated;
