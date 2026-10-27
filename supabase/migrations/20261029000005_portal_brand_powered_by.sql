-- 20261029000005_portal_brand_powered_by.sql
--
-- Partner Portal audit fixes (FR-PORT-82, Q16): a white-label switch that hides
-- "Powered by navigatr" in partner-facing emails. The switch is the existing
-- org_branding.show_powered_by column (not null, default true); no new column.
-- An org without a branding row keeps the line (true).
--
-- Every function that hands the edge functions a brand row grows one trailing
-- column, show_powered_by: portal_brand (the invite email), portal_issue_code
-- (the sign-in code email) and portal_public_submit (the public form
-- confirmation). The weekly summary and the other partner emails read the
-- column directly in portal_notify. A return type change needs a drop and a
-- recreate, so each privilege list is restated exactly. Bodies are the latest
-- definitions (20261009000003, 20261014000005, 20261028000004) with only the
-- new column added.

-- 1. portal_brand ----------------------------------------------------------------
drop function if exists public.portal_brand(text);

create function public.portal_brand(p_slug text)
returns table (org_name text, product_name text, primary_color text, logo_url text, dark_logo_url text, show_powered_by boolean)
language sql stable security definer set search_path = public, extensions as $$
  select o.name, coalesce(b.product_name, 'navigatr'), b.primary_color, b.logo_url, b.dark_logo_url,
         coalesce(b.show_powered_by, true)
    from organizations o
    left join org_branding b on b.org_id = o.id
   where o.slug = lower(btrim(coalesce(p_slug, '')))
     and o.portal_enabled and not o.is_disabled
$$;

revoke execute on function public.portal_brand(text) from public, anon, authenticated;
grant  execute on function public.portal_brand(text) to service_role;

-- 2. portal_issue_code -----------------------------------------------------------
drop function if exists public.portal_issue_code(text, text, text);

create function public.portal_issue_code(p_slug text, p_email text, p_ip text)
returns table (code text, recipient text, org_name text, org_slug text, logo_url text, primary_color text, show_powered_by boolean)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_org   organizations;
  v_user  portal_users;
  v_ip    text := nullif(btrim(coalesce(p_ip, '')), '');
  v_bytes bytea;
  v_code  text;
begin
  select * into v_org from organizations o
   where o.slug = lower(btrim(coalesce(p_slug, ''))) and o.portal_enabled and not o.is_disabled;
  if v_org.id is null then
    return;
  end if;

  select * into v_user from portal_users u
   where u.org_id = v_org.id and lower(u.email) = lower(btrim(coalesce(p_email, '')))
     for update;
  -- Both limits are count-then-insert, so they must be serialized or parallel
  -- requests all pass the check. The row lock above serializes issuance per
  -- user; the advisory lock below serializes the per-IP bucket. A missing IP
  -- has no bucket, so only the per-user limits apply to it.
  if v_ip is not null then
    perform pg_advisory_xact_lock(hashtextextended('portal_code_ip:' || v_ip, 0));
  end if;

  -- Every request counts toward the per-IP limit, whether or not the email exists.
  perform public._portal_audit(v_org.id, v_user.id, 'code_request', v_ip, null);
  if v_ip is not null and (select count(*) from portal_audit_log a
       where a.action = 'code_request' and a.ip = v_ip
         and a.created_at > now() - interval '1 hour') > 20 then
    return;
  end if;

  if v_user.id is null or v_user.status <> 'active' then
    return;
  end if;
  if (select count(*) from portal_tokens t
       where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
         and t.issued_at > now() - interval '1 hour') >= 5 then
    return;
  end if;
  -- Phase 1B: a daily ceiling as well, so a slow drip cannot mail a partner all day.
  if (select count(*) from portal_tokens t
       where t.portal_user_id = v_user.id and t.token_type = 'sign_in_code'
         and t.issued_at > now() - interval '24 hours') >= 20 then
    return;
  end if;

  -- Parenthesized: in Postgres << and | share one precedence level.
  v_bytes := extensions.gen_random_bytes(3);
  v_code  := lpad(
    (((get_byte(v_bytes, 0) << 16) | (get_byte(v_bytes, 1) << 8) | get_byte(v_bytes, 2)) % 1000000)::text,
    6, '0');

  insert into portal_tokens (org_id, portal_user_id, token_type, token_hash, expires_at, ip)
  values (v_org.id, v_user.id, 'sign_in_code', public._portal_hash(v_code || ':' || v_user.id::text),
          now() + interval '15 minutes', v_ip);

  -- Phase 1C: the brand for the email (null without a branding row).
  return query
    select v_code, v_user.email, v_org.name, v_org.slug, b.logo_url, b.primary_color,
           coalesce(b.show_powered_by, true)
      from (select v_org.id as org_id) x
      left join org_branding b on b.org_id = x.org_id;
end $$;

revoke execute on function public.portal_issue_code(text, text, text) from public, anon, authenticated;
grant  execute on function public.portal_issue_code(text, text, text) to service_role;

-- 3. portal_public_submit --------------------------------------------------------
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
  p_employee_count  text default null
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
    select v_id, public._portal_referral_ref(v_id), o.name, b.logo_url, b.primary_color,
           coalesce(b.show_powered_by, true)
      from organizations o
      left join org_branding b on b.org_id = o.id
     where o.id = v_org.id;
end $$;

revoke execute on function public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean, text) from public, anon, authenticated;
grant  execute on function public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean, text) to service_role;
