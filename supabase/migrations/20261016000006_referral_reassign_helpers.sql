-- 20261016000006_referral_reassign_helpers.sql
--
-- Partner Portal Phase 2A (FR-PORT-55): managers and administrators reassign a
-- referral from the review sheet. reassign_referral (Phase 0) does the change
-- and already only touches assigned_user_id, which is what routes every later
-- email. These two read-only helpers feed the picker and the warning shown
-- BEFORE the rep confirms.
--
-- profiles RLS is org-wide (20260529000001), so the app cannot list "people I
-- can see in the hierarchy" without help. user_can_see_owner does not check
-- the org (an administrator passes for anyone), so both helpers pin the org.

create or replace function public.list_referral_assignees()
returns table (user_id uuid, full_name text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email
    from profiles p
   where p.org_id = public.user_org_id()
     and p.deactivated_at is null
     and (public.user_role() in ('manager','admin') or public.caller_is_admin())
     and public.user_can_see_owner(p.id)
   order by lower(coalesce(p.full_name, p.email)), p.id
$$;

create or replace function public.can_user_see_partner(p_user_id uuid, p_partner_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_org   uuid := public.user_org_id();
  v_owner uuid;
begin
  if v_org is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = p_user_id and org_id = v_org)
     or not public.user_can_see_owner(p_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select owner_id into v_owner from partners where id = p_partner_id;
  return public.profile_can_see_owner(p_user_id, v_owner);
end $$;

revoke execute on function public.list_referral_assignees()              from public, anon;
revoke execute on function public.can_user_see_partner(uuid, uuid)       from public, anon;
grant  execute on function public.list_referral_assignees()              to authenticated;
grant  execute on function public.can_user_see_partner(uuid, uuid)       to authenticated;
