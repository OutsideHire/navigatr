-- Tests for 20261030000001_form_submission_purge_warning (Partner Portal audit fixes, FR-PORT-93).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/077_form_submission_purge_warning.sql
-- Self-cleans via ROLLBACK.
--
-- Fifteen days before purge_form_submissions erases an untriaged submission, each
-- active administrator of the org gets one internal_purge_warning email per local
-- day, and the covered submissions are stamped purge_warned_at so they are
-- warned once.
--
-- The run time is fixed at 2026-10-30 15:00 UTC (11:00 in New York).
-- Org A (90 day retention): admins ann (New York) and al (Los Angeles), admin dee
--   deactivated, rep rex.
--   A75 untriaged, exactly 75 days old          warns
--   A74 untriaged, 74 days 23 hours old         not yet
--   ATR triaged (declined), 80 days old         never (triaged)
--   APG untriaged, 80 days old, already purged  never
--   AOV untriaged, 91 days old                  never (the purge erases it next)
-- Org B (30 day retention): admin bea.
--   B15 untriaged, exactly 15 days old          warns
--   B14 untriaged, 14 days old                  not yet

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, declined_retention_days) values
  ('00000000-0000-0000-0000-00000000077a', 'Warn Org A', 'portal-warn-a', 'portal-warn-a1', true, 90),
  ('00000000-0000-0000-0000-00000000077b', 'Warn Org B', 'portal-warn-b', 'portal-warn-b1', true, 30);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0770000-0000-0000-0000-000000000001', 'ann@warn.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0770000-0000-0000-0000-000000000002', 'al@warn.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0770000-0000-0000-0000-000000000003', 'dee@warn.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0770000-0000-0000-0000-000000000004', 'rex@warn.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0770000-0000-0000-0000-000000000005', 'bea@warn.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0770000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000077a', 'admin', 'administrator',      'Ann', 'ann@warn.example', 'wann'::ltree,     null, null),
  ('a0770000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000077a', 'admin', 'administrator',      'Al',  'al@warn.example',  'wal'::ltree,      null, null),
  ('a0770000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000077a', 'admin', 'administrator',      'Dee', 'dee@warn.example', 'wdee'::ltree,     null, now()),
  ('a0770000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000077a', 'rep',   'sales_professional', 'Rex', 'rex@warn.example', 'wann.rex'::ltree, 'a0770000-0000-0000-0000-000000000001', null),
  ('a0770000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000077b', 'admin', 'administrator',      'Bea', 'bea@warn.example', 'wbea'::ltree,     null, null);

insert into path_preferences (user_id, timezone) values
  ('a0770000-0000-0000-0000-000000000001', 'America/New_York'),
  ('a0770000-0000-0000-0000-000000000002', 'America/Los_Angeles');

insert into referral_form_submissions (
  id, org_id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone,
  notes, consent_version, submitted_at, triaged_at, outcome, purged_at
) values
  ('a077e000-0000-0000-0000-000000000075', '00000000-0000-0000-0000-00000000077a', 'user', 'a0770000-0000-0000-0000-000000000004',
   'Seventy Five Co', 'C', 'c@x.example', '5550770075', 'n', 0, timestamptz '2026-10-30 15:00+00' - interval '75 days', null, null, null),
  ('a077e000-0000-0000-0000-000000000074', '00000000-0000-0000-0000-00000000077a', 'user', 'a0770000-0000-0000-0000-000000000004',
   'Seventy Four Co', 'C', 'c@x.example', '5550770074', 'n', 0, timestamptz '2026-10-30 15:00+00' - interval '74 days 23 hours', null, null, null),
  ('a077e000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000077a', 'user', 'a0770000-0000-0000-0000-000000000004',
   'Triaged Co', 'C', 'c@x.example', '5550770081', 'n', 0, timestamptz '2026-10-30 15:00+00' - interval '80 days',
   timestamptz '2026-10-30 15:00+00' - interval '79 days', 'declined', null),
  ('a077e000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000077a', 'user', 'a0770000-0000-0000-0000-000000000004',
   'Purged Co', null, null, null, null, 0, timestamptz '2026-10-30 15:00+00' - interval '80 days', null, null,
   timestamptz '2026-10-30 15:00+00' - interval '1 day'),
  ('a077e000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000077a', 'user', 'a0770000-0000-0000-0000-000000000004',
   'Overdue Co', 'C', 'c@x.example', '5550770091', 'n', 0, timestamptz '2026-10-30 15:00+00' - interval '91 days', null, null, null),
  ('a077e000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-00000000077b', 'user', null,
   'Fifteen Co', 'C', 'c@x.example', '5550770015', 'n', 0, timestamptz '2026-10-30 15:00+00' - interval '15 days', null, null, null),
  ('a077e000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-00000000077b', 'user', null,
   'Fourteen Co', 'C', 'c@x.example', '5550770014', 'n', 0, timestamptz '2026-10-30 15:00+00' - interval '14 days', null, null, null);

