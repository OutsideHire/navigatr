-- FR-PORT-46, 47, 49: first referral wins for public-form submissions too.
-- Attributing a submission to a partner now runs the same duplicate check as a
-- partner's own portal submission (_portal_find_duplicates) and stores the
-- flags on the new referral. A flagged referral then needs a written reason to
-- accept (accept_referral raises override_reason_required; the reviewer uses
-- accept_referral_override). Submissions carry no address, so it is null.
--
-- The return type changes from uuid to a single row, so the function is
-- dropped and recreated, then re-granted. Body otherwise copied from
-- 20261020000002_form_submission_triage.sql (the only earlier definition).

drop function if exists public.attribute_form_submission(uuid, uuid);

create function public.attribute_form_submission(p_submission_id uuid, p_partner_id uuid)
returns table (referral_id uuid, duplicate_of_referral_id uuid, duplicate_of_deal_id uuid, assigned_user_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare
  s          referral_form_submissions := public._form_submission_for_update(p_submission_id);
  v_company  text;
  v_id       uuid;
  v_dup_ref  uuid;
  v_dup_deal uuid;
  v_assignee uuid := auth.uid();
begin
  select p.company into v_company from partners p where p.id = p_partner_id and p.org_id = s.org_id;
  if not found or not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  -- First referral wins: an earlier open referral or active deal flags this one.
  select f.dup_referral_id, f.dup_deal_id into v_dup_ref, v_dup_deal
    from public._portal_find_duplicates(s.org_id, p_partner_id, s.company_name, s.contact_phone, null, null) f;
  -- Internal history note only: portal reads never return it (Deviation 8).
  perform public._referral_set_note(
    'From the referral form' || coalesce('. Who referred this business: ' || nullif(btrim(coalesce(s.referred_by_text, '')), ''), ''));
  insert into referrals (
    org_id, partner_id, direction, source, status, company_name, contact_name, contact_email,
    contact_phone, notes, partner_company_snapshot, assigned_user_id, submitted_at,
    consent_text_version, consent_text_snapshot, duplicate_of_referral_id, duplicate_of_deal_id
  ) values (
    s.org_id, p_partner_id, 'inbound', 'portal_public', 'submitted', s.company_name, s.contact_name,
    s.contact_email, s.contact_phone, coalesce(s.notes, ''), v_company, v_assignee, s.submitted_at,
    s.consent_version::text, s.consent_text_snapshot, v_dup_ref, v_dup_deal
  ) returning referrals.id into v_id;
  perform public._referral_set_note('');
  perform public._form_submission_close(s.id, 'attributed', v_id, null);
  return query select v_id, v_dup_ref, v_dup_deal, v_assignee;
end $$;

revoke execute on function public.attribute_form_submission(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.attribute_form_submission(uuid, uuid) to authenticated;
