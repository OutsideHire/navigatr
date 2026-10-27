-- FR-PORT-42: "Withdraw (partner asked)". Withdrawing a referral now also clears
-- the deal's partner credit, as remove_referral_link does, but only when the deal
-- is credited to this referral's partner and no other live inbound referral from
-- that partner still backs the credit. Same signature and guards as before.
create or replace function public.withdraw_referral(p_referral_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r referrals := public._referral_for_update(p_referral_id);
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if r.status in ('won','lost','declined','withdrawn') then
    raise exception 'referral_closed' using errcode = '22023';
  end if;
  perform public._referral_set_note(p_note);
  update referrals set status = 'withdrawn' where id = r.id;
  perform public._referral_set_note('');
  if r.deal_id is not null then
    update deals set source_partner_id = null
     where id = r.deal_id and source_partner_id = r.partner_id
       and not exists (select 1 from referrals x
                       where x.deal_id = r.deal_id and x.partner_id = r.partner_id
                         and x.direction = 'inbound' and x.id <> r.id
                         and x.status not in ('declined','withdrawn'));
  end if;
end $$;
