-- Tests for 20261009000001_portal_access_schema (Partner Portal Phase 1A).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/037_portal_schema_settings.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org PS, slug portal-set): boss administrator, rep sales_professional.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-000000000f71', 'Portal Settings Org', 'portal-set', 'portal-set-a1');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('f7100000-0000-0000-0000-000000000001', 'boss@ps.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('f7100000-0000-0000-0000-000000000002', 'rep@ps.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('f7100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000f71', 'admin', 'administrator',      'Boss', 'boss@ps.example', 'boss'::ltree,     null),
  ('f7100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000f71', 'rep',   'sales_professional', 'Rep',  'rep@ps.example',  'boss.rep'::ltree, 'f7100000-0000-0000-0000-000000000001');

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Runs p_sql and asserts it raises an error whose message contains p_token.
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

-- New organization columns default to off and empty.
do $$ declare o organizations; begin
  select * into o from organizations where id = '00000000-0000-0000-0000-000000000f71';
  if o.portal_enabled or o.partner_value_visibility then raise exception 'portal flags should default to false'; end if;
  if o.partner_terms_text is not null or o.consent_text is not null then raise exception 'portal texts should default to null'; end if;
  if o.partner_terms_version is distinct from 0 or o.consent_version is distinct from 0 then raise exception 'portal versions should default to 0'; end if;
end $$;

-- Table privileges and RLS.
do $$ declare t text; begin
  foreach t in array array['public.portal_users','public.portal_tokens','public.portal_sessions','public.portal_audit_log'] loop
    if has_any_column_privilege('anon', t, 'SELECT') or has_table_privilege('anon', t, 'INSERT')
       or has_table_privilege('anon', t, 'UPDATE') or has_table_privilege('anon', t, 'DELETE') then
      raise exception 'anon must have no access to %', t;
    end if;
    if has_table_privilege('authenticated', t, 'INSERT') or has_table_privilege('authenticated', t, 'UPDATE')
       or has_table_privilege('authenticated', t, 'DELETE') then
      raise exception 'authenticated must not write %', t;
    end if;
  end loop;
  foreach t in array array['public.portal_tokens','public.portal_sessions','public.portal_audit_log'] loop
    if has_any_column_privilege('authenticated', t, 'SELECT') then
      raise exception 'authenticated must not read %', t;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.portal_users', 'status', 'SELECT') then
    raise exception 'authenticated should read portal_users.status';
  end if;
  if not has_column_privilege('authenticated', 'public.portal_users', 'last_login_at', 'SELECT') then
    raise exception 'authenticated should read portal_users.last_login_at';
  end if;
  if has_column_privilege('authenticated', 'public.portal_users', 'email', 'SELECT') then
    raise exception 'authenticated must not read portal_users.email';
  end if;
  if has_column_privilege('authenticated', 'public.portal_users', 'terms_ip', 'SELECT') then
    raise exception 'authenticated must not read portal_users.terms_ip';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public'
                and c.relname in ('portal_users','portal_tokens','portal_sessions','portal_audit_log')
                and not c.relrowsecurity) then
    raise exception 'RLS must be enabled on every portal table';
  end if;
end $$;

-- Function privileges.
do $$ begin
  if has_function_privilege('anon', 'public.get_portal_settings()', 'EXECUTE') then raise exception 'anon must not execute get_portal_settings'; end if;
  if has_function_privilege('anon', 'public.update_portal_settings(boolean, text, text, boolean)', 'EXECUTE') then raise exception 'anon must not execute update_portal_settings'; end if;
  if not has_function_privilege('authenticated', 'public.get_portal_settings()', 'EXECUTE') then raise exception 'authenticated should execute get_portal_settings'; end if;
  if not has_function_privilege('authenticated', 'public.update_portal_settings(boolean, text, text, boolean)', 'EXECUTE') then raise exception 'authenticated should execute update_portal_settings'; end if;
end $$;

-- Admin flow (role switches from here on).
do $$ declare r record; begin
  perform _t_act('f7100000-0000-0000-0000-000000000001');

  select * into r from public.update_portal_settings(true, null, null, false);
  if r.enabled is distinct from true then raise exception 'portal should be enabled'; end if;
  if r.terms_text is distinct from 'By using this portal you agree to share business referrals with Portal Settings Org and to only submit contact details you have permission to share. Portal Settings Org may contact the businesses you refer.' then
    raise exception 'default terms not seeded, got %', r.terms_text;
  end if;
  if r.consent_text is distinct from 'I have permission to share this business''s contact details.' then
    raise exception 'default consent not seeded, got %', r.consent_text;
  end if;
  if r.terms_version is distinct from 1 or r.consent_version is distinct from 1 then
    raise exception 'seeding should bump both versions to 1, got % %', r.terms_version, r.consent_version;
  end if;
  if r.slug is distinct from 'portal-set' or r.org_name is distinct from 'Portal Settings Org' then
    raise exception 'slug and org name should come back, got % %', r.slug, r.org_name;
  end if;

  select * into r from public.update_portal_settings(true, r.terms_text, r.consent_text, true);
  if r.terms_version is distinct from 1 or r.consent_version is distinct from 1 then
    raise exception 'saving unchanged text must not bump versions';
  end if;
  if r.value_visibility is distinct from true then raise exception 'value visibility should save'; end if;

  select * into r from public.update_portal_settings(true, '  New terms.  ', '', true);
  if r.terms_text is distinct from 'New terms.' or r.terms_version is distinct from 2 then
    raise exception 'changed terms should be trimmed and bump to 2, got % %', r.terms_text, r.terms_version;
  end if;
  if r.consent_version is distinct from 1 then raise exception 'blank consent must keep its text and version'; end if;

  select * into r from public.update_portal_settings(false, null, 'New consent.', false);
  if r.enabled is distinct from false or r.terms_text is distinct from 'New terms.' or r.terms_version is distinct from 2 then
    raise exception 'turning off must keep the terms';
  end if;
  if r.consent_text is distinct from 'New consent.' or r.consent_version is distinct from 2 then
    raise exception 'changed consent should bump to 2';
  end if;

  select * into r from public.get_portal_settings();
  if r.consent_text is distinct from 'New consent.' or r.enabled is distinct from false then
    raise exception 'get_portal_settings should read back the saved state';
  end if;
end $$;

-- Non-admins are refused.
do $$ begin
  perform _t_act('f7100000-0000-0000-0000-000000000002');
  perform _t_raises('select * from public.update_portal_settings(true, null, null, false)', 'not_authorized');
  perform _t_raises('select * from public.get_portal_settings()', 'not_authorized');
end $$;

rollback;
