-- Tests for 20261031000001_portal_navigatr_terms: every partner also accepts
-- navigatr's own Referral Portal Terms, and the version they accepted is stored.
--   psql "$SUPABASE_DB_URL" -f supabase/tests/079_portal_navigatr_terms.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- The database stores what was accepted; portal_api decides which navigatr
-- version is current, so nothing here compares against a "current" value.
--
-- Fixture:
--   org N1 portal-nterms (enabled, terms v1): admin A1
--     U1 Jane CPA   active, accepted ISO v1 and navigatr '2026-01-01'
--     U2 Ned CPA    invited (accepts through the invite below)

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, partner_terms_text, partner_terms_version) values
  ('00000000-0000-0000-0000-000000000791', 'Navigatr Terms Org', 'portal-nterms', 'portal-nterms-a1', true, 'ISO terms one.', 1);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('79100000-0000-0000-0000-000000000001', 'a@nt1.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('79100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000791', 'admin', 'administrator', 'A', 'a@nt1.example', 'nta'::ltree);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('791a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000791', '79100000-0000-0000-0000-000000000001', '79100000-0000-0000-0000-000000000001', 'Jane CPA', 'J & Co', 'cpa', 'jane@nt.example'),
  ('791a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000791', '79100000-0000-0000-0000-000000000001', '79100000-0000-0000-0000-000000000001', 'Ned CPA',  'N & Co', 'cpa', 'ned@nt.example');

insert into portal_users (id, org_id, partner_id, email, status, terms_accepted_at, terms_version, terms_ip, navigatr_terms_version) values
  ('791b0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000791', '791a0000-0000-0000-0000-000000000001', 'jane@nt.example', 'active', now() - interval '3 days', 1, '1.1.1.1', '2026-01-01');

create temp table _t (k text primary key, v text) on commit drop;

do $$ begin
  insert into _t select 'jane', session_token from public._portal_create_session('791b0000-0000-0000-0000-000000000001', '1.1.1.1', 'ua');
  insert into _t select 'ned_invite', invite_token from public.portal_create_invite('791a0000-0000-0000-0000-000000000002', '79100000-0000-0000-0000-000000000001');
end $$;

-- Privileges: every changed function stays service-role only.
do $$ declare f text; begin
  foreach f in array array[
    'public.portal_session_lookup(text, text)',
    'public.portal_get_terms(text, text)',
    'public.portal_accept_terms(text, text, integer, text, text)',
    'public.portal_accept_invite(text, text, integer, text, text, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
  -- The old signatures are gone, so nothing can accept without a navigatr version.
  if to_regprocedure('public.portal_accept_terms(text, text, integer, text)') is not null then
    raise exception 'the old portal_accept_terms signature must be dropped';
  end if;
  if to_regprocedure('public.portal_accept_invite(text, text, integer, text, text)') is not null then
    raise exception 'the old portal_accept_invite signature must be dropped';
  end if;
  -- The column is not readable by the API roles (portal tables are service-role only).
  if has_column_privilege('authenticated', 'public.portal_users', 'navigatr_terms_version', 'SELECT') then
    raise exception 'authenticated must not read portal_users.navigatr_terms_version';
  end if;
  if has_column_privilege('anon', 'public.portal_users', 'navigatr_terms_version', 'SELECT') then
    raise exception 'anon must not read portal_users.navigatr_terms_version';
  end if;
end $$;

-- session_lookup and get_terms return the navigatr version the partner accepted.
do $$ declare v text := (select v from _t where k = 'jane'); r record; begin
  select * into r from public.portal_session_lookup('portal-nterms', v);
  if r.navigatr_terms_version is distinct from '2026-01-01' then raise exception 'session_lookup returned %', row_to_json(r); end if;
  -- The ISO terms check is unchanged.
  if r.terms_current is distinct from true then raise exception 'ISO terms v1 should still be current, got %', row_to_json(r); end if;
  select * into r from public.portal_get_terms('portal-nterms', v);
  if r.navigatr_terms_version is distinct from '2026-01-01' or r.terms_text is distinct from 'ISO terms one.'
     or r.terms_version is distinct from 1 then
    raise exception 'get_terms returned %', row_to_json(r);
  end if;
end $$;

-- accept_terms stores the navigatr version alongside the ISO version.
do $$ declare v text := (select v from _t where k = 'jane'); r record; u portal_users; begin
  perform public.portal_accept_terms('portal-nterms', v, 1, '2026-10-30', '2.2.2.2');
  select * into u from portal_users where id = '791b0000-0000-0000-0000-000000000001';
  if u.navigatr_terms_version is distinct from '2026-10-30' or u.terms_version is distinct from 1 then
    raise exception 'accept_terms stored % / %', u.navigatr_terms_version, u.terms_version;
  end if;
  select * into r from public.portal_session_lookup('portal-nterms', v);
  if r.navigatr_terms_version is distinct from '2026-10-30' then raise exception 'lookup after accept returned %', row_to_json(r); end if;
end $$;

-- A stale ISO version is still refused, and the navigatr version is left alone.
do $$ declare v text := (select v from _t where k = 'jane'); begin
  begin
    perform public.portal_accept_terms('portal-nterms', v, 0, '2099-01-01', null);
    raise exception 'expected terms_changed';
  exception when others then
    if sqlerrm <> 'terms_changed' then raise exception 'stale ISO version should raise terms_changed, got %', sqlerrm; end if;
  end;
  if (select navigatr_terms_version from portal_users where id = '791b0000-0000-0000-0000-000000000001') is distinct from '2026-10-30' then
    raise exception 'a refused accept must not touch the navigatr version';
  end if;
end $$;

-- A blank navigatr version is stored as null (never counts as accepted).
do $$ declare v text := (select v from _t where k = 'jane'); begin
  perform public.portal_accept_terms('portal-nterms', v, 1, '   ', null);
  if (select navigatr_terms_version from portal_users where id = '791b0000-0000-0000-0000-000000000001') is not null then
    raise exception 'a blank navigatr version must be stored as null';
  end if;
end $$;

-- accept_invite stores the navigatr version at acceptance.
do $$ declare r record; u portal_users; begin
  select * into r from public.portal_accept_invite('portal-nterms', (select v from _t where k = 'ned_invite'), 1, '2026-10-30', '3.3.3.3', 'ua');
  if r.session_token is null then raise exception 'accept_invite should open a session'; end if;
  select * into u from portal_users where partner_id = '791a0000-0000-0000-0000-000000000002';
  if u.status::text is distinct from 'active' or u.terms_version is distinct from 1
     or u.navigatr_terms_version is distinct from '2026-10-30' then
    raise exception 'accept_invite stored % % %', u.status, u.terms_version, u.navigatr_terms_version;
  end if;
  select * into r from public.portal_session_lookup('portal-nterms', r.session_token);
  if r.navigatr_terms_version is distinct from '2026-10-30' then raise exception 'new session lookup returned %', row_to_json(r); end if;
end $$;

rollback;
