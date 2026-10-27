-- Tests for 20261028000002_portal_referral_value (FR-PORT-71, 11.2).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/070_portal_referral_value.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only function).
--
-- The closed value shows on the referral's own page only when the referral is
-- Closed Won AND the ISO allows partners to see values.
--   W won, linked deal $7,000     H won on an org that hides values
--   S still submitted, has a deal  X won, but another partner's referral

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, partner_value_visibility) values
  ('00000000-0000-0000-0000-000000001070', 'Value Org',  'portal-val',  'portal-val-a1', true, true),
  ('00000000-0000-0000-0000-000000002070', 'Hidden Org', 'portal-hide', 'portal-hide-a1', true, false);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0700000-0000-0000-0000-000000000001', 'rita@val.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0700000-0000-0000-0000-000000000002', 'hank@hide.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('a0700000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001070', 'admin', 'administrator', 'Rita', 'rita@val.example',  'va'::ltree),
  ('a0700000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000002070', 'admin', 'administrator', 'Hank', 'hank@hide.example', 'hi'::ltree);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a070a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001070', 'a0700000-0000-0000-0000-000000000001', 'a0700000-0000-0000-0000-000000000001', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@val.example'),
  ('a070a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001070', 'a0700000-0000-0000-0000-000000000001', 'a0700000-0000-0000-0000-000000000001', 'Other CPA', 'Other & Co', 'cpa', 'other@val.example'),
  ('a070a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000002070', 'a0700000-0000-0000-0000-000000000002', 'a0700000-0000-0000-0000-000000000002', 'Hal CPA', 'Hal & Co', 'cpa', 'hal@hide.example');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a070d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001070', 'a0700000-0000-0000-0000-000000000001', 'Won Co',    '1 A St', 'W', 'w@val.example', '5550700001', 700000, 'won',     'partner_referral'),
  ('a070d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001070', 'a0700000-0000-0000-0000-000000000001', 'Open Co',   '2 A St', 'W', 'o@val.example', '5550700002', 500000, 'new', 'partner_referral'),
  ('a070d000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001070', 'a0700000-0000-0000-0000-000000000001', 'Other Co',  '3 A St', 'W', 'x@val.example', '5550700003', 900000, 'won',     'partner_referral'),
  ('a070d000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000002070', 'a0700000-0000-0000-0000-000000000002', 'Hidden Co', '4 A St', 'W', 'h@hide.example', '5550700004', 400000, 'won',    'partner_referral');

insert into referrals (
  id, org_id, partner_id, direction, source, status, company_name, deal_id, assigned_user_id, submitted_at
) values
  ('a070f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001070', 'a070a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'won',     'Won Co',    'a070d000-0000-0000-0000-000000000001', 'a0700000-0000-0000-0000-000000000001', now() - interval '10 days'),
  ('a070f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001070', 'a070a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'working', 'Open Co',   'a070d000-0000-0000-0000-000000000002', 'a0700000-0000-0000-0000-000000000001', now() - interval '10 days'),
  ('a070f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001070', 'a070a000-0000-0000-0000-000000000002', 'inbound', 'rep_entered', 'won',     'Other Co',  'a070d000-0000-0000-0000-000000000003', 'a0700000-0000-0000-0000-000000000001', now() - interval '10 days'),
  ('a070f000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000002070', 'a070a000-0000-0000-0000-000000000003', 'inbound', 'rep_entered', 'won',     'Hidden Co', 'a070d000-0000-0000-0000-000000000004', 'a0700000-0000-0000-0000-000000000002', now() - interval '10 days');

do $$ declare v bigint; begin
  -- won + visible -> the deal value
  v := public.portal_referral_value('00000000-0000-0000-0000-000000001070', 'a070a000-0000-0000-0000-000000000001', 'a070f000-0000-0000-0000-000000000001');
  if v is distinct from 700000 then raise exception 'won+visible must return the value, got %', v; end if;

  -- won + ISO hides values -> null
  v := public.portal_referral_value('00000000-0000-0000-0000-000000002070', 'a070a000-0000-0000-0000-000000000003', 'a070f000-0000-0000-0000-000000000004');
  if v is not null then raise exception 'won+hidden must be null, got %', v; end if;

  -- not won -> null even with a deal value
  v := public.portal_referral_value('00000000-0000-0000-0000-000000001070', 'a070a000-0000-0000-0000-000000000001', 'a070f000-0000-0000-0000-000000000002');
  if v is not null then raise exception 'not won must be null, got %', v; end if;

  -- another partner's referral -> null
  v := public.portal_referral_value('00000000-0000-0000-0000-000000001070', 'a070a000-0000-0000-0000-000000000001', 'a070f000-0000-0000-0000-000000000003');
  if v is not null then raise exception 'other partner referral must be null, got %', v; end if;

  -- wrong org for the referral -> null
  v := public.portal_referral_value('00000000-0000-0000-0000-000000002070', 'a070a000-0000-0000-0000-000000000001', 'a070f000-0000-0000-0000-000000000001');
  if v is not null then raise exception 'cross-org must be null, got %', v; end if;

  -- a purged won referral keeps its value
  update referrals set purged_at = now() where id = 'a070f000-0000-0000-0000-000000000001';
  v := public.portal_referral_value('00000000-0000-0000-0000-000000001070', 'a070a000-0000-0000-0000-000000000001', 'a070f000-0000-0000-0000-000000000001');
  if v is distinct from 700000 then raise exception 'purged won keeps its value, got %', v; end if;

  -- service_role only
  if has_function_privilege('authenticated', 'public.portal_referral_value(uuid,uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.portal_referral_value(uuid,uuid,uuid)', 'execute') then
    raise exception 'portal_referral_value must be service_role only';
  end if;
  if not has_function_privilege('service_role', 'public.portal_referral_value(uuid,uuid,uuid)', 'execute') then
    raise exception 'service_role must be able to execute portal_referral_value';
  end if;
end $$;

rollback;
