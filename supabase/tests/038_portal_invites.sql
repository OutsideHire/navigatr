-- Tests for 20261009000002_portal_invites (Partner Portal Phase 1A).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/038_portal_invites.sql
-- Self-cleans via ROLLBACK. Everything runs as postgres: these functions are
-- service-role only, so there is no role switch in this file.
--
-- Fixture:
--   org PI  (portal-inv, enabled, terms "Terms v3" version 3)
--     boss administrator; rep1 boss.rep1; rep2 boss.rep2
--     P1 Jane CPA (rep1, Jane@Example.com)   P2 Pat CPA (rep2, pat@example.com)
--     P3 No Email (rep1, no email)           P4 Jane Twin (rep2, same email as P1)
--   org PB  (portal-inv-b, enabled): oboss administrator
--   org PO  (portal-inv-off, portal OFF): cboss administrator, PC Cara CPA

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, partner_terms_text, partner_terms_version) values
  ('00000000-0000-0000-0000-000000000f81', 'Portal Invite Org', 'portal-inv',     'portal-inv-a1', true,  'Terms v3',    3),
  ('00000000-0000-0000-0000-000000000f82', 'Other Portal Org',  'portal-inv-b',   'portal-inv-b1', true,  'Other terms', 1),
  ('00000000-0000-0000-0000-000000000f83', 'Portal Off Org',    'portal-inv-off', 'portal-inv-c1', false, null,          0);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('f8100000-0000-0000-0000-000000000001', 'boss@pi.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('f8100000-0000-0000-0000-000000000002', 'rep1@pi.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('f8100000-0000-0000-0000-000000000003', 'rep2@pi.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('f8100000-0000-0000-0000-000000000004', 'oboss@pi.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('f8100000-0000-0000-0000-000000000005', 'cboss@pi.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('f8100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f81', 'admin', 'administrator',      'Boss',  'boss@pi.example',  'boss'::ltree,      null),
  ('f8100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000f81', 'rep',   'sales_professional', 'Rep1',  'rep1@pi.example',  'boss.rep1'::ltree, 'f8100000-0000-0000-0000-000000000001'),
  ('f8100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000f81', 'rep',   'sales_professional', 'Rep2',  'rep2@pi.example',  'boss.rep2'::ltree, 'f8100000-0000-0000-0000-000000000001'),
  ('f8100000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000f82', 'admin', 'administrator',      'OBoss', 'oboss@pi.example', 'oboss'::ltree,     null),
  ('f8100000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000f83', 'admin', 'administrator',      'CBoss', 'cboss@pi.example', 'cboss'::ltree,     null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('f81a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f81', 'f8100000-0000-0000-0000-000000000002', 'f8100000-0000-0000-0000-000000000002', 'Jane CPA',  'Jane & Co', 'cpa', 'Jane@Example.com'),
  ('f81a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000f81', 'f8100000-0000-0000-0000-000000000003', 'f8100000-0000-0000-0000-000000000003', 'Pat CPA',   'Pat & Co',  'cpa', 'pat@example.com'),
  ('f81a0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000f81', 'f8100000-0000-0000-0000-000000000002', 'f8100000-0000-0000-0000-000000000002', 'No Email',  'NE & Co',   'cpa', null),
  ('f81a0000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000f81', 'f8100000-0000-0000-0000-000000000003', 'f8100000-0000-0000-0000-000000000003', 'Jane Twin', 'Twin & Co', 'cpa', ' JANE@example.com '),
  ('f81a0000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000f83', 'f8100000-0000-0000-0000-000000000005', 'f8100000-0000-0000-0000-000000000005', 'Cara CPA',  'Cara & Co', 'cpa', 'cara@example.com');

create temp table _t (k text primary key, v text) on commit drop;

create or replace function _t_raises(p_sql text, p_token text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_token in sqlerrm) = 0 then
      raise exception 'expected error %, got: %', p_token, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error % but the statement succeeded: %', p_token, p_sql;
end $$;

-- Privileges: portal functions are service-role only; helpers are executable by no API role.
do $$ declare f text; begin
  foreach f in array array[
    'public.portal_create_invite(uuid, uuid)',
    'public.portal_peek_invite(text, text)',
    'public.portal_accept_invite(text, text, integer, text, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
  foreach f in array array[
    'public._portal_hash(text)',
    'public._portal_new_token()',
    'public._portal_audit(uuid, uuid, public.portal_audit_action, text, uuid)',
    'public._portal_create_session(uuid, text, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
       or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'private helper % must not be executable by an API role', f;
    end if;
  end loop;
end $$;

-- rep1 invites P1: raw token comes back once; the email is lowercased.
do $$ declare r record; begin
  select * into r from public.portal_create_invite('f81a0000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000002');
  if r.invite_token is null or r.invite_token !~ '^[0-9a-f]{64}$' then raise exception 'invite token should be 64 hex chars, got %', r.invite_token; end if;
  if r.invite_email is distinct from 'jane@example.com' then raise exception 'email should be trimmed and lowercased, got %', r.invite_email; end if;
  if r.partner_name is distinct from 'Jane CPA' or r.org_name is distinct from 'Portal Invite Org' or r.org_slug is distinct from 'portal-inv' then
    raise exception 'invite metadata wrong: % % %', r.partner_name, r.org_name, r.org_slug;
  end if;
  insert into _t values ('tok1', r.invite_token);
end $$;

-- Only the hash is stored; the portal user is invited.
do $$ declare v_tok text := (select v from _t where k = 'tok1'); begin
  if exists (select 1 from portal_tokens t where t::text like '%' || v_tok || '%') then
    raise exception 'raw invite token must never be stored';
  end if;
  if not exists (select 1 from portal_tokens
                  where token_hash = encode(extensions.digest(v_tok, 'sha256'), 'hex')
                    and token_type = 'invite'
                    and expires_at > now() + interval '6 days 23 hours') then
    raise exception 'invite should be stored as its SHA-256 hash with a 7 day expiry';
  end if;
  if (select status::text from portal_users where partner_id = 'f81a0000-0000-0000-0000-000000000001') is distinct from 'invited' then
    raise exception 'portal user should be invited';
  end if;
  if not exists (select 1 from portal_audit_log where action = 'invite' and actor_user_id = 'f8100000-0000-0000-0000-000000000002') then
    raise exception 'invite should be audited with the inviting rep';
  end if;
end $$;

-- Refusals.
do $$ begin
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-000000000001'', ''f8100000-0000-0000-0000-000000000003'')', 'not_authorized');
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-000000000001'', ''f8100000-0000-0000-0000-000000000004'')', 'not_authorized');
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-000000000003'', ''f8100000-0000-0000-0000-000000000002'')', 'partner_email_required');
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-000000000005'', ''f8100000-0000-0000-0000-000000000005'')', 'portal_disabled');
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-0000000000ff'', ''f8100000-0000-0000-0000-000000000001'')', 'partner_not_found');
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-000000000004'', ''f8100000-0000-0000-0000-000000000003'')', 'portal_email_in_use');
end $$;

