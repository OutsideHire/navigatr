-- 20261012000003_portal_referral_submit.sql
--
-- Partner Portal Phase 1B (spec 5.5, FR-PORT-35..50): a signed-in partner
-- submits a referral. The soft duplicate check and the attribution flags run
-- with the PARTNER OWNER's visibility (profile_can_see_owner), never org-wide,
-- and reuse the deal normalizers (deal_phone_key, deal_dedupe_key,
-- deal_name_key). Email is not part of the match (spec R8).
--
-- Service role only (portal_api). Every function takes the org, partner and
-- portal user that portal_session_lookup returned; portal_api never takes them
-- from a request.

-- 1. Urgency (spec 4.1 has no column for it) ------------------------------------
alter table referrals add column if not exists urgency text
  check (urgency is null or urgency in ('this_week','this_month','no_rush'));

create index if not exists referrals_portal_user_submitted_idx
  on referrals (submitted_by_portal_user_id, submitted_at)
  where submitted_by_portal_user_id is not null;

-- 2. History records partner actors ----------------------------------------------
-- Writers set navigatr.referral_actor to 'partner' (with navigatr.referral_actor_id
-- = the portal user id) or 'system'; anything else is the signed-in user.
create or replace function public.referrals_record_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor    text := nullif(current_setting('navigatr.referral_actor', true), '');
  v_actor_id text := nullif(current_setting('navigatr.referral_actor_id', true), '');
  v_note     text := nullif(current_setting('navigatr.referral_note', true), '');
  v_type     referral_actor_type;
  v_id       uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  if v_actor = 'partner' then
    v_type := 'partner';
    v_id   := v_actor_id::uuid;
  elsif v_actor = 'system' or auth.uid() is null then
    v_type := 'system';
    v_id   := null;
  else
    v_type := 'user';
    v_id   := auth.uid();
  end if;
  insert into referral_status_history (org_id, referral_id, from_status, to_status, actor_type, actor_id, note)
  values (
    new.org_id,
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    v_type,
    v_id,
    v_note
  );
  return new;
end $$;

revoke execute on function public.referrals_record_status() from public, anon, authenticated;

-- 3. Private helpers --------------------------------------------------------------

-- The session's portal user must still be active, belong to this org and this
-- partner, and the portal must still be on. Raises instead of returning, so a
-- caller can never forget to check.
create or replace function public._portal_assert_scope(p_org uuid, p_partner uuid, p_portal_user uuid)
returns void language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not exists (
    select 1
      from portal_users u
      join organizations o on o.id = u.org_id
     where u.id = p_portal_user and u.org_id = p_org and u.partner_id = p_partner
       and u.status = 'active' and o.portal_enabled and not o.is_disabled
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
end $$;

-- _portal_audit (1A) has no referral column; this one does.
create or replace function public._portal_audit_referral(
  p_org uuid, p_portal_user uuid, p_action portal_audit_action, p_referral uuid, p_ip text
) returns void language sql security definer set search_path = public, extensions as $$
  insert into portal_audit_log (org_id, portal_user_id, action, referral_id, ip)
  values (p_org, p_portal_user, p_action, p_referral, nullif(btrim(coalesce(p_ip, '')), ''))
$$;

-- Short human reference (brief D5): REF- plus the first 8 hex digits, uppercase.
create or replace function public._portal_referral_ref(p_id uuid)
returns text language sql immutable security definer set search_path = public, extensions as $$
  select 'REF-' || upper(left(p_id::text, 8))
$$;

-- Earliest probable match among live referrals and active deals the partner's
-- OWNER can see (FR-PORT-45/50). A match is the same phone key, the same
-- name+address key, or the same name key when either side has no address.
-- Referrals: the same partner's, or any partner the owner can see. Declined
-- and withdrawn referrals never take credit (FR-PORT-46). Always one row.
create or replace function public._portal_find_duplicates(
  p_org uuid, p_partner uuid, p_name text, p_phone text, p_address text, p_exclude uuid
)
returns table (dup_referral_id uuid, dup_deal_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  with viewer as (
    select p.owner_id from partners p where p.id = p_partner and p.org_id = p_org
  ),
  k as (
    select public.deal_phone_key(p_phone)            as phone_key,
           public.deal_dedupe_key(p_name, p_address) as na_key,
           public.deal_name_key(p_name)              as name_key
  )
  select
    (select r.id
       from referrals r
       join partners rp on rp.id = r.partner_id
       cross join k
      where r.org_id = p_org
        and r.direction = 'inbound'
        and r.status not in ('declined','withdrawn')
        and r.id is distinct from p_exclude
        and (r.partner_id = p_partner
             or public.profile_can_see_owner((select v.owner_id from viewer v), rp.owner_id))
        and (
          (k.phone_key is not null and public.deal_phone_key(r.contact_phone) = k.phone_key)
          or (k.na_key is not null and public.deal_dedupe_key(r.company_name, r.address) = k.na_key)
          or (k.name_key is not null
              and (k.na_key is null or public.deal_dedupe_key(r.company_name, r.address) is null)
              and public.deal_name_key(r.company_name) = k.name_key)
        )
      order by r.submitted_at, r.id
      limit 1),
    (select d.id
       from deals d
       cross join k
      where d.org_id = p_org
        and d.stage not in ('won','lost')
        and public.profile_can_see_owner((select v.owner_id from viewer v), d.owner_id)
        and (
          (k.phone_key is not null and public.deal_phone_key(d.contact_phone) = k.phone_key)
          or (k.na_key is not null and d.dedupe_key = k.na_key)
          or (k.name_key is not null
              and (k.na_key is null or d.dedupe_key is null)
              and public.deal_name_key(d.company_name) = k.name_key)
        )
      order by d.created_at, d.id
      limit 1)
$$;

-- 4. Form context ----------------------------------------------------------------
create or replace function public.portal_form_context(p_org uuid, p_partner uuid)
returns table (consent_text text, consent_version integer)
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(nullif(btrim(o.consent_text), ''),
                  'I have permission to share this business''s contact details.'),
         o.consent_version
    from organizations o
    join partners p on p.org_id = o.id and p.id = p_partner
   where o.id = p_org and o.portal_enabled and not o.is_disabled
$$;

-- 5. Soft duplicate check (FR-PORT-38) -------------------------------------------
-- Answers only yes or no. The partner never learns which rep, stage, value, or
-- that another partner sent it.
create or replace function public.portal_dup_check(
  p_org uuid, p_partner uuid, p_portal_user uuid, p_name text, p_phone text, p_address text, p_ip text
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_ref  uuid;
  v_deal uuid;
begin
  perform public._portal_assert_scope(p_org, p_partner, p_portal_user);
  -- Count-then-insert: serialize per portal user.
  perform pg_advisory_xact_lock(hashtextextended('portal_dup:' || p_portal_user::text, 0));
  if (select count(*) from portal_audit_log a
       where a.portal_user_id = p_portal_user and a.action = 'dup_check'
         and a.created_at > now() - interval '1 hour') >= 120 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  perform public._portal_audit_referral(p_org, p_portal_user, 'dup_check', null, p_ip);

  if btrim(coalesce(p_name, '')) = '' then
    return false;
  end if;
  select f.dup_referral_id, f.dup_deal_id into v_ref, v_deal
    from public._portal_find_duplicates(
      p_org, p_partner, btrim(p_name),
      nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_address, '')), ''), null) f;
  return v_ref is not null or v_deal is not null;
