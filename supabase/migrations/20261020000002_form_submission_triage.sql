-- 20261020000002_form_submission_triage.sql
--
-- Partner Portal Phase 2B-2 (FR-PORT-31, 32, 49, 51). Triage of public form
-- submissions. Every RPC goes through _form_submission_for_update: the row is
-- locked FOR UPDATE, then org, triage rights (can_triage_referral, the same
-- rule the 2B-1 SELECT policy inlines) and state (untriaged, unpurged) are
-- re-checked, so two reviewers can never both act on one submission.
--
--   attribute  -> a referrals row (source portal_public, submitted_at kept,
--                 assigned to the reviewer, who keeps it). The app then calls
--                 the EXISTING accept_referral / decline_referral / merge_referral.
--   accept     -> no partner: a deal owned by the reviewer (lead source inbound),
--                 the first follow-up task and a deal note.
--   decline    -> reason and note stored; personal details wait for the purge.
--   merge      -> no partner: linked to a deal the reviewer can see, deal note.
--   reassign   -> managers and administrators, like reassign_referral.
--
-- On attribute, accept and merge the submission's personal fields are cleared
-- (the data now lives on the referral or the deal); consent is kept as the
-- record. No column grants change: authenticated still never reads the IP.

-- 1. Columns and outcome ---------------------------------------------------------
alter table referral_form_submissions
  add column if not exists decline_reason referral_decline_reason,
  add column if not exists decline_note   text,
  add column if not exists nudged_at      timestamptz;

alter table referral_form_submissions drop constraint referral_form_submissions_outcome_check;
alter table referral_form_submissions add constraint referral_form_submissions_outcome_check
  check (outcome is null or outcome in ('attributed','accepted','declined','merged'));

-- 2. Private helpers -----------------------------------------------------------------
create or replace function public._form_submission_for_update(p_submission_id uuid)
returns referral_form_submissions language plpgsql security definer set search_path = public, extensions as $$
declare
  s referral_form_submissions;
