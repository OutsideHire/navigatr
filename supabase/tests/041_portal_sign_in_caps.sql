-- Tests for 20261012000001 + 20261012000002 (Partner Portal Phase 1B sign-in caps).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/041_portal_sign_in_caps.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- Fixture (org portal-cap, portal enabled):
--   U1 daily@example.com  active  (19 codes already issued 2 to 3 hours ago)
--   U2 fail@example.com   active  (failed sign-in audit)

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001041', 'Portal Cap Org', 'portal-cap', 'portal-cap-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0410000-0000-0000-0000-000000000001', 'boss@cap.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('a0410000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001041', 'admin', 'administrator', 'Boss', 'boss@cap.example', 'capboss'::ltree);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a041a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001041', 'a0410000-0000-0000-0000-000000000001', 'a0410000-0000-0000-0000-000000000001', 'Daily CPA', 'D & Co', 'cpa', 'daily@example.com'),
  ('a041a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001041', 'a0410000-0000-0000-0000-000000000001', 'a0410000-0000-0000-0000-000000000001', 'Fail CPA',  'F & Co', 'cpa', 'fail@example.com');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a041b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001041', 'a041a000-0000-0000-0000-000000000001', 'daily@example.com', 'active'),
  ('a041b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001041', 'a041a000-0000-0000-0000-000000000002', 'fail@example.com',  'active');

-- 19 codes in the last 24 hours, all older than one hour so the hourly cap is not in play.
insert into portal_tokens (org_id, portal_user_id, token_type, token_hash, issued_at, expires_at)
select '00000000-0000-0000-0000-000000001041', 'a041b000-0000-0000-0000-000000000001', 'sign_in_code',
       'old-' || g, now() - interval '2 hours' - (g || ' minutes')::interval, now() - interval '1 hour'
  from generate_series(1, 19) g;

-- New enum values exist.
do $$ begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'portal_audit_action' and e.enumlabel = 'sign_in_failed') then
    raise exception 'portal_audit_action should have sign_in_failed';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'portal_audit_action' and e.enumlabel = 'dup_check') then
    raise exception 'portal_audit_action should have dup_check';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'portal_audit_action' and e.enumlabel = 'transcribe') then
    raise exception 'portal_audit_action should have transcribe';
  end if;
end $$;

-- Privileges survive the replacement.
do $$ declare f text; begin
  foreach f in array array[
    'public.portal_issue_code(text, text, text)',
    'public.portal_verify_code(text, text, text, text, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
end $$;

-- Daily cap: the 20th code in 24 hours is issued, the 21st is not.
do $$ declare r record; n int; begin
  select * into r from public.portal_issue_code('portal-cap', 'daily@example.com', '10.41.0.1');
  if r.code is null then raise exception 'the 20th code within 24 hours should be issued'; end if;
  select count(*) into n from public.portal_issue_code('portal-cap', 'daily@example.com', '10.41.0.1');
  if n <> 0 then raise exception 'a 21st code within 24 hours must be refused'; end if;
end $$;

-- A code older than 24 hours stops counting.
do $$ declare n int; begin
  update portal_tokens set issued_at = now() - interval '25 hours'
   where portal_user_id = 'a041b000-0000-0000-0000-000000000001' and token_hash = 'old-1';
  select count(*) into n from public.portal_issue_code('portal-cap', 'daily@example.com', '10.41.0.1');
  if n <> 1 then raise exception 'a code older than 24 hours should free a slot'; end if;
end $$;

-- Failed verify writes sign_in_failed; success writes none.
do $$ declare n int; r record; begin
  perform public.portal_verify_code('portal-cap', 'fail@example.com', '000000', '10.41.0.2', 'ua');
  select count(*) into n from portal_audit_log
   where action = 'sign_in_failed' and portal_user_id = 'a041b000-0000-0000-0000-000000000002'
     and org_id = '00000000-0000-0000-0000-000000001041' and ip = '10.41.0.2';
  if n <> 1 then raise exception 'a wrong code should write one sign_in_failed row, got %', n; end if;

  perform public.portal_verify_code('portal-cap', 'ghost@example.com', '123456', '10.41.0.3', 'ua');
  select count(*) into n from portal_audit_log
   where action = 'sign_in_failed' and portal_user_id is null
     and org_id = '00000000-0000-0000-0000-000000001041' and ip = '10.41.0.3';
  if n <> 1 then raise exception 'an unknown email should write one sign_in_failed row with no portal user'; end if;

  select count(*) into n from portal_audit_log where action = 'sign_in_failed';
  perform public.portal_verify_code('no-such-portal', 'fail@example.com', '123456', '10.41.0.4', 'ua');
  if (select count(*) from portal_audit_log where action = 'sign_in_failed') <> n then
    raise exception 'an unknown portal has no tenant to audit against and must write nothing';
  end if;

  select * into r from public.portal_issue_code('portal-cap', 'fail@example.com', '10.41.0.5');
  perform public.portal_verify_code('portal-cap', 'fail@example.com', r.code, '10.41.0.5', 'ua');
  if exists (select 1 from portal_audit_log where action = 'sign_in_failed' and ip = '10.41.0.5') then
    raise exception 'a successful sign-in must not write sign_in_failed';
  end if;
  if not exists (select 1 from portal_audit_log where action = 'sign_in' and portal_user_id = 'a041b000-0000-0000-0000-000000000002') then
    raise exception 'a successful sign-in should still audit sign_in';
  end if;
end $$;

rollback;
