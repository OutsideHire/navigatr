-- 20261012000005_accept_referral_override.sql
--
-- Partner Portal Phase 1B (FR-PORT-47, spec 5.5): a portal referral flagged as a
-- probable duplicate (duplicate_of_referral_id or duplicate_of_deal_id) arrives
-- with Decline (duplicate) preselected. Accepting it anyway needs a written
-- reason, recorded in the referral's history note. accept_referral keeps its
-- signature and result; it refuses a flagged referral unless the reason was set
-- by accept_referral_override in the same transaction.

create or replace function public.accept_referral(p_referral_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r         referrals := public._referral_for_update(p_referral_id);
  v_owner   uuid;
  v_deal    uuid;
  v_dup     uuid;
  v_partner text;
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then
    raise exception 'referral_not_submitted' using errcode = '22023';
  end if;
  -- Phase 1B: a probable duplicate needs a written reason (accept_referral_override).
  if (r.duplicate_of_referral_id is not null or r.duplicate_of_deal_id is not null)
     and coalesce(current_setting('navigatr.referral_note', true), '') = '' then
    raise exception 'override_reason_required' using errcode = '22023';
  end if;
  -- A deactivated (or missing) assignee cannot own the new deal; the accepter does.
  v_owner := auth.uid();
  if r.assigned_user_id is not null and exists (
       select 1 from profiles where id = r.assigned_user_id and deactivated_at is null) then
    v_owner := r.assigned_user_id;
  end if;

  begin
    insert into deals (
      org_id, owner_id, company_name, address, industry, contact_name, contact_email,
      contact_phone, value_cents, stage, lead_source, place_id, source_referral_id,
      source_partner_id
    ) values (
      r.org_id, v_owner, r.company_name, r.address, r.industry,
      coalesce(r.contact_name, r.company_name), r.contact_email, coalesce(r.contact_phone, ''),
      null, 'new', 'partner_referral', r.place_id, r.id, r.partner_id
    ) returning id into v_deal;
  exception when unique_violation then
    -- Blocked by the active-deal dedupe (place_id index or name+address trigger).
    select d.id into v_dup
      from deals d
     where d.org_id = r.org_id
       and d.stage not in ('won','lost')
       and ((r.place_id is not null and d.place_id = r.place_id)
            or d.dedupe_key = public.deal_dedupe_key(r.company_name, r.address))
       and public.user_can_see_owner(d.owner_id)
     limit 1;
    return jsonb_build_object('result', 'duplicate', 'deal_id', v_dup);
  end;

  update referrals
     set status = 'accepted', deal_id = v_deal, assigned_user_id = v_owner,
         triaged_by = auth.uid(), triaged_at = now()
   where id = r.id;

  select name into v_partner from partners where id = r.partner_id;
  insert into task (
    org_id, owner_id, type, title, deal_id, earliest_at, target_at, latest_at,
    original_target_at, date_source
  ) values (
    r.org_id, v_owner, 'call', 'Follow up on referral from ' || v_partner, v_deal,
    public.next_business_day(current_date, r.org_id),
    public.next_business_day(current_date, r.org_id),
    public.next_business_day(current_date, r.org_id),
    public.next_business_day(current_date, r.org_id),
    'interval'
  );

  return jsonb_build_object('result', 'accepted', 'deal_id', v_deal);
end $$;

create or replace function public.accept_referral_override(p_referral_id uuid, p_override_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := left(btrim(coalesce(p_override_reason, '')), 500);
  v_result jsonb;
begin
  if v_reason = '' then
    raise exception 'override_reason_required' using errcode = '22023';
  end if;
  perform public._referral_set_note('Accepted despite possible duplicate: ' || v_reason);
  v_result := public.accept_referral(p_referral_id);
  perform public._referral_set_note('');
  return v_result;
end $$;

revoke execute on function public.accept_referral(uuid)                from public, anon;
revoke execute on function public.accept_referral_override(uuid, text) from public, anon;
grant  execute on function public.accept_referral(uuid)                to authenticated;
grant  execute on function public.accept_referral_override(uuid, text) to authenticated;
