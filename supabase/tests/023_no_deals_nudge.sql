-- Tests for migration 20260825000005_org_no_deals_nudge.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/023_no_deals_nudge.sql
--
-- Self-cleans via ROLLBACK. Verifies orgs_needing_no_deals_nudge() returns
-- exactly the orgs that should get an activation nudge, and excludes each other
-- kind for exactly one reason (has a deal / demo / disabled / too new / already
-- nudged). Every org is given an active administrator, so the ONLY thing that
-- varies between them is the exclusion reason under test. Also asserts the
-- function is NOT callable by the `authenticated` role (it returns admin emails
-- across orgs and must never be reachable from the browser).
--
-- Runs as the (superuser) test role, which mirrors the service_role cron:
-- BYPASSRLS + execute allowed, so it sees every candidate org.

begin;

insert into organizations (id, name, slug, invite_code, is_disabled, created_at) values
  ('ea000000-0000-0000-0000-000000000001', 'Needs',    'nd-needs',    'nd-needs-cc',    false, now() - interval '10 days'),
  ('ea000000-0000-0000-0000-000000000002', 'HasDeal',  'nd-hasdeal',  'nd-hasdeal-cc',  false, now() - interval '10 days'),
  ('ea000000-0000-0000-0000-000000000003', 'Demo',     'nd-demo',     'nd-demo-cc',     false, now() - interval '10 days'),
  ('ea000000-0000-0000-0000-000000000004', 'Disabled', 'nd-disabled', 'nd-disabled-cc', true,  now() - interval '10 days'),
  ('ea000000-0000-0000-0000-000000000005', 'TooNew',   'nd-toonew',   'nd-toonew-cc',   false, now() - interval '1 day'),
  ('ea000000-0000-0000-0000-000000000006', 'Nudged',   'nd-nudged',   'nd-nudged-cc',   false, now() - interval '10 days');

update organizations set no_deals_nudged_at = now() where id = 'ea000000-0000-0000-0000-000000000006';

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('ad000000-0000-0000-0000-000000000001', 'admin1@nd.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('ad000000-0000-0000-0000-000000000002', 'admin2@nd.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('ad000000-0000-0000-0000-000000000003', 'admin3@nd.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('ad000000-0000-0000-0000-000000000004', 'admin4@nd.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('ad000000-0000-0000-0000-000000000005', 'admin5@nd.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('ad000000-0000-0000-0000-000000000006', 'admin6@nd.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('ad000000-0000-0000-0000-000000000001', 'ea000000-0000-0000-0000-000000000001', 'admin', 'administrator', 'Admin1', 'admin1@nd.example', 'a1'::ltree),
  ('ad000000-0000-0000-0000-000000000002', 'ea000000-0000-0000-0000-000000000002', 'admin', 'administrator', 'Admin2', 'admin2@nd.example', 'a2'::ltree),
  ('ad000000-0000-0000-0000-000000000003', 'ea000000-0000-0000-0000-000000000003', 'admin', 'administrator', 'Admin3', 'admin3@nd.example', 'a3'::ltree),
  ('ad000000-0000-0000-0000-000000000004', 'ea000000-0000-0000-0000-000000000004', 'admin', 'administrator', 'Admin4', 'admin4@nd.example', 'a4'::ltree),
  ('ad000000-0000-0000-0000-000000000005', 'ea000000-0000-0000-0000-000000000005', 'admin', 'administrator', 'Admin5', 'admin5@nd.example', 'a5'::ltree),
  ('ad000000-0000-0000-0000-000000000006', 'ea000000-0000-0000-0000-000000000006', 'admin', 'administrator', 'Admin6', 'admin6@nd.example', 'a6'::ltree);

-- HasDeal: one deal makes it "activated" -> excluded.
insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('de000000-0000-0000-0000-000000000001', 'ea000000-0000-0000-0000-000000000002', 'ad000000-0000-0000-0000-000000000002',
   'HasDeal Co', 'C', 'c@nd.example', '+15550000000', 1000);

-- Demo: demo_reset enabled -> excluded.
insert into org_features (org_id, feature_key, enabled) values
  ('ea000000-0000-0000-0000-000000000003', 'demo_reset', true);

-- ── Only the Needs org is a candidate; its admin email comes back. ──
do $$
declare n int; emails text[];
begin
  select count(*) into n from orgs_needing_no_deals_nudge(3);
  if n <> 1 then raise exception 'expected exactly 1 candidate, got %', n; end if;

  select admin_emails into emails from orgs_needing_no_deals_nudge(3)
   where org_id = 'ea000000-0000-0000-0000-000000000001';
  if emails is null then raise exception 'Needs org should be the single candidate'; end if;
  if not ('admin1@nd.example' = any(emails)) then
    raise exception 'candidate admin_emails should include admin1, got %', emails;
  end if;
end $$;

-- ── Stamping no_deals_nudged_at drops an org out (one nudge per org). ──
do $$
declare n int;
begin
  update organizations set no_deals_nudged_at = now() where id = 'ea000000-0000-0000-0000-000000000001';
  select count(*) into n from orgs_needing_no_deals_nudge(3);
  if n <> 0 then raise exception 'nudged org should no longer be a candidate, got % candidates', n; end if;
end $$;

-- ── The function is NOT executable by anon/authenticated (it returns admin
--    emails across orgs), but IS by the service_role cron. Asserted via the
--    catalog rather than by switching session roles. ──
do $$
begin
  if has_function_privilege('authenticated', 'public.orgs_needing_no_deals_nudge(int)', 'EXECUTE') then
    raise exception 'authenticated must NOT have EXECUTE on orgs_needing_no_deals_nudge';
  end if;
  if has_function_privilege('anon', 'public.orgs_needing_no_deals_nudge(int)', 'EXECUTE') then
    raise exception 'anon must NOT have EXECUTE on orgs_needing_no_deals_nudge';
  end if;
  if not has_function_privilege('service_role', 'public.orgs_needing_no_deals_nudge(int)', 'EXECUTE') then
    raise exception 'service_role (the cron) MUST have EXECUTE on orgs_needing_no_deals_nudge';
  end if;
end $$;

rollback;
