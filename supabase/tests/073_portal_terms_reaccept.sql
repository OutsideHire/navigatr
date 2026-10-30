-- Tests for 20261028000005_portal_terms_reaccept (FR-PORT-18, Q13): when an ISO
-- changes its partner terms, a signed-in partner must accept the new version
-- before using the portal.
--   psql "$SUPABASE_DB_URL" -f supabase/tests/073_portal_terms_reaccept.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions),
-- switching to the admin only to edit the terms.
--
-- Fixture:
--   org T1 portal-terms (enabled, terms v1): admin A1
--     U1 Jane CPA   accepted v1
--     U2 Old CPA    joined before terms existed (terms_version null)
--   org T2 portal-noterms (enabled, never set terms, version 0)
--     U3 Zed CPA    terms_version null

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, partner_terms_text, partner_terms_version) values
  ('00000000-0000-0000-0000-000000000731', 'Portal Terms Org', 'portal-terms',   'portal-terms-a1', true, 'Terms one.', 1),
  ('00000000-0000-0000-0000-000000000732', 'No Terms Org',     'portal-noterms', 'portal-terms-b1', true, null,         0);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('73100000-0000-0000-0000-000000000001', 'a@pt1.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('73100000-0000-0000-0000-000000000002', 'b@pt2.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('73100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000731', 'admin', 'administrator', 'A', 'a@pt1.example', 'ta'::ltree),
  ('73100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000732', 'admin', 'administrator', 'B', 'b@pt2.example', 'tb'::ltree);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('731a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000731', '73100000-0000-0000-0000-000000000001', '73100000-0000-0000-0000-000000000001', 'Jane CPA', 'J & Co', 'cpa', 'jane@example.com'),
  ('731a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000731', '73100000-0000-0000-0000-000000000001', '73100000-0000-0000-0000-000000000001', 'Old CPA',  'O & Co', 'cpa', 'old@example.com'),
  ('731a0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000732', '73100000-0000-0000-0000-000000000002', '73100000-0000-0000-0000-000000000002', 'Zed CPA',  'Z & Co', 'cpa', 'zed@example.com');

insert into portal_users (id, org_id, partner_id, email, status, terms_accepted_at, terms_version, terms_ip) values
  ('731b0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000731', '731a0000-0000-0000-0000-000000000001', 'jane@example.com', 'active', now() - interval '3 days', 1, '1.1.1.1'),
  ('731b0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000731', '731a0000-0000-0000-0000-000000000002', 'old@example.com',  'active', null, null, null),
  ('731b0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000732', '731a0000-0000-0000-0000-000000000003', 'zed@example.com',  'active', null, null, null);

create temp table _t (k text primary key, v text) on commit drop;
grant all on _t to authenticated;

do $$ begin
  insert into _t select 'jane', session_token from public._portal_create_session('731b0000-0000-0000-0000-000000000001', '1.1.1.1', 'ua');
  insert into _t select 'old',  session_token from public._portal_create_session('731b0000-0000-0000-0000-000000000002', '1.1.1.1', 'ua');
  insert into _t select 'zed',  session_token from public._portal_create_session('731b0000-0000-0000-0000-000000000003', '1.1.1.1', 'ua');
end $$;

-- Privileges: the new functions are service-role only.
do $$ declare f text; begin
  foreach f in array array[
    'public.portal_session_lookup(text, text)',
    'public.portal_get_terms(text, text)',
    'public.portal_accept_terms(text, text, integer, text, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
end $$;

-- Before any change: the accepted version is current; an org that never set
-- terms blocks nobody; a pre-terms partner whose org now has terms must accept.
do $$ declare r record; begin
  select * into r from public.portal_session_lookup('portal-terms', (select v from _t where k = 'jane'));
  if r.terms_current is distinct from true then raise exception 'accepted v1 should be current, got %', row_to_json(r); end if;
  select * into r from public.portal_session_lookup('portal-noterms', (select v from _t where k = 'zed'));
  if r.terms_current is distinct from true then raise exception 'an org with no terms (v0) must never block, got %', row_to_json(r); end if;
  select * into r from public.portal_session_lookup('portal-terms', (select v from _t where k = 'old'));
  if r.terms_current is distinct from false then raise exception 'a partner with no accepted version must accept v1, got %', row_to_json(r); end if;
end $$;

-- The admin edits the terms (version 1 -> 2).
do $$ declare r record; begin
  perform set_config('request.jwt.claim.sub', '73100000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  select * into r from public.update_portal_settings(true, 'Terms two.', null, false);
  if r.terms_version is distinct from 2 then raise exception 'editing terms should bump to 2, got %', r.terms_version; end if;
end $$;
reset role;

-- The partner's session now reports stale terms, and get_terms serves v2.
do $$ declare v text := (select v from _t where k = 'jane'); r record; n int; begin
  select * into r from public.portal_session_lookup('portal-terms', v);
  if r.portal_user_id is distinct from '731b0000-0000-0000-0000-000000000001' then raise exception 'the session must still resolve'; end if;
  if r.terms_current is distinct from false then raise exception 'after an edit the terms must not be current'; end if;

  select * into r from public.portal_get_terms('portal-terms', v);
  if r.terms_text is distinct from 'Terms two.' or r.terms_version is distinct from 2 or r.terms_current is distinct from false then
    raise exception 'get_terms returned %', row_to_json(r);
  end if;
  select count(*) into n from public.portal_get_terms('portal-noterms', v);
  if n <> 0 then raise exception 'get_terms must not answer for another tenant'; end if;
  select count(*) into n from public.portal_get_terms('portal-terms', 'not-a-session');
  if n <> 0 then raise exception 'get_terms must not answer without a live session'; end if;
end $$;

-- A version race: accepting the version the partner read (1) after it changed fails.
do $$ declare v text := (select v from _t where k = 'jane'); begin
  begin
    perform public.portal_accept_terms('portal-terms', v, 1, '2.2.2.2');
    raise exception 'expected terms_changed';
  exception when others then
    if sqlerrm <> 'terms_changed' then raise exception 'stale version should raise terms_changed, got %', sqlerrm; end if;
  end;
  if (select terms_version from portal_users where id = '731b0000-0000-0000-0000-000000000001') is distinct from 1 then
    raise exception 'a refused accept must not touch the record';
  end if;
end $$;

-- A dead or foreign session cannot accept.
do $$ declare v text := (select v from _t where k = 'jane'); begin
  begin
    perform public.portal_accept_terms('portal-noterms', v, 2, '2.2.2.2');
    raise exception 'expected invalid_session';
  exception when others then
    if sqlerrm <> 'invalid_session' then raise exception 'a foreign tenant should raise invalid_session, got %', sqlerrm; end if;
  end;
  begin
    perform public.portal_accept_terms('portal-terms', 'not-a-session', 2, '2.2.2.2');
    raise exception 'expected invalid_session';
  exception when others then
    if sqlerrm <> 'invalid_session' then raise exception 'a dead session should raise invalid_session, got %', sqlerrm; end if;
  end;
end $$;

-- Accepting the current version records it, audits it, and restores access.
do $$ declare v text := (select v from _t where k = 'jane'); r record; u portal_users; begin
  perform public.portal_accept_terms('portal-terms', v, 2, '  3.3.3.3 ');
  select * into u from portal_users where id = '731b0000-0000-0000-0000-000000000001';
  if u.terms_version is distinct from 2 or u.terms_ip is distinct from '3.3.3.3'
     or u.terms_accepted_at < now() - interval '1 minute' then
    raise exception 'acceptance not recorded: % % %', u.terms_version, u.terms_ip, u.terms_accepted_at;
  end if;
  if not exists (
    select 1 from portal_audit_log l
     where l.portal_user_id = '731b0000-0000-0000-0000-000000000001' and l.action = 'terms_accept'
  ) then
    raise exception 'accepting should write a terms_accept audit row';
  end if;
  select * into r from public.portal_session_lookup('portal-terms', v);
  if r.terms_current is distinct from true then raise exception 'after accepting, terms must be current'; end if;
  -- The session that accepted stays signed in.
  if r.portal_user_id is null then raise exception 'accepting must not end the session'; end if;
end $$;

-- A suspended partner cannot accept.
do $$ declare v text := (select v from _t where k = 'old'); begin
  update portal_users set status = 'suspended' where id = '731b0000-0000-0000-0000-000000000002';
  begin
    perform public.portal_accept_terms('portal-terms', v, 2, null);
    raise exception 'expected invalid_session';
  exception when others then
    if sqlerrm <> 'invalid_session' then raise exception 'a suspended partner should raise invalid_session, got %', sqlerrm; end if;
  end;
end $$;

rollback;
