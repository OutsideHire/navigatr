-- Tests for 20261022000004_portal_digest (Partner Portal Phase 2B-3,
-- FR-PORT-83, 84, 85, NFR-PORT-06).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/065_portal_digest.sql
-- Self-cleans via ROLLBACK.
--
-- Clocks are fixed in January 2030 so history rows written at the real now()
-- by the status trigger never fall inside a digest week.
-- Org dg-a (portal on, values shown): boss administrator; rita rep, time zone
-- America/Los_Angeles, owns P1..P4. PU1 (P1) active; PU2 (P2) active with the
-- digest off; PU3 (P3) active, nothing happens; PU4 (P4) suspended.
-- Week 1 = 2029-12-31 to 2030-01-07 (Los Angeles), sent 2030-01-07 08:00 local.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, partner_value_visibility) values
  ('00000000-0000-0000-0000-000000001065', 'Digest Org',   'dg-a', 'dg-a-a1', true, true),
  ('00000000-0000-0000-0000-000000001165', 'Digest Org B', 'dg-b', 'dg-b-a1', true, false);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0650000-0000-0000-0000-000000000001', 'boss@dg.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0650000-0000-0000-0000-000000000002', 'rita@dg.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0650000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001065', 'admin', 'administrator',      'Boss',     'boss@dg.example', 'dgboss'::ltree,      null),
  ('a0650000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001065', 'rep',   'sales_professional', 'Rita Rep', 'rita@dg.example', 'dgboss.rita'::ltree, 'a0650000-0000-0000-0000-000000000001');

insert into path_preferences (user_id, timezone, end_of_day_minutes) values
  ('a0650000-0000-0000-0000-000000000002', 'America/Los_Angeles', null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email, phone)
select ('a065a000-0000-0000-0000-00000000000' || i)::uuid, '00000000-0000-0000-0000-000000001065',
       'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002',
       (array['Jane CPA', 'Kim CPA', 'Lee CPA', 'Max CPA'])[i], 'Co ' || i, 'cpa', 'p' || i || '@dg.example', null
  from generate_series(1, 4) i;

