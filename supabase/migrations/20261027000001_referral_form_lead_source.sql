-- FR-PORT-32: a form submission accepted with no partner gets its own lead source,
-- 'referral_form', instead of borrowing 'inbound'. Already-created deals are untouched.
-- The lead-source lock trigger already locks any value other than unknown/other.

alter table deals drop constraint if exists deals_lead_source_check;
alter table deals add constraint deals_lead_source_check check (lead_source in (
  'path', 'partner_referral', 'assigned', 'import',
  'places',
  'self_sourced_canvass', 'customer_referral', 'event_association', 'inbound', 'other', 'unknown',
  'referral_form'
));

create or replace function public.accept_form_submission(p_submission_id uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  s      referral_form_submissions := public._form_submission_for_update(p_submission_id);
  v_deal uuid;
  v_day  date;
begin
  insert into deals (
    org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents, stage, lead_source
  ) values (
    s.org_id, auth.uid(), s.company_name, coalesce(s.contact_name, s.company_name), s.contact_email,
    coalesce(s.contact_phone, ''), null, 'new', 'referral_form'
  ) returning id into v_deal;

  insert into deal_notes (deal_id, body, created_by)
  values (v_deal, public._form_submission_note(s, false), auth.uid());

  v_day := public.next_business_day(current_date, s.org_id);
  insert into task (
    org_id, owner_id, type, title, deal_id, earliest_at, target_at, latest_at,
    original_target_at, date_source
  ) values (
    s.org_id, auth.uid(), 'call', 'Follow up on referral from your form', v_deal,
    v_day, v_day, v_day, v_day, 'interval'
  );

  perform public._form_submission_close(s.id, 'accepted', null, v_deal);
  return v_deal;
end $$;