-- 0. The kind is allowed, the function is service_role only, and the column is not readable by the app.
do $$ begin
  if not exists (select 1 from pg_constraint
                  where conname = 'portal_email_outbox_kind_check'
                    and pg_get_constraintdef(oid) like '%internal_purge_warning%'
                    and pg_get_constraintdef(oid) like '%internal_assigned%') then
    raise exception 'the outbox kind list should add internal_purge_warning and keep internal_assigned';
  end if;
  if has_function_privilege('authenticated', 'public.enqueue_form_submission_purge_warnings(timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.enqueue_form_submission_purge_warnings(timestamptz)', 'execute') then
    raise exception 'enqueue_form_submission_purge_warnings must not be callable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.enqueue_form_submission_purge_warnings(timestamptz)', 'execute') then
    raise exception 'service_role should be able to run enqueue_form_submission_purge_warnings';
  end if;
  if has_column_privilege('authenticated', 'public.referral_form_submissions', 'purge_warned_at', 'select') then
    raise exception 'purge_warned_at must not be granted to authenticated';
  end if;
end $$;

-- 1. One run: ann and al (org A) and bea (org B) are warned. dee is deactivated, rex is not an admin.
do $$ declare n integer; begin
  n := public.enqueue_form_submission_purge_warnings('2026-10-30 15:00+00');
  if n <> 3 then raise exception 'expected 3 warnings (ann, al, bea), got %', n; end if;

  if (select count(*) from portal_email_outbox where kind = 'internal_purge_warning'
       and recipient_user_id in ('a0770000-0000-0000-0000-000000000003', 'a0770000-0000-0000-0000-000000000004')) <> 0 then
    raise exception 'a deactivated admin and a rep are never warned';
  end if;

  -- The 90 day org warns at day 75, not at day 74.
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_purge_warning:a0770000-0000-0000-0000-000000000001:2026-10-30')
     <> '{"appUrlPath":"/partners","companyNames":["Seventy Five Co"],"count":1}'::jsonb then
    raise exception 'ann''s warning should carry Seventy Five Co only, got %',
      (select payload from portal_email_outbox where kind = 'internal_purge_warning'
        and recipient_user_id = 'a0770000-0000-0000-0000-000000000001');
  end if;
  -- al's local date comes from his own time zone (08:00 in Los Angeles is still the 30th).
  if not exists (select 1 from portal_email_outbox
                  where dedupe_key = 'internal_purge_warning:a0770000-0000-0000-0000-000000000002:2026-10-30'
                    and org_id = '00000000-0000-0000-0000-00000000077a') then
    raise exception 'al should get his own warning keyed by his local date';
  end if;
  -- The 30 day org warns at day 15, not at day 14 (bea has no time zone: New York default).
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_purge_warning:a0770000-0000-0000-0000-000000000005:2026-10-30')
     <> '{"appUrlPath":"/partners","companyNames":["Fifteen Co"],"count":1}'::jsonb then
    raise exception 'bea''s warning should carry Fifteen Co only';
  end if;

  if (select count(*) from referral_form_submissions where purge_warned_at is not null) <> 2 then
    raise exception 'only the two covered submissions are stamped';
  end if;
  if (select purge_warned_at from referral_form_submissions where id = 'a077e000-0000-0000-0000-000000000075')
     is distinct from '2026-10-30 15:00+00'::timestamptz then
    raise exception 'the covered submission should be stamped with the run time';
  end if;
end $$;

-- 2. A second run the same day queues nothing.
do $$ begin
  if public.enqueue_form_submission_purge_warnings('2026-10-30 15:02+00') <> 0 then
    raise exception 'a second run the same day should queue nothing';
  end if;
  -- Even when a new submission crosses the line later the same day: today's email
  -- is already queued, so it waits (unstamped) for tomorrow's.
  update referral_form_submissions set submitted_at = timestamptz '2026-10-30 18:00+00' - interval '75 days'
   where id = 'a077e000-0000-0000-0000-000000000074';
  if public.enqueue_form_submission_purge_warnings('2026-10-30 18:00+00') <> 0 then
    raise exception 'the same admin is warned once per local day';
  end if;
  if (select purge_warned_at from referral_form_submissions where id = 'a077e000-0000-0000-0000-000000000074') is not null then
    raise exception 'a submission whose email was not queued must stay unwarned';
  end if;
  if (select count(*) from portal_email_outbox where kind = 'internal_purge_warning') <> 3 then
    raise exception 'still exactly three warnings';
  end if;
end $$;

-- 3. The next local day the newly due ones are warned, once, and the already warned ones are not repeated.
do $$ begin
  -- ann and al for Seventy Four Co; bea for Fourteen Co, which reached day 15 today.
  if public.enqueue_form_submission_purge_warnings('2026-10-31 15:00+00') <> 3 then
    raise exception 'ann and al (Seventy Four Co) and bea (Fourteen Co) should be warned the next day';
  end if;
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_purge_warning:a0770000-0000-0000-0000-000000000001:2026-10-31')
     <> '{"appUrlPath":"/partners","companyNames":["Seventy Four Co"],"count":1}'::jsonb then
    raise exception 'the next day''s warning carries only the newly due submission';
  end if;
  if public.enqueue_form_submission_purge_warnings('2026-10-31 15:05+00') <> 0 then
    raise exception 'nothing left to warn';
  end if;
end $$;

-- 4. A disabled org is not warned.
do $$ begin
  update organizations set is_disabled = true where id = '00000000-0000-0000-0000-00000000077b';
  update referral_form_submissions set purge_warned_at = null
   where id = 'a077e000-0000-0000-0000-0000000000b4';
  if public.enqueue_form_submission_purge_warnings('2026-11-01 15:00+00') <> 0 then
    raise exception 'a disabled org is not warned';
  end if;
end $$;

rollback;