end $$;

-- 6. Submit (FR-PORT-35..43, 46..49) ----------------------------------------------
create or replace function public.portal_submit_referral(
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
  p_ip              text
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
    contact_email, contact_phone, address, industry, urgency, notes,
    partner_company_snapshot, assigned_user_id, submitted_by_portal_user_id,
    duplicate_of_referral_id, duplicate_of_deal_id, consent_text_version
  ) values (
    p_org, p_partner, 'inbound', 'portal_signed_in', 'submitted', v_company, v_contact,
    v_email, v_phone, v_address, v_industry, v_urgency, v_notes,
    v_partner.company, public.referral_route_assignee(p_partner), p_portal_user,
    v_dup_ref, v_dup_deal, v_org.consent_version::text
  ) returning referrals.id into v_id;
  perform set_config('navigatr.referral_actor', '', true);
  perform set_config('navigatr.referral_actor_id', '', true);

  perform public._portal_audit_referral(p_org, p_portal_user, 'submit', v_id, p_ip);

  return query select v_id, public._portal_referral_ref(v_id);
end $$;

-- 7. Privileges ------------------------------------------------------------------
revoke execute on function public._portal_assert_scope(uuid, uuid, uuid)                           from public, anon, authenticated, service_role;
revoke execute on function public._portal_audit_referral(uuid, uuid, portal_audit_action, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public._portal_referral_ref(uuid)                                        from public, anon, authenticated, service_role;
revoke execute on function public._portal_find_duplicates(uuid, uuid, text, text, text, uuid)       from public, anon, authenticated, service_role;

revoke execute on function public.portal_form_context(uuid, uuid)                                   from public, anon, authenticated;
revoke execute on function public.portal_dup_check(uuid, uuid, uuid, text, text, text, text)        from public, anon, authenticated;
revoke execute on function public.portal_submit_referral(uuid, uuid, uuid, text, text, text, text, text, text, text, text, boolean, integer, text) from public, anon, authenticated;
grant  execute on function public.portal_form_context(uuid, uuid)                                   to service_role;
grant  execute on function public.portal_dup_check(uuid, uuid, uuid, text, text, text, text)        to service_role;
grant  execute on function public.portal_submit_referral(uuid, uuid, uuid, text, text, text, text, text, text, text, text, boolean, integer, text) to service_role;