-- Peek: valid only for the right slug.
do $$ declare v_tok text := (select v from _t where k = 'tok1'); r record; n int; begin
  select * into r from public.portal_peek_invite('portal-inv', v_tok);
  if r.partner_name is distinct from 'Jane CPA' or r.org_name is distinct from 'Portal Invite Org'
     or r.terms_text is distinct from 'Terms v3' or r.terms_version is distinct from 3 then
    raise exception 'peek returned the wrong invite: %', row_to_json(r);
  end if;
  select count(*) into n from public.portal_peek_invite('portal-inv-b', v_tok);
  if n <> 0 then raise exception 'another org slug must not resolve this invite'; end if;
  select count(*) into n from public.portal_peek_invite('portal-inv', 'not-a-token');
  if n <> 0 then raise exception 'an unknown token must not resolve'; end if;
end $$;

-- Resend (the admin, who sees everything) invalidates the first invite.
do $$ declare r record; n int; begin
  select * into r from public.portal_create_invite('f81a0000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000001');
  insert into _t values ('tok2', r.invite_token);
  select count(*) into n from public.portal_peek_invite('portal-inv', (select v from _t where k = 'tok1'));
  if n <> 0 then raise exception 'resending must invalidate the earlier invite'; end if;
  select count(*) into n from public.portal_peek_invite('portal-inv', r.invite_token);
  if n <> 1 then raise exception 'the new invite should be valid'; end if;