insert into portal_users (id, org_id, partner_id, email, status, notification_prefs) values
  ('a065b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'jane@dg.example', 'active',    '{}'),
  ('a065b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000002', 'kim@dg.example',  'active',    '{"digest": false}'),
  ('a065b000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000003', 'lee@dg.example',  'active',    '{}'),
  ('a065b000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000004', 'max@dg.example',  'suspended', '{}');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a065d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001065', 'a0650000-0000-0000-0000-000000000002', 'Beta Co', '1 A St', 'B', 'b@beta.example', '5550650001', 500000, 'contacted', 'partner_referral'),
  ('a065d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001065', 'a0650000-0000-0000-0000-000000000002', 'Zeta Co', '2 B St', 'Z', 'z@zeta.example', '5550650002', 300000, 'contacted', 'partner_referral');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, deal_id, assigned_user_id, submitted_by_user_id, submitted_at) values
  ('a065e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered', 'accepted', 'Alpha Co', null, 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2030-01-02 18:00Z'),
  ('a065e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered', 'won',      'Beta Co',  'a065d000-0000-0000-0000-000000000001', 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2029-11-01 18:00Z'),
  ('a065e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered', 'declined', 'Gamma Co', null, 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2030-01-05 18:00Z'),
  ('a065e000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'accepted', 'Delta Co', null, 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2030-01-03 12:00Z'),
  ('a065e000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered', 'submitted','Eps Co',   null, 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2030-01-08 18:00Z'),
  ('a065e000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered', 'won',      'Zeta Co',  'a065d000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2029-11-02 18:00Z'),
  ('a065e000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000002', 'inbound',  'rep_entered', 'submitted','Kim Co',   null, 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2030-01-02 18:00Z');

-- R4 was shared from this release on; R8 is a legacy outbound row (never
-- shared) and R9 a shared link the rep removed, both inside week 1: neither
-- counts as "sent to you".
update referrals set shared_with_partner_at = '2030-01-03 12:00Z' where id = 'a065e000-0000-0000-0000-000000000004';
insert into referrals (id, org_id, partner_id, direction, source, status, company_name, assigned_user_id, submitted_by_user_id, submitted_at, shared_with_partner_at) values
  ('a065e000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'accepted',  'Legacy Co',  'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2030-01-04 12:00Z', null),
  ('a065e000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'withdrawn', 'Removed Co', 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002', '2030-01-04 12:00Z', '2030-01-04 12:00Z');

-- Twelve more for P1 in week 2 (2030-01-07 to 2030-01-14).
insert into referrals (org_id, partner_id, direction, source, status, company_name, assigned_user_id, submitted_by_user_id, submitted_at)
select '00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'submitted',
       'Bulk ' || i, 'a0650000-0000-0000-0000-000000000002', 'a0650000-0000-0000-0000-000000000002',
       '2030-01-09 18:00Z'::timestamptz + make_interval(mins => i)
  from generate_series(1, 12) i;

-- The status changes inside the weeks (the trigger rows carry the real now()).
insert into referral_status_history (org_id, referral_id, from_status, to_status, actor_type, created_at) values
  ('00000000-0000-0000-0000-000000001065', 'a065e000-0000-0000-0000-000000000001', 'submitted', 'accepted', 'user', '2030-01-03 18:00Z'),
  ('00000000-0000-0000-0000-000000001065', 'a065e000-0000-0000-0000-000000000002', 'working',   'won',      'user', '2030-01-04 18:00Z'),
  ('00000000-0000-0000-0000-000000001065', 'a065e000-0000-0000-0000-000000000003', 'submitted', 'declined', 'user', '2030-01-06 18:00Z'),
  ('00000000-0000-0000-0000-000000001065', 'a065e000-0000-0000-0000-000000000006', 'working',   'won',      'user', '2030-01-10 18:00Z');

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

-- 1. Privileges.
do $$ declare f text; begin
  foreach f in array array[
    'public.enqueue_portal_digests(timestamptz)',
    'public.portal_unsubscribe_digest(text, text, text)',
    'public.portal_record_export(uuid, uuid, uuid, text)',
    'public.claim_portal_emails(integer)'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '% must be service role only', f;
    end if;
  end loop;
  foreach f in array array[
    'public._portal_digest_token()',
    'public._portal_digest_wants(jsonb)',
    'public._portal_digest_events(uuid, uuid, timestamptz, timestamptz)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '% must be private', f;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.portal_users', 'digest_unsubscribe_token', 'SELECT') then
    raise exception 'the unsubscribe token is never readable by internal users';
  end if;
end $$;

-- 2. Before 08:00 local on Monday nothing is queued.
do $$ begin
  if public.enqueue_portal_digests('2030-01-07 15:00Z') is distinct from 0 then raise exception '07:00 in Los Angeles is too early'; end if;
  if exists (select 1 from portal_users where org_id = '00000000-0000-0000-0000-000000001065' and digest_week is not null) then
    raise exception 'no week is evaluated before 08:00';
  end if;
end $$;

-- 3. 08:30 local: one digest for PU1, with the week's counts, value, items and token.
do $$ declare n int; o portal_email_outbox; v_token text; begin
  n := public.enqueue_portal_digests('2030-01-07 16:30Z');
  if n is distinct from 1 then raise exception 'expected exactly one digest, got %', n; end if;

  select * into o from portal_email_outbox where kind = 'partner_digest';
  if o.id is null then raise exception 'the digest row is missing'; end if;
  select digest_unsubscribe_token into v_token from portal_users where id = 'a065b000-0000-0000-0000-000000000001';
  if o.portal_user_id is distinct from 'a065b000-0000-0000-0000-000000000001' or o.referral_id is not null or o.recipient_user_id is not null
     or o.dedupe_key is distinct from 'digest:a065b000-0000-0000-0000-000000000001:2030-02' then
    raise exception 'digest row wrong: %', row_to_json(o);
  end if;
  if (select count(*) from jsonb_object_keys(o.payload)) is distinct from 8 then raise exception 'payload must have 8 keys: %', o.payload; end if;
  if o.payload->'counts' is distinct from '{"submitted": 2, "accepted": 1, "inProgress": 0, "closedWon": 1, "notMovingForward": 1, "sentToYou": 1}'::jsonb then
    raise exception 'counts wrong: %', o.payload->'counts';
  end if;
  if (o.payload->>'valueCents')::bigint is distinct from 500000 then raise exception 'value wrong: %', o.payload->'valueCents'; end if;
  if o.payload->'items' is distinct from '[{"companyName": "Gamma Co", "label": "Not Moving Forward"},
                            {"companyName": "Beta Co",  "label": "Closed Won"},
                            {"companyName": "Alpha Co", "label": "Accepted"},
                            {"companyName": "Delta Co", "label": "Sent to you"}]'::jsonb then
    raise exception 'items wrong: %', o.payload->'items';
  end if;
  if o.payload->>'weekLabel' is distinct from 'Dec 31' or o.payload->>'slug' is distinct from 'dg-a' or o.payload->>'orgName' is distinct from 'Digest Org'
     or o.payload->>'partnerName' is distinct from 'Jane CPA' then
    raise exception 'header fields wrong: %', o.payload;
  end if;
  if v_token is null or v_token !~ '^[A-Za-z0-9_-]{22}$' or o.payload->>'unsubscribeToken' is distinct from v_token then
    raise exception 'token wrong: % vs %', v_token, o.payload->>'unsubscribeToken';
  end if;

  -- Quiet, opted out, suspended.
  if (select digest_week from portal_users where id = 'a065b000-0000-0000-0000-000000000003') is distinct from '2030-02' then
    raise exception 'a quiet partner is evaluated once for the week';
  end if;
  if exists (select 1 from portal_email_outbox where portal_user_id in ('a065b000-0000-0000-0000-000000000002',
               'a065b000-0000-0000-0000-000000000003', 'a065b000-0000-0000-0000-000000000004')) then
    raise exception 'only PU1 gets a digest';
  end if;
  if (select digest_week from portal_users where id = 'a065b000-0000-0000-0000-000000000002') is not null then
    raise exception 'an opted-out partner is never evaluated';
  end if;
end $$;

-- 4. A re-run the same week queues nothing.
do $$ begin
  if public.enqueue_portal_digests('2030-01-07 18:00Z') is distinct from 0 or public.enqueue_portal_digests('2030-01-10 18:00Z') is distinct from 0 then
    raise exception 'one digest per week';
  end if;
end $$;

-- 5. Week 2 with values hidden: no amount, items capped at 10, counts stay true.
do $$ declare o portal_email_outbox; begin
  update organizations set partner_value_visibility = false where id = '00000000-0000-0000-0000-000000001065';
  if public.enqueue_portal_digests('2030-01-14 16:30Z') is distinct from 1 then raise exception 'week 2 digest missing'; end if;
  select * into o from portal_email_outbox where dedupe_key = 'digest:a065b000-0000-0000-0000-000000000001:2030-03';
  if o.id is null then raise exception 'the week 2 digest row is missing'; end if;
  if not (o.payload ? 'valueCents') then raise exception 'valueCents key must be present (as JSON null)'; end if;
  if o.payload->'valueCents' is distinct from 'null'::jsonb then raise exception 'value must be hidden: %', o.payload->'valueCents'; end if;
  if jsonb_array_length(o.payload->'items') is distinct from 10 then raise exception 'items capped at 10, got %', jsonb_array_length(o.payload->'items'); end if;
  if (o.payload->'counts'->>'submitted')::int is distinct from 13 or (o.payload->'counts'->>'closedWon')::int is distinct from 1 then
    raise exception 'week 2 counts wrong: %', o.payload->'counts';
  end if;
  if o.payload->>'weekLabel' is distinct from 'Jan 7' then raise exception 'week 2 label wrong: %', o.payload->>'weekLabel'; end if;
end $$;

-- 6. The claim: a live digest goes out; one whose user turned the digest off is dropped.
do $$ declare v_pu1 uuid; v_pu2 uuid; begin
  insert into portal_email_outbox (org_id, kind, portal_user_id, payload, dedupe_key)
  values ('00000000-0000-0000-0000-000000001065', 'partner_digest', 'a065b000-0000-0000-0000-000000000002', '{}', 't065-pu2');
  select c.id into v_pu1 from public.claim_portal_emails(50) c where c.recipient = 'jane@dg.example' and c.kind = 'partner_digest' limit 1;
  if v_pu1 is null then raise exception 'a live digest must be claimed'; end if;
  if not exists (select 1 from portal_email_outbox where dedupe_key = 't065-pu2' and dropped_at is not null and last_error = 'recipient_inactive') then
    raise exception 'a digest for a user who turned it off must be dropped';
  end if;
end $$;

-- 7. Unsubscribe: by token, per org, silent, idempotent, rate limited per IP.
do $$ declare v_token text; n int; begin
  select digest_unsubscribe_token into v_token from portal_users where id = 'a065b000-0000-0000-0000-000000000001';
  if v_token is null then raise exception 'PU1 token missing'; end if;
  perform public.portal_unsubscribe_digest('DG-A ', v_token, '203.0.113.7');
  if (select notification_prefs from portal_users where id = 'a065b000-0000-0000-0000-000000000001') is distinct from '{"digest": false}'::jsonb then
    raise exception 'unsubscribe did not turn the digest off';
  end if;
  perform public.portal_unsubscribe_digest('dg-a', v_token, '203.0.113.7');
  select count(*) into n from portal_audit_log where action = 'unsubscribe' and ip = '203.0.113.7';
  if n is distinct from 2 then raise exception 'every request is audited, got %', n; end if;

  update portal_users set digest_unsubscribe_token = 'tok3tok3tok3tok3tok3tk' where id = 'a065b000-0000-0000-0000-000000000003';
  perform public.portal_unsubscribe_digest('dg-b', 'tok3tok3tok3tok3tok3tk', '203.0.113.7');
  perform public.portal_unsubscribe_digest('dg-a', 'not a token', '203.0.113.7');
  perform public.portal_unsubscribe_digest('nope', 'tok3tok3tok3tok3tok3tk', '203.0.113.7');
  insert into portal_audit_log (org_id, action, ip)
  select '00000000-0000-0000-0000-000000001065', 'unsubscribe', '198.51.100.9' from generate_series(1, 30);
  perform public.portal_unsubscribe_digest('dg-a', 'tok3tok3tok3tok3tok3tk', '198.51.100.9');
  if (select notification_prefs from portal_users where id = 'a065b000-0000-0000-0000-000000000003') is distinct from '{}'::jsonb then
    raise exception 'another org, a bad token, an unknown slug and a limited IP must change nothing';
  end if;
  perform public.portal_unsubscribe_digest('dg-a', 'tok3tok3tok3tok3tok3tk', '203.0.113.7');
  if (select notification_prefs ->> 'digest' from portal_users where id = 'a065b000-0000-0000-0000-000000000003') is distinct from 'false' then
    raise exception 'the right slug and token must work';
  end if;
end $$;

-- 8. Export audit (NFR-PORT-06).
do $$ declare n int; begin
  perform public.portal_record_export('00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000001',
    'a065b000-0000-0000-0000-000000000001', '203.0.113.8');
  select count(*) into n from portal_audit_log where action = 'export' and portal_user_id = 'a065b000-0000-0000-0000-000000000001' and ip = '203.0.113.8';
  if n is distinct from 1 then raise exception 'export must be audited, got %', n; end if;
  perform _t_raises($q$select public.portal_record_export('00000000-0000-0000-0000-000000001065', 'a065a000-0000-0000-0000-000000000004',
    'a065b000-0000-0000-0000-000000000004', null)$q$, 'not_authorized');
end $$;

rollback;
