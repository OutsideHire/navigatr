-- 20261018000003_public_form_submissions.sql
--
-- Partner Portal Phase 2B-1 (PRD FR-PORT-25, 26, 29..31, 33, 34). Public
-- referral form submissions are stored here, NOT in referrals: a referral
-- always has a partner (partner_id not null, the org trigger and RLS all
-- assume one). Phase 2B-2 triages a submission (attribution, then accept,
-- decline or merge) and fills triaged_*, outcome, referral_id or deal_id.
--
-- No duplicate check of any kind happens here (FR-PORT-34): nothing a public
-- caller gets back depends on what the tenant already has.
--
-- Service role only (portal_api): portal_public_form, portal_public_submit,
-- portal_public_rate. Internal users read through RLS (2B-2 builds the queue).

-- 1. Submissions -----------------------------------------------------------------
create table referral_form_submissions (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  -- Null only after a deleted account cascaded its links away; link_type keeps
  -- which kind of link it came through.
  form_link_id          uuid references referral_form_links(id) on delete set null,
  link_type             text not null check (link_type in ('tenant','user')),
  assigned_user_id      uuid references profiles(id) on delete set null,
  company_name          text not null check (char_length(company_name) between 1 and 160),
  -- Required at intake (portal_public_submit); nullable so the 2B-2 purge can erase them.
  contact_name          text check (contact_name is null or char_length(contact_name) <= 120),
  contact_email         text check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone         text check (contact_phone is null or char_length(contact_phone) <= 40),
  notes                 text check (notes is null or char_length(notes) <= 4000),
  referred_by_text      text check (referred_by_text is null or char_length(referred_by_text) <= 160),
  -- Optional: the sender's own email, the only address the confirmation goes to
  -- (FR-PORT-33). Personal data: the 2B-2 purge erases it with the contact fields.
  referrer_email        text check (referrer_email is null or char_length(referrer_email) <= 254),
  -- NFR-PORT-07: the consent wording and version the submitter agreed to.
  consent_version       integer not null,
  consent_text_snapshot text,
  submitter_ip          text check (submitter_ip is null or char_length(submitter_ip) <= 64),
  submitted_at          timestamptz not null default now(),
  triaged_at            timestamptz,
  triaged_by            uuid references profiles(id) on delete set null,
  outcome               text check (outcome is null or outcome in ('accepted','declined','merged')),
  referral_id           uuid references referrals(id) on delete set null,
  deal_id               uuid references deals(id) on delete set null,
  purged_at             timestamptz
);
create index referral_form_submissions_org_idx
  on referral_form_submissions (org_id, submitted_at desc);
create index referral_form_submissions_open_idx
  on referral_form_submissions (org_id, assigned_user_id) where triaged_at is null;
-- portal_public_rate and the hard limit in portal_public_submit (FR-PORT-30).
create index referral_form_submissions_ip_idx
  on referral_form_submissions (submitter_ip, submitted_at) where submitter_ip is not null;

alter table referral_form_submissions enable row level security;
revoke all on referral_form_submissions from anon, authenticated;
-- Everything but the submitter's IP address.
grant select (
  id, org_id, form_link_id, link_type, assigned_user_id, company_name, contact_name,
  contact_email, contact_phone, notes, referred_by_text, referrer_email, consent_version, consent_text_snapshot,
  submitted_at, triaged_at, triaged_by, outcome, referral_id, deal_id, purged_at
) on referral_form_submissions to authenticated;

-- The referral triage rule (can_triage_referral, 20261007000001) inlined:
-- the assignee and everyone above them, or the administrator queue for
-- administrators. can_triage_referral itself is not executable by authenticated.
create policy referral_form_submissions_select on referral_form_submissions for select to authenticated using (
  org_id = public.user_org_id()
  and (
    (assigned_user_id is null and public.caller_is_admin())
    or (assigned_user_id is not null and public.user_can_see_owner(assigned_user_id))
  )
);

