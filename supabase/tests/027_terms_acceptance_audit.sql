-- Tests for migration 20260826000004_terms_acceptance_audit.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/027_terms_acceptance_audit.sql
--
-- Self-cleans via ROLLBACK. Verifies the consent audit trigger:
--   1. a REAL profile insert records exactly one terms_acceptances row with the
--      current document versions, the user's id/org/email;
--   2. a profile inserted under session_replication_role = replica (how demo
--      users are seeded) records NOTHING -- synthetic users get no false consent;
--   3. the email falls back to auth.users.email when the profile row omits it;
--   4. authenticated cannot write the table directly (append-only via trigger).

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000fa', 'Consent Org', 'consent-org', 'consent-code');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('fa000000-0000-0000-0000-000000000001', 'realuser@t.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('fa000000-0000-0000-0000-000000000002', 'demouser@t.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('fa000000-0000-0000-0000-000000000003', 'noemailrow@t.example', 'authenticated', 'authenticated', now(), now(), now());

-- ── 1) A real profile insert records one row with the current versions. ──
do $$
declare
  n int;
  v_terms text; v_privacy text; v_email text; v_org uuid;
begin
  insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
    ('fa000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000fa', 'admin', 'administrator', 'Real User', 'realuser@t.example', 'realuser'::ltree);

  select count(*) into n from terms_acceptances where user_id = 'fa000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'expected exactly 1 acceptance row for the real user, got %', n; end if;

  select terms_version, privacy_version, email, org_id
    into v_terms, v_privacy, v_email, v_org
    from terms_acceptances where user_id = 'fa000000-0000-0000-0000-000000000001';
  if v_terms   is distinct from public.current_terms_version()   then raise exception 'terms_version mismatch: %', v_terms; end if;
  if v_privacy is distinct from public.current_privacy_version() then raise exception 'privacy_version mismatch: %', v_privacy; end if;
  if v_email   is distinct from 'realuser@t.example'             then raise exception 'email mismatch: %', v_email; end if;
  if v_org     is distinct from '00000000-0000-0000-0000-0000000000fa'::uuid then raise exception 'org_id mismatch: %', v_org; end if;
end $$;

-- ── 2) A profile seeded in replica mode (demo path) records NOTHING. ──
do $$
declare n int;
begin
  set local session_replication_role = replica;
  insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
    ('fa000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000fa', 'rep', 'sales_professional', 'Demo User', 'demouser@t.example', 'realuser.demo'::ltree);
  set local session_replication_role = origin;

  select count(*) into n from terms_acceptances where user_id = 'fa000000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'replica-mode (demo) insert must NOT record consent, got % rows', n; end if;
end $$;

-- ── 3) email falls back to auth.users.email when the profile omits it. ──
do $$
declare v_email text;
begin
  insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
    ('fa000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000fa', 'rep', 'sales_professional', 'No Email Row', null, 'realuser.noemail'::ltree);

  select email into v_email from terms_acceptances where user_id = 'fa000000-0000-0000-0000-000000000003';
  if v_email is distinct from 'noemailrow@t.example' then
    raise exception 'expected email fallback to auth.users.email, got %', v_email;
  end if;
end $$;

-- ── 4) authenticated cannot write the audit table directly. ──
do $$
begin
  if has_table_privilege('authenticated', 'public.terms_acceptances', 'INSERT') then
    raise exception 'authenticated must NOT have INSERT on terms_acceptances (append-only via trigger)';
  end if;
  if has_table_privilege('authenticated', 'public.terms_acceptances', 'UPDATE') then
    raise exception 'authenticated must NOT have UPDATE on terms_acceptances';
  end if;
  if has_table_privilege('authenticated', 'public.terms_acceptances', 'DELETE') then
    raise exception 'authenticated must NOT have DELETE on terms_acceptances';
  end if;
end $$;

rollback;
