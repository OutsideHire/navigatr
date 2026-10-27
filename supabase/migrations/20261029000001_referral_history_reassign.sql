-- Referral history in the app, with reassignments (FR-PORT-60).
--
-- 1. reassign_referral also writes a history row. The status does not change, so
--    from_status = to_status = the current status; the note names the new owner.
-- 2. portal_referral_history skips those rows. They are internal, a partner must
--    never see who handled their referral internally.

create or replace function public.reassign_referral(p_referral_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  r       referrals := public._referral_for_update(p_referral_id);
  v_owner uuid;
  v_name  text;
begin
  if not (public.user_role() in ('manager','admin') or public.caller_is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles
                 where id = p_user_id and org_id = r.org_id and deactivated_at is null) then
    raise exception 'assignee_invalid' using errcode = '22023';
  end if;
  if not public.user_can_see_owner(p_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update referrals set assigned_user_id = p_user_id where id = r.id;
  select full_name into v_name from profiles where id = p_user_id;
  insert into referral_status_history (org_id, referral_id, from_status, to_status, actor_type, actor_id, note)
  values (r.org_id, r.id, r.status, r.status, 'user', auth.uid(), 'Reassigned to ' || coalesce(v_name, 'a teammate'));
  select owner_id into v_owner from partners where id = r.partner_id;
  return public.profile_can_see_owner(p_user_id, v_owner);
end $$;

create or replace function public.portal_referral_history(p_org uuid, p_partner uuid, p_referral uuid)
returns table (status referral_status, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select h.to_status, h.created_at
    from referral_status_history h
    join referrals r on r.id = h.referral_id
   where h.referral_id = p_referral
     and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound'
     and h.from_status is distinct from h.to_status
   order by h.created_at, h.to_status, h.id
$$;
