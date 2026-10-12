-- Tests for 20261016000007_portal_profile (Partner Portal Phase 2A, FR-PORT-19).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/056_portal_profile.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org portal-profile): boss administrator; rita rep and rob rep in
-- separate branches. Partner P1 (Jane CPA, owner rita) with active portal user
-- PU1; partner P2 (Kim CPA, owner rita) with suspended portal user PU2. Org B
-- portal-profile-b: bob.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001056', 'Profile Org',   'portal-profile',   'portal-profile-a1',   true),
  ('00000000-0000-0000-0000-000000001156', 'Profile Org B', 'portal-profile-b', 'portal-profile-b-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0560000-0000-0000-0000-000000000001', 'boss@pf.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0560000-0000-0000-0000-000000000002', 'rita@pf.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0560000-0000-0000-0000-000000000003', 'rob@pf.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0560000-0000-0000-0000-000000000004', 'bob@pfb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0560000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001056', 'admin', 'administrator',      'Boss',     'boss@pf.example', 'pfboss'::ltree,      null),
  ('a0560000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001056', 'rep',   'sales_professional', 'Rita Rep', 'rita@pf.example', 'pfboss.rita'::ltree, 'a0560000-0000-0000-0000-000000000001'),
  ('a0560000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001056', 'rep',   'sales_professional', 'Rob Rep',  'rob@pf.example',  'pfboss.rob'::ltree,  'a0560000-0000-0000-0000-000000000001'),
  ('a0560000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001156', 'admin', 'administrator',      'Bob',      'bob@pfb.example', 'pfbob'::ltree,       null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email, phone) values
  ('a056a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001056', 'a0560000-0000-0000-0000-000000000002', 'a0560000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@pf.example', '5550561111'),
  ('a056a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001056', 'a0560000-0000-0000-0000-000000000002', 'a0560000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@pf.example',  null);

