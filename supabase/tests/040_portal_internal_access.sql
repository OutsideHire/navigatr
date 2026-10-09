-- Tests for 20261009000004_portal_internal_access (Partner Portal Phase 1A).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/040_portal_internal_access.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org IA, slug portal-ia, portal on):
--   boss administrator; mgr sales_manager boss.mgr;
--   rep1 boss.mgr.rep1 owns P1; rep2 boss.mgr.rep2 owns P2
--   U1 (P1) active with a live session "ia-sess-1" and an unused sign-in code
--   U2 (P2) invited with an unused invite
-- Org IX (portal-ia-x): ox administrator, PX, UX active.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000000fa1', 'Portal Access Org', 'portal-ia',   'portal-ia-a1', true),
  ('00000000-0000-0000-0000-000000000fa2', 'Portal Access X',   'portal-ia-x', 'portal-ia-b1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('fa100000-0000-0000-0000-000000000001', 'boss@ia.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('fa100000-0000-0000-0000-000000000002', 'mgr@ia.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('fa100000-0000-0000-0000-000000000003', 'rep1@ia.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('fa100000-0000-0000-0000-000000000004', 'rep2@ia.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('fa100000-0000-0000-0000-000000000005', 'ox@ia.example',   'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('fa100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000fa1', 'admin',   'administrator',      'Boss', 'boss@ia.example', 'boss'::ltree,          null),
  ('fa100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000fa1', 'manager', 'sales_manager',      'Mgr',  'mgr@ia.example',  'boss.mgr'::ltree,      'fa100000-0000-0000-0000-000000000001'),
  ('fa100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000fa1', 'rep',     'sales_professional', 'Rep1', 'rep1@ia.example', 'boss.mgr.rep1'::ltree, 'fa100000-0000-0000-0000-000000000002'),
  ('fa100000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000fa1', 'rep',     'sales_professional', 'Rep2', 'rep2@ia.example', 'boss.mgr.rep2'::ltree, 'fa100000-0000-0000-0000-000000000002'),
  ('fa100000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000fa2', 'admin',   'administrator',      'OX',   'ox@ia.example',   'ox'::ltree,            null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('fa1a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000fa1', 'fa100000-0000-0000-0000-000000000003', 'fa100000-0000-0000-0000-000000000003', 'Jane CPA', 'J & Co', 'cpa', 'jane@example.com'),
  ('fa1a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000fa1', 'fa100000-0000-0000-0000-000000000004', 'fa100000-0000-0000-0000-000000000004', 'Pat CPA',  'P & Co', 'cpa', 'pat@example.com'),
  ('fa1a0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000fa2', 'fa100000-0000-0000-0000-000000000005', 'fa100000-0000-0000-0000-000000000005', 'X CPA',    'X & Co', 'cpa', 'x@example.com');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('fa1b0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000fa1', 'fa1a0000-0000-0000-0000-000000000001', 'jane@example.com', 'active'),
  ('fa1b0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000fa1', 'fa1a0000-0000-0000-0000-000000000002', 'pat@example.com',  'invited'),
  ('fa1b0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000fa2', 'fa1a0000-0000-0000-0000-000000000003', 'x@example.com',    'active');

insert into portal_sessions (org_id, portal_user_id, token_hash, expires_at) values
  ('00000000-0000-0000-0000-000000000fa1', 'fa1b0000-0000-0000-0000-000000000001', encode(extensions.digest('ia-sess-1', 'sha256'), 'hex'), now() + interval '1 day');

insert into portal_tokens (org_id, portal_user_id, token_type, token_hash, expires_at) values
  ('00000000-0000-0000-0000-000000000fa1', 'fa1b0000-0000-0000-0000-000000000001', 'sign_in_code', encode(extensions.digest('123456:x', 'sha256'), 'hex'), now() + interval '10 minutes'),
  ('00000000-0000-0000-0000-000000000fa1', 'fa1b0000-0000-0000-0000-000000000002', 'invite',       encode(extensions.digest('ia-invite-2', 'sha256'), 'hex'), now() + interval '6 days');

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

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

create or replace function _t_portal_rows(p_user uuid) returns int language plpgsql as $$
declare n int;
begin
  perform _t_act(p_user);
  select count(id) into n from portal_users;
  return n;
end $$;

-- Privileges (before any role switch).
do $$ begin
  if has_function_privilege('anon', 'public.portal_set_access(uuid, text)', 'EXECUTE') then raise exception 'anon must not execute portal_set_access'; end if;
  if not has_function_privilege('authenticated', 'public.portal_set_access(uuid, text)', 'EXECUTE') then raise exception 'authenticated should execute portal_set_access'; end if;
  if has_function_privilege('anon', 'public.get_portal_status()', 'EXECUTE') then raise exception 'anon must not execute get_portal_status'; end if;
  if not has_function_privilege('authenticated', 'public.get_portal_status()', 'EXECUTE') then raise exception 'authenticated should execute get_portal_status'; end if;
end $$;

-- portal_users visibility follows the partner (role switches from here on).
do $$ begin
  if _t_portal_rows('fa100000-0000-0000-0000-000000000003') <> 1 then raise exception 'rep1 should see only P1''s portal user'; end if;
  if _t_portal_rows('fa100000-0000-0000-0000-000000000004') <> 1 then raise exception 'rep2 should see only P2''s portal user'; end if;
  if _t_portal_rows('fa100000-0000-0000-0000-000000000002') <> 2 then raise exception 'mgr should see both'; end if;
  if _t_portal_rows('fa100000-0000-0000-0000-000000000001') <> 2 then raise exception 'admin should see both in their org'; end if;
  if _t_portal_rows('fa100000-0000-0000-0000-000000000005') <> 1 then raise exception 'another org sees only its own'; end if;
end $$;

-- rep1: status, refusals, suspend.
do $$ declare r record; begin
  perform _t_act('fa100000-0000-0000-0000-000000000003');
  select * into r from public.get_portal_status();
  if r.enabled is distinct from true or r.slug is distinct from 'portal-ia' then
    raise exception 'get_portal_status should report the org portal, got %', row_to_json(r);
  end if;
  perform _t_raises('select public.portal_set_access(''fa1a0000-0000-0000-0000-000000000002'', ''suspended'')', 'partner_not_visible');
  perform _t_raises('select public.portal_set_access(''fa1a0000-0000-0000-0000-000000000003'', ''suspended'')', 'partner_not_visible');
  perform _t_raises('select public.portal_set_access(''fa1a0000-0000-0000-0000-000000000001'', ''active'')', 'invalid_status');
  perform _t_raises('select public.portal_set_access(''fa1a0000-0000-0000-0000-000000000001'', ''invited'')', 'portal_not_restorable');
  if public.portal_set_access('fa1a0000-0000-0000-0000-000000000001', 'suspended') is distinct from 'suspended' then
    raise exception 'suspend should return suspended';
  end if;
end $$;

-- Suspension ends the session on the next lookup and kills unused codes.
do $$ declare n int; begin
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.portal_session_lookup('portal-ia', 'ia-sess-1');
  if n <> 0 then raise exception 'a suspended partner''s session must be rejected on the next lookup'; end if;
  if exists (select 1 from portal_sessions where portal_user_id = 'fa1b0000-0000-0000-0000-000000000001' and revoked_at is null) then
    raise exception 'suspend should stamp revoked_at on every session';
  end if;
  if exists (select 1 from portal_tokens where portal_user_id = 'fa1b0000-0000-0000-0000-000000000001' and consumed_at is null and revoked_at is null) then
    raise exception 'suspend should revoke every unused token';
  end if;
  if not exists (select 1 from portal_audit_log where portal_user_id = 'fa1b0000-0000-0000-0000-000000000001'
                    and action = 'suspend' and actor_user_id = 'fa100000-0000-0000-0000-000000000003') then
    raise exception 'suspend should be audited with the acting rep';
  end if;
end $$;

-- Restore moves the partner back to invited.
do $$ begin
  perform _t_act('fa100000-0000-0000-0000-000000000003');
  if public.portal_set_access('fa1a0000-0000-0000-0000-000000000001', 'invited') is distinct from 'invited' then
    raise exception 'restore should return invited';
  end if;
end $$;

do $$ declare n int; begin
  perform set_config('role', 'postgres', true);
  if (select status::text from portal_users where id = 'fa1b0000-0000-0000-0000-000000000001') is distinct from 'invited' then
    raise exception 'restore should leave the partner invited';
  end if;
  if not exists (select 1 from portal_audit_log where portal_user_id = 'fa1b0000-0000-0000-0000-000000000001' and action = 'restore') then
    raise exception 'restore should be audited';
  end if;
  update portal_users set status = 'active' where id = 'fa1b0000-0000-0000-0000-000000000001';
  insert into portal_sessions (org_id, portal_user_id, token_hash, expires_at) values
    ('00000000-0000-0000-0000-000000000fa1', 'fa1b0000-0000-0000-0000-000000000001', encode(extensions.digest('ia-sess-2', 'sha256'), 'hex'), now() + interval '1 day');
  select count(*) into n from public.portal_session_lookup('portal-ia', 'ia-sess-2');
  if n <> 1 then raise exception 'a fresh session should resolve before the revoke'; end if;
end $$;

-- The manager revokes both partners.
do $$ begin
  perform _t_act('fa100000-0000-0000-0000-000000000002');
  if public.portal_set_access('fa1a0000-0000-0000-0000-000000000001', 'revoked') is distinct from 'revoked' then
    raise exception 'mgr revoke of P1 should succeed';
  end if;
  if public.portal_set_access('fa1a0000-0000-0000-0000-000000000002', 'revoked') is distinct from 'revoked' then
    raise exception 'mgr revoke of invited P2 should succeed';
  end if;
end $$;

do $$ declare n int; begin
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.portal_session_lookup('portal-ia', 'ia-sess-2');
  if n <> 0 then raise exception 'a revoked partner''s session must be rejected on the next lookup'; end if;
  if exists (select 1 from portal_tokens where portal_user_id = 'fa1b0000-0000-0000-0000-000000000002' and consumed_at is null and revoked_at is null) then
    raise exception 'revoking must kill the outstanding invite';
  end if;
end $$;

-- The revoke is audited with the acting manager.
do $$ begin
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from portal_audit_log where portal_user_id = 'fa1b0000-0000-0000-0000-000000000001'
                    and action = 'revoke' and actor_user_id = 'fa100000-0000-0000-0000-000000000002') then
    raise exception 'revoke should be audited with the acting manager';
  end if;
end $$;

-- A revoked partner cannot be moved to suspended (only restored).
do $$ begin
  perform _t_act('fa100000-0000-0000-0000-000000000002');
  perform _t_raises('select public.portal_set_access(''fa1a0000-0000-0000-0000-000000000001'', ''suspended'')', 'invalid_transition');
end $$;

do $$ begin
  perform set_config('role', 'postgres', true);
  if (select status::text from portal_users where id = 'fa1b0000-0000-0000-0000-000000000001') is distinct from 'revoked' then
    raise exception 'a refused transition must leave the partner revoked';
  end if;
end $$;

-- Verify-vs-suspend race, defence in depth: a session that slipped in around a
-- suspend or revoke must not come back to life when the partner is restored,
-- re-invited, and accepts again.
do $$ begin
  perform set_config('role', 'postgres', true);
  insert into portal_sessions (org_id, portal_user_id, token_hash, expires_at) values
    ('00000000-0000-0000-0000-000000000fa1', 'fa1b0000-0000-0000-0000-000000000001', encode(extensions.digest('ia-sess-race', 'sha256'), 'hex'), now() + interval '1 day');
  perform _t_act('fa100000-0000-0000-0000-000000000002');
  if public.portal_set_access('fa1a0000-0000-0000-0000-000000000001', 'invited') is distinct from 'invited' then
    raise exception 'restore after revoke should return invited';
  end if;
end $$;

do $$ declare v_inv text; v_ver int; v_new text; n int; begin
  perform set_config('role', 'postgres', true);
  select invite_token into v_inv from public.portal_create_invite('fa1a0000-0000-0000-0000-000000000001', 'fa100000-0000-0000-0000-000000000002');
  select partner_terms_version into v_ver from organizations where id = '00000000-0000-0000-0000-000000000fa1';
  select session_token into v_new from public.portal_accept_invite('portal-ia', v_inv, v_ver, null, null);
  select count(*) into n from public.portal_session_lookup('portal-ia', v_new);
  if n <> 1 then raise exception 'the new session from accept should resolve'; end if;
  foreach v_inv in array array['ia-sess-1', 'ia-sess-2', 'ia-sess-race'] loop
    select count(*) into n from public.portal_session_lookup('portal-ia', v_inv);
    if n <> 0 then raise exception 'pre-suspend session % must stay dead after re-invite and accept', v_inv; end if;
  end loop;
end $$;

rollback;