begin
  select * into s from referral_form_submissions x where x.id = p_submission_id for update;
  if not found or s.org_id is distinct from public.user_org_id() then
    raise exception 'submission_not_found' using errcode = 'P0002';
  end if;
  if not public.can_triage_referral(s.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if s.triaged_at is not null or s.purged_at is not null then
    raise exception 'submission_handled' using errcode = '22023';
  end if;
  return s;
end $$;

-- Converted: stamp the triage and clear what the referral or deal now holds.
create or replace function public._form_submission_close(p_id uuid, p_outcome text, p_referral uuid, p_deal uuid)
returns void language sql security definer set search_path = public, extensions as $$
  update referral_form_submissions s
     set outcome          = p_outcome,
         referral_id      = p_referral,
         deal_id          = p_deal,
         triaged_at       = now(),
         triaged_by       = auth.uid(),
         contact_name     = null,
         contact_email    = null,
         contact_phone    = null,
         notes            = null,
         referred_by_text = null,
         referrer_email   = null,
         submitter_ip     = null
   where s.id = p_id
$$;

-- The deal note for a no-partner accept or merge (Deviation 6).
create or replace function public._form_submission_note(p_s referral_form_submissions, p_with_contact boolean)
returns text language sql stable security definer set search_path = public, extensions as $$
  select concat_ws(E'\n',
    'From your referral form.',
    case when p_with_contact
         then nullif('Contact: ' || concat_ws(', ', p_s.contact_name, p_s.contact_email, p_s.contact_phone), 'Contact: ')
    end,
    nullif(btrim(coalesce(p_s.notes, '')), ''),
    'Who referred this business: ' || nullif(btrim(coalesce(p_s.referred_by_text, '')), ''))
$$;

-- 3. Advice for the review sheet (advisory, never blocks) ------------------------------
-- Probable match to an active deal or an open referral the REVIEWER can see,
-- by phone key or name key (a submission has no address), plus the chain brand.
create or replace function public.form_submission_advice(p_submission_id uuid)
returns table (
  dup_referral_id uuid, dup_referral_company text, dup_deal_id uuid, dup_deal_company text, chain_brand text
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  s       referral_form_submissions;
  v_phone text;
  v_name  text;
begin
  select * into s from referral_form_submissions x where x.id = p_submission_id;
  if s.id is null or s.org_id is distinct from public.user_org_id()
     or not public.can_triage_referral(s.assigned_user_id) then
    raise exception 'submission_not_found' using errcode = 'P0002';
  end if;
  v_phone := public.deal_phone_key(s.contact_phone);
  v_name  := public.deal_name_key(s.company_name);
  return query
  with rr as (
    select r.id, r.company_name
      from referrals r
     where r.org_id = s.org_id
       and r.direction = 'inbound'
       and r.status not in ('declined','withdrawn')
       and r.purged_at is null
       and (public.can_see_partner(r.partner_id)
            or (r.assigned_user_id is not null and public.user_can_see_owner(r.assigned_user_id)))
       and ((v_phone is not null and public.deal_phone_key(r.contact_phone) = v_phone)
            or (v_name is not null and public.deal_name_key(r.company_name) = v_name))
     order by r.submitted_at, r.id
     limit 1
  ),
  dd as (
    select d.id, d.company_name
      from deals d
     where d.org_id = s.org_id
       and d.stage not in ('won','lost')
       and public.user_can_see_owner(d.owner_id)
       and ((v_phone is not null and public.deal_phone_key(d.contact_phone) = v_phone)
            or (v_name is not null and public.deal_name_key(d.company_name) = v_name))
     order by d.created_at, d.id
     limit 1
  )
  select (select rr.id from rr), (select rr.company_name from rr),
         (select dd.id from dd), (select dd.company_name from dd),
         public._referral_chain_brand(s.company_name);
end $$;

-- 4. Attribute to a partner (FR-PORT-32, 49, 51 as ruled: the reviewer keeps it) --------
create or replace function public.attribute_form_submission(p_submission_id uuid, p_partner_id uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  s         referral_form_submissions := public._form_submission_for_update(p_submission_id);
  v_company text;
  v_id      uuid;
begin
  select p.company into v_company from partners p where p.id = p_partner_id and p.org_id = s.org_id;
  if not found or not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  -- Internal history note only: portal reads never return it (Deviation 8).
  perform public._referral_set_note(
    'From the referral form' || coalesce('. Who referred this business: ' || nullif(btrim(coalesce(s.referred_by_text, '')), ''), ''));
  insert into referrals (
    org_id, partner_id, direction, source, status, company_name, contact_name, contact_email,
    contact_phone, notes, partner_company_snapshot, assigned_user_id, submitted_at,
    consent_text_version, consent_text_snapshot
  ) values (
    s.org_id, p_partner_id, 'inbound', 'portal_public', 'submitted', s.company_name, s.contact_name,
    s.contact_email, s.contact_phone, coalesce(s.notes, ''), v_company, auth.uid(), s.submitted_at,
    s.consent_version::text, s.consent_text_snapshot
  ) returning referrals.id into v_id;
  perform public._referral_set_note('');
  perform public._form_submission_close(s.id, 'attributed', v_id, null);
  return v_id;
end $$;

-- 5. Accept with no partner: the reviewer's deal --------------------------------------
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
    coalesce(s.contact_phone, ''), null, 'new', 'inbound'
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

-- 6. Decline: personal details stay until the retention purge (FR-PORT-93) -----------
create or replace function public.decline_form_submission(
  p_submission_id uuid, p_reason referral_decline_reason, p_note text default null
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s referral_form_submissions := public._form_submission_for_update(p_submission_id);
begin
  if p_reason is null or p_reason = 'withdrawn_by_partner' then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  update referral_form_submissions x
     set outcome        = 'declined',
         decline_reason = p_reason,
         decline_note   = nullif(btrim(coalesce(p_note, '')), ''),
         triaged_at     = now(),
         triaged_by     = auth.uid()
   where x.id = s.id;
end $$;

-- 7. Merge with no partner into a deal the reviewer can see ---------------------------
create or replace function public.merge_form_submission(p_submission_id uuid, p_deal_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s      referral_form_submissions := public._form_submission_for_update(p_submission_id);
  v_deal deals;
begin
  select * into v_deal from deals d where d.id = p_deal_id;
  if not found or v_deal.org_id <> s.org_id or not public.user_can_see_owner(v_deal.owner_id) then
    raise exception 'deal_not_visible' using errcode = '42501';
  end if;
  insert into deal_notes (deal_id, body, created_by)
  values (p_deal_id, public._form_submission_note(s, true), auth.uid());
  perform public._form_submission_close(s.id, 'merged', null, p_deal_id);
end $$;

-- 8. Reassign (same gate as reassign_referral) ------------------------------------------
create or replace function public.reassign_form_submission(p_submission_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s referral_form_submissions := public._form_submission_for_update(p_submission_id);
begin
  if not (public.user_role() in ('manager','admin') or public.caller_is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles p
                  where p.id = p_user_id and p.org_id = s.org_id and p.deactivated_at is null) then
    raise exception 'assignee_invalid' using errcode = '22023';
  end if;
  if not public.user_can_see_owner(p_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update referral_form_submissions x set assigned_user_id = p_user_id where x.id = s.id;
end $$;

-- 9. Privileges ----------------------------------------------------------------------------
revoke execute on function public._form_submission_for_update(uuid)                            from public, anon, authenticated, service_role;
revoke execute on function public._form_submission_close(uuid, text, uuid, uuid)                from public, anon, authenticated, service_role;
revoke execute on function public._form_submission_note(referral_form_submissions, boolean)     from public, anon, authenticated, service_role;

revoke execute on function public.form_submission_advice(uuid)                                  from public, anon;
revoke execute on function public.attribute_form_submission(uuid, uuid)                         from public, anon;
revoke execute on function public.accept_form_submission(uuid)                                  from public, anon;
revoke execute on function public.decline_form_submission(uuid, referral_decline_reason, text)  from public, anon;
revoke execute on function public.merge_form_submission(uuid, uuid)                             from public, anon;
revoke execute on function public.reassign_form_submission(uuid, uuid)                          from public, anon;
grant  execute on function public.form_submission_advice(uuid)                                  to authenticated;
grant  execute on function public.attribute_form_submission(uuid, uuid)                         to authenticated;
grant  execute on function public.accept_form_submission(uuid)                                  to authenticated;
grant  execute on function public.decline_form_submission(uuid, referral_decline_reason, text)  to authenticated;
grant  execute on function public.merge_form_submission(uuid, uuid)                             to authenticated;
grant  execute on function public.reassign_form_submission(uuid, uuid)                          to authenticated;