end $$;

-- Accept refusals leave the invite usable.
do $$ declare v_tok text := (select v from _t where k = 'tok2'); n int; begin
  perform _t_raises(format('select * from public.portal_accept_invite(%L, %L, 2, %L, %L)', 'portal-inv', v_tok, '203.0.113.9', 'ua'), 'terms_changed');
  perform _t_raises(format('select * from public.portal_accept_invite(%L, %L, 1, null, null)', 'portal-inv-b', v_tok), 'invalid_invite');
  select count(*) into n from public.portal_peek_invite('portal-inv', v_tok);
  if n <> 1 then raise exception 'a refused accept must not consume the invite'; end if;
end $$;

-- Accept: active, terms recorded, session issued, invite consumed.
do $$ declare v_tok text := (select v from _t where k = 'tok2'); r record; u portal_users; n int; begin
  select * into r from public.portal_accept_invite('portal-inv', v_tok, 3, '203.0.113.9', 'Mozilla/5.0');
  if r.session_token is null or r.session_token !~ '^[0-9a-f]{64}$' then raise exception 'accept should return a 64 hex session token'; end if;
  if r.session_expires_at < now() + interval '29 days' then raise exception 'session should last 30 days'; end if;

  select * into u from portal_users where partner_id = 'f81a0000-0000-0000-0000-000000000001';
  if u.status::text is distinct from 'active' or u.activated_at is null or u.terms_accepted_at is null
     or u.terms_version is distinct from 3 or u.terms_ip is distinct from '203.0.113.9' then
    raise exception 'accept should activate and record terms, got %', row_to_json(u);
  end if;

  if exists (select 1 from portal_sessions s where s::text like '%' || r.session_token || '%') then
    raise exception 'raw session token must never be stored';
  end if;
  if not exists (select 1 from portal_sessions where token_hash = encode(extensions.digest(r.session_token, 'sha256'), 'hex')
                    and user_agent = 'Mozilla/5.0') then
    raise exception 'session should be stored as its hash with the user agent';
  end if;

  select count(*) into n from portal_audit_log where portal_user_id = u.id and action in ('terms_accept', 'sign_in');
  if n <> 2 then raise exception 'accept should audit terms_accept and sign_in, got % rows', n; end if;

  select count(*) into n from public.portal_peek_invite('portal-inv', v_tok);
  if n <> 0 then raise exception 'an accepted invite must be consumed'; end if;
  perform _t_raises(format('select * from public.portal_accept_invite(%L, %L, 3, null, null)', 'portal-inv', v_tok), 'invalid_invite');
  perform _t_raises('select * from public.portal_create_invite(''f81a0000-0000-0000-0000-000000000001'', ''f8100000-0000-0000-0000-000000000002'')', 'portal_already_active');
end $$;

-- Expired invites are rejected; a revoked user can be invited again.
do $$ declare r record; n int; begin
  select * into r from public.portal_create_invite('f81a0000-0000-0000-0000-000000000002', 'f8100000-0000-0000-0000-000000000003');
  update portal_tokens set expires_at = now() - interval '1 minute'
   where token_hash = encode(extensions.digest(r.invite_token, 'sha256'), 'hex');
  select count(*) into n from public.portal_peek_invite('portal-inv', r.invite_token);
  if n <> 0 then raise exception 'an expired invite must not resolve'; end if;
  perform _t_raises(format('select * from public.portal_accept_invite(%L, %L, 3, null, null)', 'portal-inv', r.invite_token), 'invalid_invite');

  update portal_users set status = 'revoked' where partner_id = 'f81a0000-0000-0000-0000-000000000002';
  select * into r from public.portal_create_invite('f81a0000-0000-0000-0000-000000000002', 'f8100000-0000-0000-0000-000000000003');
  if (select status::text from portal_users where partner_id = 'f81a0000-0000-0000-0000-000000000002') is distinct from 'invited' then
    raise exception 'inviting a revoked partner should move them back to invited';
  end if;
end $$;

rollback;
