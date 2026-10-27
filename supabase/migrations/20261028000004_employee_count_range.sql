-- 20261028000004_employee_count_range.sql
--
-- FR-PORT-35 (Robert's answer Q10): business size as an employee count, an
-- optional "How many employees?" on both partner referral forms, carried onto
-- the deal. Four buckets, stored as '1-10', '11-50', '51-200', '201+'
-- (labels in _shared/portalSubmission.ts EMPLOYEE_COUNT_OPTIONS). The app's
-- Add/Edit Deal pickers switch to the same four buckets, so existing deals on
-- the old picker values are remapped (Decision 8, an approximation the product
-- owner accepted). deals.employee_count_range stays plain text with no CHECK:
-- imports and older rows may hold other wording, which is left as it is.
--
-- portal_submit_referral and portal_public_submit gain p_employee_count text
-- default null as their LAST argument, so existing positional and named-arg
-- callers keep working. A new argument changes the signature, so each is
-- dropped, recreated and re-granted (service_role only, as before).
-- accept_referral, accept_form_submission and attribute_form_submission keep
-- their signatures (create or replace keeps their grants). Every body is copied
-- from its latest definition:
--   portal_submit_referral    20261012000003_portal_referral_submit.sql
--   portal_public_submit      20261018000003_public_form_submissions.sql
--   accept_referral           20261012000005_accept_referral_override.sql
--   accept_form_submission    20261027000001_referral_form_lead_source.sql
--   attribute_form_submission 20261027000002_form_submission_first_wins.sql

-- 1. Columns ------------------------------------------------------------------------
alter table referrals add column if not exists employee_count_range text
  constraint referrals_employee_count_range_check
  check (employee_count_range is null or employee_count_range in ('1-10','11-50','51-200','201+'));

alter table referral_form_submissions add column if not exists employee_count_range text
  constraint referral_form_submissions_employee_count_range_check
  check (employee_count_range is null or employee_count_range in ('1-10','11-50','51-200','201+'));

-- 2. Remap the old Add Deal picker values (Decision 8). Anything else is untouched.
update deals
   set employee_count_range = case employee_count_range
         when '1-9'    then '1-10'
         when '10-49'  then '11-50'
         when '50-249' then '51-200'
         when '250+'   then '201+'
       end
 where employee_count_range in ('1-9', '10-49', '50-249', '250+');

-- 3. Signed-in partner submit (FR-PORT-35) --------------------------------------------
drop function if exists public.portal_submit_referral(uuid, uuid, uuid, text, text, text, text, text, text, text, text, boolean, integer, text);

create function public.portal_submit_referral(
  p_org             uuid,
  p_partner         uuid,
  p_portal_user     uuid,
  p_company         text,
  p_contact_name    text,
  p_contact_email   text,
  p_contact_phone   text,
  p_address         text,
  p_industry        text,
  p_urgency         text,
  p_notes           text,
  p_consent         boolean,
  p_consent_version integer,
  p_ip              text,
  p_employee_count  text default null
)
returns table (id uuid, ref text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org      organizations;
  v_partner  partners;
  v_company  text := btrim(coalesce(p_company, ''));
  v_contact  text := btrim(coalesce(p_contact_name, ''));
  v_email    text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  v_phone    text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_address  text := nullif(btrim(coalesce(p_address, '')), '');
  v_industry text := nullif(btrim(coalesce(p_industry, '')), '');
  v_urgency  text := nullif(btrim(coalesce(p_urgency, '')), '');
  v_size     text := nullif(btrim(coalesce(p_employee_count, '')), '');
  v_notes    text := btrim(coalesce(p_notes, ''));
  v_dup_ref  uuid;
  v_dup_deal uuid;
  v_id       uuid;
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  select * into v_org from organizations o where o.id = p_org;
  select * into v_partner from partners p where p.id = p_partner;

  -- Consent (brief D4): required, and the version is the org's, never the client's.
  if not coalesce(p_consent, false) then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if p_consent_version is distinct from v_org.consent_version then
    raise exception 'consent_changed' using errcode = 'P0001';
  end if;

  -- Field rules mirror _shared/portalSubmission.ts (brief D9).
  if v_company = '' or length(v_company) > 160 then
    raise exception 'invalid_input:companyName' using errcode = '22023';
  end if;
  if v_contact = '' or length(v_contact) > 120 then
    raise exception 'invalid_input:contactName' using errcode = '22023';
  end if;
  if v_email is not null and (length(v_email) > 254 or position('@' in v_email) < 2) then
    raise exception 'invalid_input:email' using errcode = '22023';
  end if;
  if v_phone is not null and length(v_phone) > 40 then
    raise exception 'invalid_input:phone' using errcode = '22023';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'invalid_input:emailOrPhone' using errcode = '22023';
  end if;
  if v_address is not null and length(v_address) > 300 then
    raise exception 'invalid_input:address' using errcode = '22023';
  end if;
  if v_industry is not null and v_industry not in
     ('restaurant','retail','healthcare','professional_services','personal_services','automotive','other') then
    raise exception 'invalid_input:industry' using errcode = '22023';
  end if;
  if v_urgency is not null and v_urgency not in ('this_week','this_month','no_rush') then
    raise exception 'invalid_input:urgency' using errcode = '22023';
  end if;
  if v_size is not null and v_size not in ('1-10','11-50','51-200','201+') then
    raise exception 'invalid_input:employeeCount' using errcode = '22023';
  end if;
  if length(v_notes) > 4000 then
    raise exception 'invalid_input:notes' using errcode = '22023';
  end if;

  -- Rate limits (brief D8): 30 per hour and 200 per day per portal user.
  perform pg_advisory_xact_lock(hashtextextended('portal_submit:' || p_portal_user::text, 0));
  if (select count(*) from referrals r
       where r.submitted_by_portal_user_id = p_portal_user and r.source = 'portal_signed_in'
         and r.submitted_at > now() - interval '1 hour') >= 30
     or (select count(*) from referrals r
       where r.submitted_by_portal_user_id = p_portal_user and r.source = 'portal_signed_in'
         and r.submitted_at > now() - interval '24 hours') >= 200 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- Attribution (FR-PORT-46..49): the earlier referral keeps credit; this one is flagged.
  select f.dup_referral_id, f.dup_deal_id into v_dup_ref, v_dup_deal
    from public._portal_find_duplicates(p_org, p_partner, v_company, v_phone, v_address, null) f;

  perform set_config('navigatr.referral_actor', 'partner', true);
  perform set_config('navigatr.referral_actor_id', p_portal_user::text, true);
  insert into referrals (
    org_id, partner_id, direction, source, status, company_name, contact_name,
    contact_email, contact_phone, address, industry, urgency, employee_count_range, notes,
    partner_company_snapshot, assigned_user_id, submitted_by_portal_user_id,
    duplicate_of_referral_id, duplicate_of_deal_id, consent_text_version, consent_text_snapshot
  ) values (
    p_org, p_partner, 'inbound', 'portal_signed_in', 'submitted', v_company, v_contact,
    v_email, v_phone, v_address, v_industry, v_urgency, v_size, v_notes,
    v_partner.company, public.referral_route_assignee(p_partner), p_portal_user,
    v_dup_ref, v_dup_deal, v_org.consent_version::text,
    public._portal_consent_text(v_org.consent_text)
  ) returning referrals.id into v_id;
  perform set_config('navigatr.referral_actor', '', true);
  perform set_config('navigatr.referral_actor_id', '', true);

  perform public._portal_audit_referral(p_org, p_portal_user, 'submit', v_id, p_ip);

  return query select v_id, public._portal_referral_ref(v_id);
end $$;

revoke execute on function public.portal_submit_referral(uuid, uuid, uuid, text, text, text, text, text, text, text, text, boolean, integer, text, text) from public, anon, authenticated;
grant  execute on function public.portal_submit_referral(uuid, uuid, uuid, text, text, text, text, text, text, text, text, boolean, integer, text, text) to service_role;

-- 4. Public form submit (FR-PORT-35) --------------------------------------------------
drop function if exists public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean);

create function public.portal_public_submit(
  p_slug            text,
  p_token           text,
  p_company         text,
  p_contact_name    text,
  p_contact_email   text,
  p_contact_phone   text,
  p_notes           text,
  p_referred_by     text,
  p_referrer_email  text,
  p_consent_version integer,
  p_ip              text,
  p_captcha_passed  boolean default false,
  p_employee_count  text default null
)
returns table (id uuid, ref text, org_name text, logo_url text, primary_color text)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_link    referral_form_links;
  v_org     organizations;
  v_company text := btrim(coalesce(p_company, ''));
  v_contact text := btrim(coalesce(p_contact_name, ''));
  v_email   text := lower(btrim(coalesce(p_contact_email, '')));
  v_phone   text := btrim(coalesce(p_contact_phone, ''));
  v_notes   text := btrim(coalesce(p_notes, ''));
  v_by      text := nullif(btrim(coalesce(p_referred_by, '')), '');
  v_ref_em  text := nullif(lower(btrim(coalesce(p_referrer_email, ''))), '');
  v_ip      text := left(nullif(btrim(coalesce(p_ip, '')), ''), 64);
  v_passed  boolean := coalesce(p_captcha_passed, false);
  v_size    text := nullif(btrim(coalesce(p_employee_count, '')), '');
  v_link_n  integer;
  v_ip_n    integer := 0;
  v_id      uuid;
begin
  select l.* into v_link from referral_form_links l where l.id = public._portal_public_link(p_slug, p_token);
  if v_link.id is null then
    return;
  end if;
  select o.* into v_org from organizations o where o.id = v_link.org_id;

  if p_consent_version is distinct from v_org.consent_version then
    raise exception 'consent_changed' using errcode = 'P0001';
  end if;
  if v_company = '' or length(v_company) > 160 then
    raise exception 'invalid_input:companyName' using errcode = '22023';
  end if;
  if v_contact = '' or length(v_contact) > 120 then
    raise exception 'invalid_input:contactName' using errcode = '22023';
  end if;
  if v_email = '' or length(v_email) > 254 or position('@' in v_email) < 2 then
    raise exception 'invalid_input:email' using errcode = '22023';
  end if;
  if v_phone = '' or length(v_phone) > 40 or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7 then
    raise exception 'invalid_input:phone' using errcode = '22023';
  end if;
  if v_notes = '' or length(v_notes) > 4000 then
    raise exception 'invalid_input:notes' using errcode = '22023';
  end if;
  if v_by is not null and length(v_by) > 160 then
    raise exception 'invalid_input:referredBy' using errcode = '22023';
  end if;
  if v_ref_em is not null and (length(v_ref_em) > 254 or position('@' in v_ref_em) < 2) then
    raise exception 'invalid_input:referrerEmail' using errcode = '22023';
  end if;
  if v_size is not null and v_size not in ('1-10','11-50','51-200','201+') then
    raise exception 'invalid_input:employeeCount' using errcode = '22023';
  end if;

  -- R6 server-keyed hard caps that do not trust any client header: 50 per link and
  -- 200 per org per hour, serialized (link, org, then IP: always this order).
  perform pg_advisory_xact_lock(hashtextextended('portal_public_link:' || v_link.id::text, 0));
  select count(*)::integer into v_link_n from referral_form_submissions s
   where s.form_link_id = v_link.id and s.submitted_at > now() - interval '1 hour';
  if v_link_n >= 50 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('portal_public_org:' || v_org.id::text, 0));
  if (select count(*) from referral_form_submissions s
       where s.org_id = v_org.id and s.submitted_at > now() - interval '1 hour') >= 200 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if v_ip is not null then
    perform pg_advisory_xact_lock(hashtextextended('portal_public_ip:' || v_ip, 0));
    select count(*)::integer into v_ip_n from referral_form_submissions s
     where s.submitter_ip = v_ip and s.submitted_at > now() - interval '1 hour';
    if v_ip_n >= 30 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;

  -- Soft limits, still under the locks: the edge's pre-check alone could be raced
  -- by a parallel burst. A missing IP counts as over the per-IP limit (R3).
  if not v_passed and (v_link_n >= 10 or v_ip is null or v_ip_n >= 5) then
    raise exception 'captcha_required' using errcode = 'P0001';
  end if;

  insert into referral_form_submissions (
    org_id, form_link_id, link_type, assigned_user_id, company_name, contact_name,
    contact_email, contact_phone, notes, referred_by_text, referrer_email, consent_version,
    consent_text_snapshot, submitter_ip, employee_count_range
  ) values (
    v_org.id, v_link.id, v_link.link_type,
    case when v_link.link_type = 'user' then public.referral_route_user(v_link.user_id) end,
    v_company, v_contact, v_email, v_phone, v_notes, v_by, v_ref_em, v_org.consent_version,
    public._portal_consent_text(v_org.consent_text), v_ip, v_size
  ) returning referral_form_submissions.id into v_id;

  -- No IP on the audit row: it lives only on the submission, where the 2B-2 purge erases it.
  perform public._portal_audit(v_org.id, null, 'public_submit', null, null);

  return query
    select v_id, public._portal_referral_ref(v_id), o.name, b.logo_url, b.primary_color
      from organizations o
      left join org_branding b on b.org_id = o.id
     where o.id = v_org.id;
