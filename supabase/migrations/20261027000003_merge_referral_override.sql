-- 20261027000003_merge_referral_override.sql
--
-- Partner Portal audit fix (FR-PORT-47, FR-PORT-46). Accepting a referral
-- flagged as a probable duplicate already needs a written reason
-- (20261012000005); merging one now does too. merge_referral keeps its
-- arguments and refuses a flagged referral unless merge_referral_override set
-- the reason in the same transaction. The reason lands in the referral's
-- history note.
--
-- First partner keeps credit: when the target deal already credits ANOTHER
-- partner, any merge (flagged or not) leaves the referral unlinked. It ends
-- declined (duplicate), pointing at that deal, so its partner sees Not Moving
-- Forward and gets that email, never Accepted. With no partner on the deal (or
-- the same partner) the merge links the referral exactly as before.
--
-- Both merges now say what happened: {result: 'merged' | 'closed_duplicate',
-- credited_partner_name}. The name is only filled when the caller can see that
-- partner, so the toast never names a partner the rep cannot see. The return
-- type changes (void to jsonb), so both functions are dropped and recreated.
-- destructive-ok: drops and recreates two RPCs to change their return type; no data.

drop function if exists public.merge_referral_override(uuid, uuid, text);
drop function if exists public.merge_referral(uuid, uuid);

create function public.merge_referral(p_referral_id uuid, p_deal_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r       referrals := public._referral_for_update(p_referral_id);
  v_deal  deals;
  v_to    referral_status;
  v_flag  boolean;
  v_name  text;
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then
    raise exception 'referral_not_submitted' using errcode = '22023';
  end if;
  -- A probable duplicate needs a written reason (merge_referral_override).
  v_flag := r.duplicate_of_referral_id is not null or r.duplicate_of_deal_id is not null;
  if v_flag and coalesce(current_setting('navigatr.referral_note', true), '') = '' then
    raise exception 'override_reason_required' using errcode = '22023';
  end if;
  select * into v_deal from deals where id = p_deal_id;
  if not found or v_deal.org_id <> r.org_id or not public.user_can_see_owner(v_deal.owner_id) then
    raise exception 'deal_not_visible' using errcode = '42501';
  end if;
  -- First partner keeps credit: the deal stays theirs and this referral closes
  -- as a duplicate of it, whether or not it was flagged.
  if v_deal.source_partner_id is not null and v_deal.source_partner_id <> r.partner_id then
    update referrals
       set status = 'declined', decline_reason = 'duplicate',
           duplicate_of_deal_id = p_deal_id,
           assigned_user_id = coalesce(assigned_user_id, auth.uid()),
           triaged_by = auth.uid(), triaged_at = now()
     where id = r.id;
    if public.can_see_partner(v_deal.source_partner_id) then
      select name into v_name from partners where id = v_deal.source_partner_id;
    end if;
    return jsonb_build_object('result', 'closed_duplicate', 'credited_partner_name', v_name);
  end if;
  begin
    update referrals
       set status = 'accepted', deal_id = p_deal_id,
           assigned_user_id = coalesce(assigned_user_id, auth.uid()),
           triaged_by = auth.uid(), triaged_at = now()
     where id = r.id;
  exception when unique_violation then
    raise exception 'already_linked' using errcode = '23505';
  end;
  v_to := public.referral_status_for_stage(v_deal.stage);
  if v_to <> 'accepted' then
    update referrals set status = v_to where id = r.id;
  end if;
  update deals set source_partner_id = r.partner_id
   where id = p_deal_id and source_partner_id is null;
  return jsonb_build_object('result', 'merged', 'credited_partner_name', null);
end $$;

create function public.merge_referral_override(p_referral_id uuid, p_deal_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_result jsonb;
begin
  if v_reason = '' then
    raise exception 'override_reason_required' using errcode = '22023';
  end if;
  perform public._referral_set_note('Merged despite possible duplicate: ' || v_reason);
  v_result := public.merge_referral(p_referral_id, p_deal_id);
  perform public._referral_set_note('');
  return v_result;
end $$;

revoke execute on function public.merge_referral(uuid, uuid)                from public, anon;
revoke execute on function public.merge_referral_override(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.merge_referral(uuid, uuid)                to authenticated;
grant  execute on function public.merge_referral_override(uuid, uuid, text) to authenticated;