-- 2. Which link is this? ----------------------------------------------------------------
-- One answer for every "not available" case (unknown org, portal or public form
-- off, disabled org, unknown or retired token, a user link whose user is not in
-- the org), so a caller cannot tell them apart. Tokens are case-sensitive.
create or replace function public._portal_public_link(p_slug text, p_token text)
returns uuid language sql stable security definer set search_path = public, extensions as $$
  select l.id
    from referral_form_links l
    join organizations o on o.id = l.org_id
    left join profiles pr on pr.id = l.user_id
   where o.slug = lower(btrim(coalesce(p_slug, '')))
     and l.token = btrim(coalesce(p_token, ''))
     and l.retired_at is null
     and public._referral_form_open(o.id)
     and (l.link_type = 'tenant' or pr.org_id = l.org_id)
$$;

-- 3. What the form shows (FR-PORT-25) ---------------------------------------------------
-- The rep's name only when the link routes to that rep; a deactivated or
-- unplaced rep's link still works but routes to the manager or the queue.
create or replace function public.portal_public_form(p_slug text, p_token text)
returns table (org_name text, rep_name text, consent_text text, consent_version integer)
language sql stable security definer set search_path = public, extensions as $$
  select o.name,
         case when l.link_type = 'user' and public.referral_route_user(l.user_id) = l.user_id
              then nullif(btrim(coalesce(pr.full_name, '')), '') end,
         public._portal_consent_text(o.consent_text),
         o.consent_version
    from referral_form_links l
    join organizations o on o.id = l.org_id
    left join profiles pr on pr.id = l.user_id
   where l.id = public._portal_public_link(p_slug, p_token)
$$;

-- 4. Per-IP count across every tenant (FR-PORT-30) --------------------------------------
create or replace function public.portal_public_rate(p_ip text, p_window_minutes integer)
returns integer language sql stable security definer set search_path = public, extensions as $$
  select case
    when nullif(btrim(coalesce(p_ip, '')), '') is null then 0
    else (select count(*)::integer
            from referral_form_submissions s
           where s.submitter_ip = btrim(p_ip)
             and s.submitted_at > now() - make_interval(mins => greatest(coalesce(p_window_minutes, 60), 1)))
  end
$$;

-- 5. Store a submission (FR-PORT-25, 26, 29, 31) ------------------------------------------
-- Zero rows when the link is not available. Field rules mirror
-- _shared/portalPublicForm.ts. The hard limit of 30 per IP per hour is checked
-- here, serialized per IP, so parallel posts cannot race past it.
create or replace function public.portal_public_submit(
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
  p_ip              text
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

  if v_ip is not null then
    perform pg_advisory_xact_lock(hashtextextended('portal_public_ip:' || v_ip, 0));
    if (select count(*) from referral_form_submissions s
         where s.submitter_ip = v_ip and s.submitted_at > now() - interval '1 hour') >= 30 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;

  insert into referral_form_submissions (
    org_id, form_link_id, link_type, assigned_user_id, company_name, contact_name,
    contact_email, contact_phone, notes, referred_by_text, referrer_email, consent_version,
    consent_text_snapshot, submitter_ip
  ) values (
    v_org.id, v_link.id, v_link.link_type,
    case when v_link.link_type = 'user' then public.referral_route_user(v_link.user_id) end,
    v_company, v_contact, v_email, v_phone, v_notes, v_by, v_ref_em, v_org.consent_version,
    public._portal_consent_text(v_org.consent_text), v_ip
  ) returning referral_form_submissions.id into v_id;

  perform public._portal_audit(v_org.id, null, 'public_submit', v_ip, null);

  return query
    select v_id, public._portal_referral_ref(v_id), o.name, b.logo_url, b.primary_color
      from organizations o
      left join org_branding b on b.org_id = o.id
     where o.id = v_org.id;
end $$;

-- 6. Privileges ----------------------------------------------------------------------------
revoke execute on function public._portal_public_link(text, text) from public, anon, authenticated, service_role;

revoke execute on function public.portal_public_form(text, text) from public, anon, authenticated;
revoke execute on function public.portal_public_rate(text, integer) from public, anon, authenticated;
revoke execute on function public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text) from public, anon, authenticated;
grant  execute on function public.portal_public_form(text, text) to service_role;
grant  execute on function public.portal_public_rate(text, integer) to service_role;
grant  execute on function public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text) to service_role;
