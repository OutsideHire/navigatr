-- Tests for 20261101000001_public_form_navigatr_terms: the public referral form
-- shows navigatr's Referral Portal Terms, and each submission records which
-- navigatr terms version it was made under.
--   psql "$SUPABASE_DB_URL" -f supabase/tests/080_public_form_navigatr_terms.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- The edge passes its own constant (portalNavigatrTerms.ts); the database only
-- stores what it is given, so nothing here knows which version is current.
--
-- Org F1 pf-nterms: public form on, consent v2, show_powered_by off, one tenant link.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, consent_text, consent_version) values
  ('00000000-0000-0000-0000-000000001080', 'Form Terms Org', 'pf-nterms', 'pf-nterms-a1', true, 'I may share this.', 2);
update organizations set public_form_enabled = true where id = '00000000-0000-0000-0000-000000001080';

insert into org_branding (org_id, product_name, primary_color, show_powered_by) values
  ('00000000-0000-0000-0000-000000001080', 'Form Terms Portal', '#0f766e', false);

insert into referral_form_links (id, org_id, link_type, user_id, token, retired_at) values
  ('a080c000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001080', 'tenant', null, 'formTermsToken000001', null);

-- 1. The column exists and is nullable text.
do $$ begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'referral_form_submissions'
       and column_name = 'navigatr_terms_version' and data_type = 'text' and is_nullable = 'YES'
  ) then
    raise exception 'referral_form_submissions.navigatr_terms_version should be a nullable text column';
  end if;
end $$;

-- 2. A submit stores the version it was given (trimmed); the brand row is unchanged.
do $$ declare r record; v text; begin
  select * into r from public.portal_public_submit(
    p_slug => 'pf-nterms', p_token => 'formTermsToken000001', p_company => 'Terms Co',
    p_contact_name => 'Sam', p_contact_email => 'sam@terms.example', p_contact_phone => '5550800001',
    p_notes => 'Notes.', p_referred_by => null, p_referrer_email => null, p_consent_version => 2,
    p_ip => '198.51.100.80', p_captcha_passed => false, p_employee_count => '11-50',
    p_navigatr_terms_version => '  2026-10-30 ');
  if r.id is null or r.ref is null or r.show_powered_by is distinct from false or r.org_name is distinct from 'Form Terms Org' then
    raise exception 'submit should return the usual row: %', row_to_json(r);
  end if;
  select s.navigatr_terms_version into v from referral_form_submissions s where s.id = r.id;
  if v is distinct from '2026-10-30' then raise exception 'version should be stored trimmed, got %', v; end if;
  if (select employee_count_range from referral_form_submissions where id = r.id) is distinct from '11-50' then
    raise exception 'the rest of the row should be unchanged';
  end if;
end $$;

-- 3. A blank version stores null.
do $$ declare r record; begin
  select * into r from public.portal_public_submit(
    p_slug => 'pf-nterms', p_token => 'formTermsToken000001', p_company => 'Blank Co',
    p_contact_name => 'Bo', p_contact_email => 'bo@terms.example', p_contact_phone => '5550800002',
    p_notes => 'Notes.', p_referred_by => null, p_referrer_email => null, p_consent_version => 2,
    p_ip => '198.51.100.81', p_captcha_passed => false, p_employee_count => null,
    p_navigatr_terms_version => '   ');
  if (select navigatr_terms_version from referral_form_submissions where id = r.id) is not null then
    raise exception 'a blank version should store null';
  end if;
end $$;

-- 4. Deploy skew: the OLD edge's named argument set (no version) still works and stores null.
do $$ declare r record; begin
  select * into r from public.portal_public_submit(
    p_slug => 'pf-nterms', p_token => 'formTermsToken000001', p_company => 'Old Edge Co',
    p_contact_name => 'Oli', p_contact_email => 'oli@terms.example', p_contact_phone => '5550800003',
    p_notes => 'Notes.', p_referred_by => null, p_referrer_email => null, p_consent_version => 2,
    p_ip => '198.51.100.82', p_captcha_passed => false, p_employee_count => null);
  if r.id is null then raise exception 'an old-style named call should still submit'; end if;
  if (select navigatr_terms_version from referral_form_submissions where id = r.id) is not null then
    raise exception 'an old-style call should store a null version';
  end if;
end $$;

-- 5. The consent check is unchanged.
do $$ begin
  begin
    perform public.portal_public_submit(
      p_slug => 'pf-nterms', p_token => 'formTermsToken000001', p_company => 'Stale Co',
      p_contact_name => 'St', p_contact_email => 'st@terms.example', p_contact_phone => '5550800004',
      p_notes => 'Notes.', p_referred_by => null, p_referrer_email => null, p_consent_version => 1,
      p_ip => '198.51.100.83', p_captcha_passed => false, p_employee_count => null,
      p_navigatr_terms_version => '2026-10-30');
    raise exception 'a stale consent version should be refused';
  exception when others then
    if sqlerrm <> 'consent_changed' then raise; end if;
  end;
end $$;

-- 6. Privileges: service_role only, and the old signature is gone.
do $$ declare f text := 'public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean, text, text)'; begin
  if to_regprocedure(f) is null then raise exception 'the new signature should exist'; end if;
  if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
  if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
  if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  if to_regprocedure('public.portal_public_submit(text, text, text, text, text, text, text, text, text, integer, text, boolean, text)') is not null then
    raise exception 'the old portal_public_submit signature must be dropped';
  end if;
end $$;

rollback;
