-- 20261101000001_public_form_navigatr_terms.sql
--
-- The public referral form (the no-account form reached from a QR code or link)
-- now shows navigatr's own "Navigatr Referral Portal Terms" under the ISO's
-- consent box: "By sending, you agree to the Navigatr Referral Portal Terms."
-- No second checkbox. The text and its version live in code
-- (supabase/functions/_shared/portalNavigatrTerms.ts); this migration only
-- records which navigatr version each submission was made under. The edge
-- passes its own constant, never a client value.
--
--   referral_form_submissions.navigatr_terms_version  new, nullable. Null means
--                          the submission predates this change (or came through
--                          the old edge during a deploy).
--   portal_public_submit   gains p_navigatr_terms_version text default null as
--                          its LAST argument and stores nullif(btrim(...), '').
--                          Body copied from 20261029000005_portal_brand_powered_by.sql
--                          (its latest definition); nothing else changes.
--
-- Deploy skew: the new parameter is LAST and defaults to null, so the edge still
-- running between `db push` and the functions deploy (which calls with the old
-- named arguments) keeps working and stores null.

-- 1. The navigatr terms version a submission was made under ------------------------
alter table referral_form_submissions add column if not exists navigatr_terms_version text;

-- 2. portal_public_submit records it ---------------------------------------------------
-- destructive-ok: function signature change only (no table or column is dropped); recreated immediately below with the same service-role-only grants.
drop function if exists public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean, text);

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
  p_employee_count  text default null,
  p_navigatr_terms_version text default null
)
returns table (id uuid, ref text, org_name text, logo_url text, primary_color text, show_powered_by boolean)
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
  v_nterms  text := nullif(btrim(coalesce(p_navigatr_terms_version, '')), '');
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
    consent_text_snapshot, submitter_ip, employee_count_range, navigatr_terms_version
  ) values (
    v_org.id, v_link.id, v_link.link_type,
    case when v_link.link_type = 'user' then public.referral_route_user(v_link.user_id) end,
    v_company, v_contact, v_email, v_phone, v_notes, v_by, v_ref_em, v_org.consent_version,
    public._portal_consent_text(v_org.consent_text), v_ip, v_size, v_nterms
  ) returning referral_form_submissions.id into v_id;

  -- No IP on the audit row: it lives only on the submission, where the 2B-2 purge erases it.
  perform public._portal_audit(v_org.id, null, 'public_submit', null, null);

  return query
    select v_id, public._portal_referral_ref(v_id), o.name, b.logo_url, b.primary_color,
           coalesce(b.show_powered_by, true)
      from organizations o
      left join org_branding b on b.org_id = o.id
     where o.id = v_org.id;
end $$;

revoke execute on function public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean, text, text) from public, anon, authenticated;
grant  execute on function public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean, text, text) to service_role;