end $$;

revoke execute on function public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean, text) from public, anon, authenticated;
grant  execute on function public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean, text) to service_role;

-- 5. Carry the size onto the deal: accepting a referral ----------------------------------
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
      source_partner_id, employee_count_range
    ) values (
      r.org_id, v_owner, r.company_name, r.address, r.industry,
      coalesce(r.contact_name, r.company_name), r.contact_email, coalesce(r.contact_phone, ''),
      null, 'new', 'partner_referral', r.place_id, r.id, r.partner_id, r.employee_count_range
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

-- 6. Accepting a form submission with no partner ----------------------------------------
create or replace function public.accept_form_submission(p_submission_id uuid)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  s      referral_form_submissions := public._form_submission_for_update(p_submission_id);
  v_deal uuid;
  v_day  date;
begin
  insert into deals (
    org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents, stage, lead_source,
    employee_count_range
  ) values (
    s.org_id, auth.uid(), s.company_name, coalesce(s.contact_name, s.company_name), s.contact_email,
    coalesce(s.contact_phone, ''), null, 'new', 'referral_form', s.employee_count_range
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

-- 7. Attributing a form submission to a partner copies the size onto the referral -------
create or replace function public.attribute_form_submission(p_submission_id uuid, p_partner_id uuid)
returns table (referral_id uuid, duplicate_of_referral_id uuid, duplicate_of_deal_id uuid,
               assigned_user_id uuid, assigned_user_name text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  s          referral_form_submissions := public._form_submission_for_update(p_submission_id);
  v_company  text;
  v_id       uuid;
  v_dup_ref  uuid;
  v_dup_deal uuid;
  v_assignee uuid := auth.uid();
  v_ref      referrals;
  v_name     text;
begin
  select p.company into v_company from partners p where p.id = p_partner_id and p.org_id = s.org_id;
  if not found or not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  -- Company link: the partner's rep reviews it (FR-PORT-51). A reassigned
  -- company-link submission still routes by link_type, on purpose.
  if s.link_type = 'tenant' then
    v_assignee := coalesce(public.referral_route_assignee(p_partner_id), auth.uid());
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
    consent_text_version, consent_text_snapshot, duplicate_of_referral_id, duplicate_of_deal_id,
    employee_count_range
  ) values (
    s.org_id, p_partner_id, 'inbound', 'portal_public', 'submitted', s.company_name, s.contact_name,
    s.contact_email, s.contact_phone, coalesce(s.notes, ''), v_company, v_assignee, s.submitted_at,
    s.consent_version::text, s.consent_text_snapshot, v_dup_ref, v_dup_deal,
    s.employee_count_range
  ) returning * into v_ref;
  v_id := v_ref.id;
  perform public._referral_set_note('');
  perform public._form_submission_close(s.id, 'attributed', v_id, null);
  -- The insert trigger emails only signed-in portal referrals, so tell the rep
  -- it was routed to. Email never blocks the attribution.
  if v_assignee is distinct from auth.uid() then
    begin
      perform public._portal_enqueue_new_referral(v_ref);
    exception when others then
      raise warning 'attribute_form_submission new-referral email skipped: % %', SQLSTATE, SQLERRM;
    end;
  end if;
  select coalesce(nullif(btrim(pr.full_name), ''), pr.email) into v_name from profiles pr where pr.id = v_assignee;
  return query select v_id, v_dup_ref, v_dup_deal, v_assignee, v_name;
end $$;