insert into portal_users (id, org_id, partner_id, email, status, notification_prefs) values
  ('a056b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'jane@pf.example', 'active',    '{}'),
  ('a056b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000002', 'kim@pf.example',  'suspended', '{}');

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

create or replace function _t_change_rows(p_user uuid) returns int language plpgsql as $$
declare n int;
begin
  perform _t_act(p_user);
  select count(*) into n from partner_profile_changes;
  return n;
end $$;

-- 1. Privileges (before any role switch).
do $$ begin
  if has_function_privilege('authenticated', 'public.portal_get_profile(uuid, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_get_profile(uuid, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.portal_update_profile(uuid, uuid, uuid, text, text, boolean, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_update_profile(uuid, uuid, uuid, text, text, boolean, text)', 'EXECUTE') then
    raise exception 'profile functions must be service role only';
  end if;
  if not has_function_privilege('service_role', 'public.portal_update_profile(uuid, uuid, uuid, text, text, boolean, text)', 'EXECUTE') then
    raise exception 'service_role should execute portal_update_profile';
  end if;
  if has_table_privilege('authenticated', 'public.partner_profile_changes', 'INSERT')
     or has_table_privilege('authenticated', 'public.partner_profile_changes', 'UPDATE')
     or has_table_privilege('authenticated', 'public.partner_profile_changes', 'DELETE')
     or not has_table_privilege('authenticated', 'public.partner_profile_changes', 'SELECT')
     or has_table_privilege('anon', 'public.partner_profile_changes', 'SELECT') then
    raise exception 'partner_profile_changes: authenticated reads only, anon nothing';
  end if;
end $$;

-- 2. Read, save, and the change log (as postgres, like portal_api).
do $$ declare p record; n int; begin
  select * into p from public.portal_get_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001');
  if p.name <> 'Jane CPA' or p.phone <> '5550561111' or p.email <> 'jane@pf.example' or not p.weekly_digest then
    raise exception 'profile read wrong: %', row_to_json(p);
  end if;

  select * into p from public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', '  Jane Smith ', '  ', false, '203.0.113.5');
  if p.name <> 'Jane Smith' or p.phone is not null or p.weekly_digest then
    raise exception 'profile save result wrong: %', row_to_json(p);
  end if;
  if not exists (select 1 from partners where id = 'a056a000-0000-0000-0000-000000000001' and name = 'Jane Smith' and phone is null) then
    raise exception 'the partner record should carry the new name and no phone';
  end if;
  if (select notification_prefs from portal_users where id = 'a056b000-0000-0000-0000-000000000001') <> '{"digest": false}'::jsonb then
    raise exception 'weekly email preference not stored';
  end if;
  if (select email from portal_users where id = 'a056b000-0000-0000-0000-000000000001') <> 'jane@pf.example' then
    raise exception 'the sign-in email never changes here';
  end if;
  if not exists (select 1 from partner_profile_changes where partner_id = 'a056a000-0000-0000-0000-000000000001'
                  and field = 'name' and old_value = 'Jane CPA' and new_value = 'Jane Smith'
                  and portal_user_id = 'a056b000-0000-0000-0000-000000000001') then
    raise exception 'name change not logged';
  end if;
  if not exists (select 1 from partner_profile_changes where partner_id = 'a056a000-0000-0000-0000-000000000001'
                  and field = 'phone' and old_value = '5550561111' and new_value is null) then
    raise exception 'phone change not logged';
  end if;
  select count(*) into n from portal_audit_log where portal_user_id = 'a056b000-0000-0000-0000-000000000001' and action = 'profile_update' and ip = '203.0.113.5';
  if n <> 1 then raise exception 'profile saves are audited, got %', n; end if;

  -- Saving the same values logs nothing new.
  perform * from public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', 'Jane Smith', null, false, null);
  select count(*) into n from partner_profile_changes where partner_id = 'a056a000-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'an unchanged save logs nothing, got % rows', n; end if;

  -- A phone in any format with enough digits; the weekly email back on (null means on).
  select * into p from public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', 'Jane Smith', '(555) 056-2222', null, null);
  if p.phone <> '(555) 056-2222' or not p.weekly_digest then raise exception 'phone or preference not saved: %', row_to_json(p); end if;
  select count(*) into n from partner_profile_changes where partner_id = 'a056a000-0000-0000-0000-000000000001';
  if n <> 3 then raise exception 'phone change logged once, got % rows', n; end if;

  -- A preference that is not a JSON boolean reads as on.
  update portal_users set notification_prefs = '{"digest": "yes"}' where id = 'a056b000-0000-0000-0000-000000000001';
  select * into p from public.portal_get_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001');
  if not p.weekly_digest then raise exception 'a malformed preference reads as on'; end if;
end $$;

-- 3. Field rules and scope.
do $$ begin
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', '   ', null, true, null)$q$, 'invalid_input:name');
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', repeat('a', 121), null, true, null)$q$, 'invalid_input:name');
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', 'Jane', repeat('5', 41), true, null)$q$, 'invalid_input:phone');
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', 'Jane', 'call me', true, null)$q$, 'invalid_input:phone');
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000002', 'a056b000-0000-0000-0000-000000000001', 'Kim', null, true, null)$q$, 'not_authorized');
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000002', 'a056b000-0000-0000-0000-000000000002', 'Kim', null, true, null)$q$, 'not_authorized');
  perform _t_raises($q$select public.portal_get_profile('00000000-0000-0000-0000-000000001156', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001')$q$, 'not_authorized');
end $$;

-- 4. Reps read the change log through partner visibility (role switches here).
do $$ begin
  if _t_change_rows('a0560000-0000-0000-0000-000000000002') <> 3 then raise exception 'rita sees the 3 changes on her partner'; end if;
  if _t_change_rows('a0560000-0000-0000-0000-000000000001') <> 3 then raise exception 'an admin sees them'; end if;
  if _t_change_rows('a0560000-0000-0000-0000-000000000003') <> 0 then raise exception 'rob in another branch sees nothing'; end if;
  if _t_change_rows('a0560000-0000-0000-0000-000000000004') <> 0 then raise exception 'another org sees nothing'; end if;
end $$;

-- 5. Twenty saves an hour, then rate_limited.
do $$ begin
  perform set_config('role', 'postgres', true);
  insert into portal_audit_log (org_id, portal_user_id, action)
  select '00000000-0000-0000-0000-000000001056', 'a056b000-0000-0000-0000-000000000001', 'profile_update'
    from generate_series(1, 20);
  perform _t_raises($q$select public.portal_update_profile('00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001', 'Jane', null, true, null)$q$, 'rate_limited');
end $$;

-- 6. Erase (controller ruling D2): portal_purge_user also clears the partner's
-- change-log values and the partner name in every queued email payload.
do $$ declare n int; begin
  perform set_config('role', 'postgres', true);
  insert into referrals (id, org_id, partner_id, direction, source, status, company_name, partner_company_snapshot, assigned_user_id, submitted_by_portal_user_id, submitted_at)
  values ('a056f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001056', 'a056a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Acme', 'Jane & Co', 'a0560000-0000-0000-0000-000000000002', 'a056b000-0000-0000-0000-000000000001', now());
  insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, payload, dedupe_key) values
    ('00000000-0000-0000-0000-000000001056', 'partner_received', 'a056f000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001',
     jsonb_build_object('companyName', 'Acme', 'partnerName', 'Jane Smith'), 't056:pending'),
    ('00000000-0000-0000-0000-000000001056', 'partner_received', 'a056f000-0000-0000-0000-000000000001', 'a056b000-0000-0000-0000-000000000001',
     jsonb_build_object('companyName', 'Acme'), 't056:nokey');
  perform _t_act('a0560000-0000-0000-0000-000000000001');
  perform public.portal_purge_user('a056a000-0000-0000-0000-000000000001');
  perform set_config('role', 'postgres', true);
  select count(*) into n from partner_profile_changes
   where partner_id = 'a056a000-0000-0000-0000-000000000001'
     and (old_value is not null or new_value is not null);
  if n <> 0 then raise exception 'purge must clear change-log values, % rows keep them', n; end if;
  select count(*) into n from partner_profile_changes where partner_id = 'a056a000-0000-0000-0000-000000000001';
  if n <> 3 then raise exception 'change-log rows are kept for audit, got %', n; end if;
  select count(*) into n from portal_email_outbox
   where portal_user_id = 'a056b000-0000-0000-0000-000000000001'
     and payload ? 'partnerName' and jsonb_typeof(payload -> 'partnerName') <> 'null';
  if n <> 0 then raise exception 'purge must null partnerName in every payload, % keep it', n; end if;
  if (select payload ->> 'companyName' from portal_email_outbox where dedupe_key = 't056:pending') <> 'Acme' then
    raise exception 'other payload fields are untouched';
  end if;
  if exists (select 1 from portal_email_outbox where dedupe_key = 't056:nokey' and payload ? 'partnerName') then
    raise exception 'a payload without partnerName must not gain the key';
  end if;
end $$;

rollback;
