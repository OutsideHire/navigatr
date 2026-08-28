-- Cross-tenant isolation for the newer PII-adjacent tables.
--
-- Run with a service-role connection (see tools/run-db-tests.sh):
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/029_cross_org_isolation_pii.sql
--
-- Self-cleans via the wrapping transaction's rollback.
--
-- WHY (regression protocol, Phase 2). 028 covers deals/activities/profiles.
-- These three tables carry the most sensitive per-tenant data and were added
-- more recently, so they get their own cross-org guard:
--   scheduled_appointments  meeting title / location / notes
--   email_activity          captured email metadata (sender, recipients, subject)
--   deal_owner_history      the ownership audit trail
-- An admin's visibility is org-wide within their org but must stay org-BOUNDED;
-- a base-policy regression that dropped the org_id predicate would leak one
-- ISO's calendar / inbox metadata / audit trail to another and still pass CI.
--
-- Shape: two orgs, each an admin who owns a deal, an activity, an appointment,
-- an email-activity row, and an ownership-history row. We assert an admin sees
-- their own org's rows and ZERO of the other org's, for all three tables.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('cccc0000-0000-4000-8000-0000000000c0', 'Org C Payments', 'org-c-iso', 'org-c-isolation'),
  ('dddd0000-0000-4000-8000-0000000000d0', 'Org D Payments', 'org-d-iso', 'org-d-isolation');

