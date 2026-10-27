-- Closed value on the referral's own page (FR-PORT-71, 11.2).
-- Same gate as the CSV export: the deal value comes back only when the
-- referral is Closed Won and the ISO lets partners see values. Anything else,
-- another partner's referral, or a disabled portal returns NULL.
create or replace function public.portal_referral_value(p_org uuid, p_partner uuid, p_referral uuid)
returns bigint
language sql stable security definer set search_path = public, extensions as $$
  select case when r.status = 'won' and o.partner_value_visibility then d.value_cents::bigint end
    from referrals r
    join organizations o on o.id = r.org_id
    left join deals d on d.id = r.deal_id
   where r.id = p_referral
     and r.org_id = p_org and r.partner_id = p_partner
     and r.direction = 'inbound'
     and o.portal_enabled and not o.is_disabled
$$;

revoke execute on function public.portal_referral_value(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.portal_referral_value(uuid, uuid, uuid) to service_role;
