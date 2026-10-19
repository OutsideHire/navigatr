-- Tests for 20261020000001_public_form_switch (Partner Portal Phase 2B-2, FR-PORT-28).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/059_public_form_switch.sql
-- Self-cleans via ROLLBACK.
--
-- Org A pf-switch (portal on): boss administrator, rita rep under boss.
-- Org B pf-switch-b (portal off): bob administrator.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001059', 'Switch Org',   'pf-switch',   'pf-switch-a1',   true),
  ('00000000-0000-0000-0000-000000001159', 'Switch Org B', 'pf-switch-b', 'pf-switch-b-a1', false);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0590000-0000-0000-0000-000000000001', 'boss@switch.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0590000-0000-0000-0000-000000000002', 'rita@switch.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0590000-0000-0000-0000-000000000003', 'bob@switchb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0590000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001059', 'admin', 'administrator',      'Boss',     'boss@switch.example', 'swboss'::ltree,      null),
  ('a0590000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001059', 'rep',   'sales_professional', 'Rita Rep', 'rita@switch.example', 'swboss.rita'::ltree, 'a0590000-0000-0000-0000-000000000001'),
  ('a0590000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001159', 'admin', 'administrator',      'Bob',      'bob@switchb.example', 'swbob'::ltree,       null);

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

-- 1. Privileges (before any role switch).
do $$ begin
  if not has_function_privilege('authenticated', 'public.set_public_form_enabled(boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_public_form_enabled(boolean)', 'EXECUTE') then
    raise exception 'set_public_form_enabled is for signed-in users only';
  end if;
  if not has_function_privilege('authenticated', 'public.get_portal_settings()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_portal_settings(boolean, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_portal_settings()', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_portal_settings(boolean, text, text, boolean)', 'EXECUTE') then
    raise exception 're-created settings RPCs keep their grants';
  end if;
end $$;

-- 2. An administrator turns the form on; saving the portal settings keeps it;
--    turning the portal off keeps the value but closes the form.
do $$ declare r record; begin
  perform _t_act('a0590000-0000-0000-0000-000000000001');
  select * into r from public.get_portal_settings();
  if r.public_form_enabled is distinct from false then raise exception 'the public form defaults to off'; end if;

  select * into r from public.set_public_form_enabled(true);
  if r.public_form_enabled is distinct from true or r.enabled is distinct from true then
    raise exception 'switch on should read back on, got %', row_to_json(r);
  end if;
  select * into r from public.get_my_referral_link();
  if r.link_token is null or r.public_form_enabled is distinct from true then
    raise exception 'links open once the form is on';
  end if;

  select * into r from public.update_portal_settings(true, null, null, false);
  if r.public_form_enabled is distinct from true then
    raise exception 'saving the portal settings keeps the public form switch';
  end if;

  select * into r from public.update_portal_settings(false, null, null, false);
  if r.public_form_enabled is distinct from true or r.enabled is distinct from false then
    raise exception 'turning the portal off keeps the stored switch, got %', row_to_json(r);
  end if;
  select * into r from public.get_my_referral_link();
  if r.link_token is not null or r.public_form_enabled then
    raise exception 'the form is closed while the portal is off';
  end if;

  perform _t_raises('select * from public.set_public_form_enabled(true)', 'portal_disabled');
  select * into r from public.set_public_form_enabled(false);
  if r.public_form_enabled is distinct from false then raise exception 'off always works'; end if;
  select * into r from public.update_portal_settings(true, null, null, false);
  select * into r from public.set_public_form_enabled(null);
  if r.public_form_enabled is distinct from false then raise exception 'null means off'; end if;
  perform set_config('role', 'postgres', true);
end $$;

-- 3. Administrators only, and only their own org.
do $$ begin
  perform _t_act('a0590000-0000-0000-0000-000000000002');
  perform _t_raises('select * from public.set_public_form_enabled(true)', 'not_authorized');
  perform _t_act('a0590000-0000-0000-0000-000000000003');
  perform _t_raises('select * from public.set_public_form_enabled(true)', 'portal_disabled');
  perform set_config('role', 'postgres', true);
  if (select public_form_enabled from organizations where id = '00000000-0000-0000-0000-000000001159') then
    raise exception 'org B must stay off';
  end if;
  if (select public_form_enabled from organizations where id = '00000000-0000-0000-0000-000000001059') then
    raise exception 'org A ended off';
  end if;
end $$;

-- 4. Own org only, meaningfully: with org A on, bob (org B administrator)
--    turning his own form off never touches org A.
do $$ declare r record; begin
  update organizations set public_form_enabled = true where id = '00000000-0000-0000-0000-000000001059';
  perform _t_act('a0590000-0000-0000-0000-000000000003');
  select * into r from public.set_public_form_enabled(false);
  perform set_config('role', 'postgres', true);
  if r.public_form_enabled is distinct from false then raise exception 'bob reads his own org back off'; end if;
  if not (select public_form_enabled from organizations where id = '00000000-0000-0000-0000-000000001059') then
    raise exception 'org A must stay on after bob switches his own form off';
  end if;
  if (select public_form_enabled from organizations where id = '00000000-0000-0000-0000-000000001159') then
    raise exception 'org B stays off';
  end if;
end $$;

rollback;
