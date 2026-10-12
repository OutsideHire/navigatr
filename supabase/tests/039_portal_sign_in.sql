-- Tests for 20261009000003_portal_sign_in (Partner Portal Phase 1A).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/039_portal_sign_in.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- Fixture:
--   org S1 portal-sign (enabled, branded):
--     U1 Jane CPA   jane@example.com   active
--     U2 Sam CPA    sam@example.com    suspended
--     U3 Rate CPA   rate@example.com   active   (per-user rate limit)
--     U4 New CPA    new@example.com    invited
--     U5 Cap CPA    ipcap@example.com  active   (per-IP rate limit)
--   org S2 portal-sign-b (enabled): UB jane@example.com active (same email, other tenant)
--   org S3 portal-sign-off (portal OFF): UC off@example.com active

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000000f91', 'Portal Sign Org', 'portal-sign',     'portal-sign-a1', true),
  ('00000000-0000-0000-0000-000000000f92', 'Portal Sign B',   'portal-sign-b',   'portal-sign-b1', true),
  ('00000000-0000-0000-0000-000000000f93', 'Portal Sign Off', 'portal-sign-off', 'portal-sign-c1', false);

insert into org_branding (org_id, product_name, primary_color, logo_url) values
  ('00000000-0000-0000-0000-000000000f91', 'Acme Portal', '#0f766e', 'https://cdn.example/logo.png');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('f9100000-0000-0000-0000-000000000001', 'a@ps1.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('f9100000-0000-0000-0000-000000000002', 'b@ps1.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('f9100000-0000-0000-0000-000000000003', 'c@ps1.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('f9100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f91', 'admin', 'administrator', 'A', 'a@ps1.example', 'sa'::ltree),
  ('f9100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000f92', 'admin', 'administrator', 'B', 'b@ps1.example', 'sb'::ltree),
  ('f9100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000f93', 'admin', 'administrator', 'C', 'c@ps1.example', 'sc'::ltree);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('f91a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f91', 'f9100000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', 'Jane CPA', 'J & Co', 'cpa', 'jane@example.com'),
  ('f91a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000f91', 'f9100000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', 'Sam CPA',  'S & Co', 'cpa', 'sam@example.com'),
  ('f91a0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000f91', 'f9100000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', 'Rate CPA', 'R & Co', 'cpa', 'rate@example.com'),
  ('f91a0000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000f91', 'f9100000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', 'New CPA',  'N & Co', 'cpa', 'new@example.com'),
  ('f91a0000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000f91', 'f9100000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', 'Cap CPA',  'C & Co', 'cpa', 'ipcap@example.com'),
  ('f91a0000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000f92', 'f9100000-0000-0000-0000-000000000002', 'f9100000-0000-0000-0000-000000000002', 'Jane B',   'JB & Co', 'cpa', 'jane@example.com'),
  ('f91a0000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000f93', 'f9100000-0000-0000-0000-000000000003', 'f9100000-0000-0000-0000-000000000003', 'Off CPA',  'O & Co', 'cpa', 'off@example.com');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('f91b0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f91', 'f91a0000-0000-0000-0000-000000000001', 'jane@example.com',  'active'),
  ('f91b0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000f91', 'f91a0000-0000-0000-0000-000000000002', 'sam@example.com',   'suspended'),
  ('f91b0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000f91', 'f91a0000-0000-0000-0000-000000000003', 'rate@example.com',  'active'),
  ('f91b0000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000f91', 'f91a0000-0000-0000-0000-000000000004', 'new@example.com',   'invited'),
  ('f91b0000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000f91', 'f91a0000-0000-0000-0000-000000000005', 'ipcap@example.com', 'active'),
  ('f91b0000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000f92', 'f91a0000-0000-0000-0000-000000000006', 'jane@example.com',  'active'),
  ('f91b0000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000f93', 'f91a0000-0000-0000-0000-000000000007', 'off@example.com',   'active');

create temp table _t (k text primary key, v text) on commit drop;

-- Privileges.
do $$ declare f text; begin
  foreach f in array array[
    'public.portal_brand(text)',
    'public.portal_issue_code(text, text, text)',
    'public.portal_verify_code(text, text, text, text, text)',
    'public.portal_session_lookup(text, text)',
    'public.portal_sign_out(text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
end $$;

-- Branding before sign-in.
do $$ declare r record; n int; begin
  select * into r from public.portal_brand(' Portal-Sign ');
  if r.org_name is distinct from 'Portal Sign Org' or r.product_name is distinct from 'Acme Portal'
     or r.primary_color is distinct from '#0f766e' or r.logo_url is distinct from 'https://cdn.example/logo.png' then
    raise exception 'brand for portal-sign is wrong: %', row_to_json(r);
  end if;
  select * into r from public.portal_brand('portal-sign-b');
  if r.product_name is distinct from 'navigatr' or r.primary_color is not null then
    raise exception 'an org without a branding row gets the defaults';
  end if;
  select count(*) into n from public.portal_brand('portal-sign-off');
  if n <> 0 then raise exception 'a disabled portal must not expose branding'; end if;
  select count(*) into n from public.portal_brand('no-such-portal');
  if n <> 0 then raise exception 'an unknown slug must return nothing'; end if;
end $$;

-- Issue a code: 6 digits, hashed with the user id, 15 minutes, IP recorded.
do $$ declare r record; begin
  select * into r from public.portal_issue_code('portal-sign', ' Jane@Example.com ', '10.0.0.1');
  if r.code is null or r.code !~ '^[0-9]{6}$' then raise exception 'expected a 6-digit code, got %', r.code; end if;
  if r.recipient is distinct from 'jane@example.com' or r.org_name is distinct from 'Portal Sign Org'
     or r.org_slug is distinct from 'portal-sign' then
    raise exception 'issue metadata wrong: %', row_to_json(r);
  end if;
  if not exists (
    select 1 from portal_tokens t
     where t.portal_user_id = 'f91b0000-0000-0000-0000-000000000001'
       and t.token_type = 'sign_in_code'
       and t.token_hash = encode(extensions.digest(r.code || ':' || 'f91b0000-0000-0000-0000-000000000001', 'sha256'), 'hex')
       and t.expires_at between now() + interval '14 minutes' and now() + interval '16 minutes'
       and t.ip = '10.0.0.1') then
    raise exception 'code should be stored hashed with the user id salt, a 15 minute expiry and the IP';
  end if;
  if exists (select 1 from portal_tokens t where t.token_hash = r.code) then
    raise exception 'raw code must never be stored';
  end if;
  insert into _t values ('code1', r.code);
end $$;

-- No code for unknown, suspended, invited, or a disabled portal.
do $$ declare n int; begin
  select count(*) into n from public.portal_issue_code('portal-sign', 'nobody@example.com', '10.0.0.9');
  if n <> 0 then raise exception 'unknown email must get no code'; end if;
  select count(*) into n from public.portal_issue_code('portal-sign', 'sam@example.com', '10.0.0.9');
  if n <> 0 then raise exception 'suspended user must get no code'; end if;
  select count(*) into n from public.portal_issue_code('portal-sign', 'new@example.com', '10.0.0.9');
  if n <> 0 then raise exception 'invited user must use the invite link first'; end if;
  select count(*) into n from public.portal_issue_code('portal-sign-off', 'off@example.com', '10.0.0.9');
  if n <> 0 then raise exception 'disabled portal must issue no code'; end if;
  if exists (select 1 from portal_tokens where portal_user_id in (
      'f91b0000-0000-0000-0000-000000000002', 'f91b0000-0000-0000-0000-000000000004', 'f91b0000-0000-0000-0000-000000000007')) then
    raise exception 'no token may be issued for those users';
  end if;
end $$;

-- Verify: other tenant, wrong code, right code, reuse.
do $$ declare v_code text := (select v from _t where k = 'code1'); v_wrong text; r record; n int; begin
  v_wrong := case when v_code = '000000' then '000001' else '000000' end;

  select count(*) into n from public.portal_verify_code('portal-sign-b', 'jane@example.com', v_code, '10.0.0.1', 'ua');
  if n <> 0 then raise exception 'a code from one tenant must not sign in to another'; end if;

  select count(*) into n from public.portal_verify_code('portal-sign', 'jane@example.com', v_wrong, '10.0.0.1', 'ua');
  if n <> 0 then raise exception 'a wrong code must not sign in'; end if;
  if (select attempts from portal_tokens
       where portal_user_id = 'f91b0000-0000-0000-0000-000000000001' and consumed_at is null) is distinct from 1 then
    raise exception 'a wrong guess should count one attempt';
  end if;

  select * into r from public.portal_verify_code('portal-sign', 'JANE@example.com', v_code, '10.0.0.1', 'Mozilla/5.0');
  if r.session_token is null or r.session_token !~ '^[0-9a-f]{64}$' then raise exception 'right code should return a session'; end if;
  if r.session_expires_at < now() + interval '29 days' then raise exception 'session should last 30 days'; end if;
  if exists (select 1 from portal_sessions s where s.token_hash = r.session_token) then
    raise exception 'raw session token must never be stored';
  end if;
  if (select last_login_at from portal_users where id = 'f91b0000-0000-0000-0000-000000000001') is null then
    raise exception 'sign-in should stamp last_login_at';
  end if;

  select count(*) into n from public.portal_verify_code('portal-sign', 'jane@example.com', v_code, '10.0.0.1', 'ua');
  if n <> 0 then raise exception 'a code works only once'; end if;
  insert into _t values ('sess1', r.session_token);
end $$;

-- Session lookup is scoped to the session's own tenant.
do $$ declare v text := (select v from _t where k = 'sess1'); r record; n int; begin
  select * into r from public.portal_session_lookup('portal-sign', v);
  if r.partner_id is distinct from 'f91a0000-0000-0000-0000-000000000001' or r.user_email is distinct from 'jane@example.com'
     or r.partner_name is distinct from 'Jane CPA' or r.org_slug is distinct from 'portal-sign' then
    raise exception 'lookup returned the wrong identity: %', row_to_json(r);
  end if;
  select count(*) into n from public.portal_session_lookup('portal-sign-b', v);
  if n <> 0 then raise exception 'a session must not open another tenant''s portal'; end if;
end $$;

-- Five wrong guesses kill a code.
do $$ declare r record; v_wrong text; n int; i int; begin
  select * into r from public.portal_issue_code('portal-sign', 'jane@example.com', '10.0.0.2');
  v_wrong := case when r.code = '000000' then '000001' else '000000' end;
  for i in 1..5 loop
    perform public.portal_verify_code('portal-sign', 'jane@example.com', v_wrong, '10.0.0.2', 'ua');
  end loop;
  select count(*) into n from public.portal_verify_code('portal-sign', 'jane@example.com', r.code, '10.0.0.2', 'ua');
  if n <> 0 then raise exception 'a code must be dead after 5 wrong attempts'; end if;
end $$;

-- Expired codes are rejected.
do $$ declare r record; n int; begin
  select * into r from public.portal_issue_code('portal-sign', 'jane@example.com', '10.0.0.3');
  update portal_tokens set expires_at = now() - interval '1 minute'
   where token_hash = encode(extensions.digest(r.code || ':' || 'f91b0000-0000-0000-0000-000000000001', 'sha256'), 'hex');
  select count(*) into n from public.portal_verify_code('portal-sign', 'jane@example.com', r.code, '10.0.0.3', 'ua');
  if n <> 0 then raise exception 'an expired code must be rejected'; end if;
end $$;

-- Per-user limit: 5 codes an hour.
do $$ declare i int; n int; begin
  for i in 1..5 loop
    select count(*) into n from public.portal_issue_code('portal-sign', 'rate@example.com', '10.0.1.' || i);
    if n <> 1 then raise exception 'code % of 5 should be issued', i; end if;
  end loop;
  select count(*) into n from public.portal_issue_code('portal-sign', 'rate@example.com', '10.0.1.6');
  if n <> 0 then raise exception 'the sixth code in an hour must be refused'; end if;
end $$;

-- Per-IP limit: 20 requests an hour, known or unknown emails alike.
do $$ declare i int; n int; begin
  for i in 1..20 loop
    perform public.portal_issue_code('portal-sign', 'nobody' || i || '@example.com', '9.9.9.9');
  end loop;
  select count(*) into n from public.portal_issue_code('portal-sign', 'ipcap@example.com', '9.9.9.9');
  if n <> 0 then raise exception 'the 21st request from one IP in an hour must be refused'; end if;
  select count(*) into n from public.portal_issue_code('portal-sign', 'ipcap@example.com', '9.9.9.10');
  if n <> 1 then raise exception 'a different IP must not be affected'; end if;
end $$;

-- Empty IP: no shared bucket. Codes still issue (per-user limit applies) and 21
-- empty-IP requests across different users are not blocked.
do $$ declare i int; n int; begin
  insert into partners (id, org_id, created_by, owner_id, name, company, type, email)
  select ('f91a0000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000f91',
         'f9100000-0000-0000-0000-000000000001', 'f9100000-0000-0000-0000-000000000001', 'E' || g, 'E', 'cpa', 'empty' || g || '@example.com'
    from generate_series(1, 22) g;
  insert into portal_users (org_id, partner_id, email, status)
  select '00000000-0000-0000-0000-000000000f91', ('f91a0000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid,
         'empty' || g || '@example.com', 'active' from generate_series(1, 22) g;
  for i in 1..22 loop
    select count(*) into n from public.portal_issue_code('portal-sign', 'empty' || i || '@example.com', '');
    if n <> 1 then raise exception 'empty-IP request % should still get a code', i; end if;
  end loop;
  select count(*) into n from public.portal_issue_code('portal-sign', 'empty1@example.com', null);
  if n <> 1 then raise exception 'null IP should still get a code under the user limit'; end if;
  if exists (select 1 from portal_audit_log where action = 'code_request' and ip = 'unknown') then
    raise exception 'empty IP must not be recorded as a shared bucket';
  end if;
end $$;

-- Sign-out, expiry, revoke and portal-off all end a session on the next lookup.
do $$ declare v text := (select v from _t where k = 'sess1'); n int; begin
  perform public.portal_sign_out(v);
  select count(*) into n from public.portal_session_lookup('portal-sign', v);
  if n <> 0 then raise exception 'a signed-out session must be rejected'; end if;
  if not exists (select 1 from portal_audit_log
                  where portal_user_id = 'f91b0000-0000-0000-0000-000000000001' and action = 'sign_out') then
    raise exception 'sign-out should be audited';
  end if;

  insert into portal_sessions (org_id, portal_user_id, token_hash, expires_at) values
    ('00000000-0000-0000-0000-000000000f91', 'f91b0000-0000-0000-0000-000000000001', encode(extensions.digest('sess-expired', 'sha256'), 'hex'), now() - interval '1 minute'),
    ('00000000-0000-0000-0000-000000000f91', 'f91b0000-0000-0000-0000-000000000001', encode(extensions.digest('sess-live', 'sha256'), 'hex'),    now() + interval '1 day');
  select count(*) into n from public.portal_session_lookup('portal-sign', 'sess-expired');
  if n <> 0 then raise exception 'an expired session must be rejected'; end if;
  select count(*) into n from public.portal_session_lookup('portal-sign', 'sess-live');
  if n <> 1 then raise exception 'a live session should resolve'; end if;

  update portal_users set status = 'revoked' where id = 'f91b0000-0000-0000-0000-000000000001';
  select count(*) into n from public.portal_session_lookup('portal-sign', 'sess-live');
  if n <> 0 then raise exception 'a revoked user''s session must be rejected on the next lookup'; end if;

  update portal_users set status = 'active' where id = 'f91b0000-0000-0000-0000-000000000001';
  update organizations set portal_enabled = false where id = '00000000-0000-0000-0000-000000000f91';
  select count(*) into n from public.portal_session_lookup('portal-sign', 'sess-live');
  if n <> 0 then raise exception 'turning the portal off must reject every session'; end if;
end $$;

-- P7: _portal_create_session must raise when the portal user does not exist.
do $$ begin
  begin
    perform * from public._portal_create_session(gen_random_uuid(), '1.1.1.1', 'ua');
    raise exception 'create_session should have raised for an unknown user';
  exception when sqlstate 'P0002' then
    null;
  end;
end $$;

rollback;