-- Minimal auth.users (no invite_code metadata, so the signup trigger no-ops).
insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('cccc0000-0000-4000-8000-0000000000c1', 'admin_c@iso.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('dddd0000-0000-4000-8000-0000000000d1', 'admin_d@iso.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('cccc0000-0000-4000-8000-0000000000c1', 'cccc0000-0000-4000-8000-0000000000c0', 'admin', 'Admin C', 'admin_c@iso.example', null),
  ('dddd0000-0000-4000-8000-0000000000d1', 'dddd0000-0000-4000-8000-0000000000d0', 'admin', 'Admin D', 'admin_d@iso.example', null);

insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('cccc0000-0000-4000-8000-0000000000ce', 'cccc0000-0000-4000-8000-0000000000c0', 'cccc0000-0000-4000-8000-0000000000c1', 'Org C Deal', 'CC', 'cc@x.example', '+15550000301', 300000),
  ('dddd0000-0000-4000-8000-0000000000de', 'dddd0000-0000-4000-8000-0000000000d0', 'dddd0000-0000-4000-8000-0000000000d1', 'Org D Deal', 'CD', 'cd@x.example', '+15550000401', 400000);

-- Activities (explicit ids so email_activity can link one-to-one).
insert into activities (id, org_id, deal_id, logged_by, type, disposition, occurred_at, outcome_notes) values
  ('cccc0000-0000-4000-8000-0000000000ca', 'cccc0000-0000-4000-8000-0000000000c0', 'cccc0000-0000-4000-8000-0000000000ce',
   'cccc0000-0000-4000-8000-0000000000c1', 'drop_in', 'met_dm', now(), 'org C note'),
  ('dddd0000-0000-4000-8000-0000000000da', 'dddd0000-0000-4000-8000-0000000000d0', 'dddd0000-0000-4000-8000-0000000000de',
   'dddd0000-0000-4000-8000-0000000000d1', 'drop_in', 'met_dm', now(), 'org D note');

insert into scheduled_appointments (org_id, owner_id, deal_id, title, start_at, end_at) values
  ('cccc0000-0000-4000-8000-0000000000c0', 'cccc0000-0000-4000-8000-0000000000c1', 'cccc0000-0000-4000-8000-0000000000ce', 'Org C meeting', now(), now() + interval '1 hour'),
  ('dddd0000-0000-4000-8000-0000000000d0', 'dddd0000-0000-4000-8000-0000000000d1', 'dddd0000-0000-4000-8000-0000000000de', 'Org D meeting', now(), now() + interval '1 hour');

insert into email_activity (org_id, activity_id, sender_user_id, provider, provider_message_id, recipients, sent_at, subject) values
  ('cccc0000-0000-4000-8000-0000000000c0', 'cccc0000-0000-4000-8000-0000000000ca', 'cccc0000-0000-4000-8000-0000000000c1', 'outlook', 'msg-c-1', '[]'::jsonb, now(), 'Org C subject'),
  ('dddd0000-0000-4000-8000-0000000000d0', 'dddd0000-0000-4000-8000-0000000000da', 'dddd0000-0000-4000-8000-0000000000d1', 'outlook', 'msg-d-1', '[]'::jsonb, now(), 'Org D subject');

insert into deal_owner_history (deal_id, org_id, new_owner_id, effective_at) values
  ('cccc0000-0000-4000-8000-0000000000ce', 'cccc0000-0000-4000-8000-0000000000c0', 'cccc0000-0000-4000-8000-0000000000c1', now()),
  ('dddd0000-0000-4000-8000-0000000000de', 'dddd0000-0000-4000-8000-0000000000d0', 'dddd0000-0000-4000-8000-0000000000d1', now());

create or replace function _iso_pii_as_user(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Org C ADMIN: sees org C's PII rows, ZERO of org D's, for all three tables.
-- ───────────────────────────────────────────────────────────────────
do $$
declare own int; other int;
begin
  perform _iso_pii_as_user('cccc0000-0000-4000-8000-0000000000c1');

  select count(*) into own   from scheduled_appointments where org_id = 'cccc0000-0000-4000-8000-0000000000c0';
  select count(*) into other from scheduled_appointments where org_id = 'dddd0000-0000-4000-8000-0000000000d0';
  if own < 1 then raise exception 'appts: admin C should see org C appointment(s), saw %', own; end if;
  if other <> 0 then raise exception 'appts: admin C must see ZERO org D appointments, saw % (CROSS-TENANT LEAK)', other; end if;

  select count(*) into own   from email_activity where org_id = 'cccc0000-0000-4000-8000-0000000000c0';
  select count(*) into other from email_activity where org_id = 'dddd0000-0000-4000-8000-0000000000d0';
  if own < 1 then raise exception 'email: admin C should see org C email activity, saw %', own; end if;
  if other <> 0 then raise exception 'email: admin C must see ZERO org D email activity, saw % (CROSS-TENANT LEAK)', other; end if;

  select count(*) into own   from deal_owner_history where org_id = 'cccc0000-0000-4000-8000-0000000000c0';
  select count(*) into other from deal_owner_history where org_id = 'dddd0000-0000-4000-8000-0000000000d0';
  if own < 1 then raise exception 'owner-history: admin C should see org C history, saw %', own; end if;
  if other <> 0 then raise exception 'owner-history: admin C must see ZERO org D history, saw % (CROSS-TENANT LEAK)', other; end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Symmetric spot-check: Org D ADMIN sees ZERO of org C's PII rows.
-- ───────────────────────────────────────────────────────────────────
do $$
declare other int;
begin
  perform _iso_pii_as_user('dddd0000-0000-4000-8000-0000000000d1');
  select count(*) into other from scheduled_appointments where org_id = 'cccc0000-0000-4000-8000-0000000000c0';
  if other <> 0 then raise exception 'appts: admin D must see ZERO org C appointments, saw % (CROSS-TENANT LEAK)', other; end if;
  select count(*) into other from email_activity where org_id = 'cccc0000-0000-4000-8000-0000000000c0';
  if other <> 0 then raise exception 'email: admin D must see ZERO org C email activity, saw % (CROSS-TENANT LEAK)', other; end if;
  select count(*) into other from deal_owner_history where org_id = 'cccc0000-0000-4000-8000-0000000000c0';
  if other <> 0 then raise exception 'owner-history: admin D must see ZERO org C history, saw % (CROSS-TENANT LEAK)', other; end if;
end $$;

rollback;
