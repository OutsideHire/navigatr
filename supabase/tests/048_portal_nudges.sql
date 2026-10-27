-- Tests for 20261014000004_portal_nudges (Partner Portal Phase 1C, spec 5.9).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/048_portal_nudges.sql
-- Self-cleans via ROLLBACK. Runs as postgres with fixed clocks.
--
-- 2026-10-14 is in daylight time: New York UTC-4, Chicago UTC-5, Los Angeles UTC-7.
--   T1 = 2026-10-14 22:30Z = 18:30 New York, 17:30 Chicago, 15:30 Los Angeles
--   T2 = 2026-10-15 01:30Z = 21:30 New York, 18:30 Los Angeles (still Oct 14 there)
--   T3 = 2026-10-15 22:30Z = the next evening
--
-- Fixture (org portal-nudge): admNY and admLA administrators; repNY (no
-- preferences: New York, 18:00), repCHI (Chicago, ends 15:00), repBad (stored
-- zone "Mars/Base": falls back to New York), repGone (deactivated).
-- A second, disabled org has one referral that must never nudge.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, is_disabled) values
  ('00000000-0000-0000-0000-000000001048', 'Nudge Org',    'portal-nudge',   'portal-nudge-a1',   true, false),
  ('00000000-0000-0000-0000-000000001148', 'Nudge Org Off', 'portal-nudge-x', 'portal-nudge-x-a1', true, true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0480000-0000-0000-0000-000000000001', 'admny@nudge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0480000-0000-0000-0000-000000000002', 'admla@nudge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0480000-0000-0000-0000-000000000003', 'repny@nudge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0480000-0000-0000-0000-000000000004', 'repch@nudge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0480000-0000-0000-0000-000000000005', 'repbd@nudge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0480000-0000-0000-0000-000000000006', 'repgn@nudge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0480000-0000-0000-0000-000000000007', 'offad@nudge.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0480000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001048', 'admin', 'administrator',      'Adm NY',   'admny@nudge.example', 'ndgny'::ltree,       null, null),
  ('a0480000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001048', 'admin', 'administrator',      'Adm LA',   'admla@nudge.example', 'ndgla'::ltree,       null, null),
  ('a0480000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001048', 'rep',   'sales_professional', 'Rep NY',   'repny@nudge.example', 'ndgny.repny'::ltree, 'a0480000-0000-0000-0000-000000000001', null),
  ('a0480000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001048', 'rep',   'sales_professional', 'Rep CHI',  'repch@nudge.example', 'ndgny.repch'::ltree, 'a0480000-0000-0000-0000-000000000001', null),
  ('a0480000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001048', 'rep',   'sales_professional', 'Rep Bad',  'repbd@nudge.example', 'ndgny.repbd'::ltree, 'a0480000-0000-0000-0000-000000000001', null),
  ('a0480000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001048', 'rep',   'sales_professional', 'Rep Gone', 'repgn@nudge.example', 'ndgny.repgn'::ltree, 'a0480000-0000-0000-0000-000000000001', now()),
  ('a0480000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000001148', 'admin', 'administrator',      'Off Adm',  'offad@nudge.example', 'ndgoff'::ltree,      null, null);

insert into path_preferences (user_id, timezone, end_of_day_minutes) values
  ('a0480000-0000-0000-0000-000000000001', 'America/New_York',    null),
  ('a0480000-0000-0000-0000-000000000002', 'America/Los_Angeles', null),
  ('a0480000-0000-0000-0000-000000000004', 'America/Chicago',     900),
  ('a0480000-0000-0000-0000-000000000005', 'Mars/Base',           null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a048a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001048', 'a0480000-0000-0000-0000-000000000003', 'a0480000-0000-0000-0000-000000000003', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@nudge.example'),
  ('a048a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001148', 'a0480000-0000-0000-0000-000000000007', 'a0480000-0000-0000-0000-000000000007', 'Off CPA',  'Off & Co',  'cpa', 'off@nudge.example');

insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id, submitted_at, nudged_at) values
  -- repNY
  ('a048f000-0000-0000-0000-000000000001', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Morning Co',   'a0480000-0000-0000-0000-000000000003', '2026-10-14 14:00+00', null),
  ('a048f000-0000-0000-0000-000000000002', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Midday Co',    'a0480000-0000-0000-0000-000000000003', '2026-10-14 15:00+00', null),
  ('a048f000-0000-0000-0000-000000000003', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Evening Co',   'a0480000-0000-0000-0000-000000000003', '2026-10-14 22:15+00', null),
  ('a048f000-0000-0000-0000-000000000004', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Yesterday Co', 'a0480000-0000-0000-0000-000000000003', '2026-10-13 15:00+00', null),
  ('a048f000-0000-0000-0000-000000000005', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'accepted',  'Handled Co',   'a0480000-0000-0000-0000-000000000003', '2026-10-14 15:00+00', null),
  ('a048f000-0000-0000-0000-000000000006', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered',      'submitted', 'Logged Co',    'a0480000-0000-0000-0000-000000000003', '2026-10-14 15:00+00', null),
  ('a048f000-0000-0000-0000-00000000000c', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Nudged Co',    'a0480000-0000-0000-0000-000000000003', '2026-10-14 16:00+00', '2026-10-14 20:00+00'),
  ('a048f000-0000-0000-0000-00000000000d', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Ancient Co',   'a0480000-0000-0000-0000-000000000003', '2026-10-06 15:00+00', null),
  -- repCHI and repBad
  ('a048f000-0000-0000-0000-000000000007', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Chicago Co',   'a0480000-0000-0000-0000-000000000004', '2026-10-14 15:00+00', null),
  ('a048f000-0000-0000-0000-000000000008', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Fallback Co',  'a0480000-0000-0000-0000-000000000005', '2026-10-14 15:00+00', null),
  -- administrator queue: unassigned, and assigned to a deactivated rep
  ('a048f000-0000-0000-0000-000000000009', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Queue Co',     null,                                   '2026-10-14 14:30+00', null),
  ('a048f000-0000-0000-0000-00000000000a', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Orphan Co',    'a0480000-0000-0000-0000-000000000006', '2026-10-14 16:00+00', null),
  -- disabled org
  ('a048f000-0000-0000-0000-00000000000b', 'a048a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'submitted', 'Off Co',       'a0480000-0000-0000-0000-000000000007', '2026-10-14 14:00+00', null);

create or replace function _t_digest(p_user uuid) returns jsonb language sql as $$
  select payload from portal_email_outbox where kind = 'internal_nudge' and recipient_user_id = p_user
$$;

-- Privileges.
do $$ begin
  if has_function_privilege('authenticated', 'public.enqueue_portal_nudges(timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.enqueue_portal_nudges(timestamptz)', 'EXECUTE') then
    raise exception 'enqueue_portal_nudges must be service role only';
  end if;
  if not has_function_privilege('service_role', 'public.enqueue_portal_nudges(timestamptz)', 'EXECUTE') then
    raise exception 'service_role should execute enqueue_portal_nudges';
  end if;
  if has_function_privilege('service_role', 'public._portal_local_tz(text)', 'EXECUTE') then
    raise exception '_portal_local_tz is private';
  end if;
  if has_table_privilege('authenticated', 'public.referral_nudges', 'SELECT')
     or has_table_privilege('anon', 'public.referral_nudges', 'SELECT') then
    raise exception 'referral_nudges must be invisible to anon and authenticated';
  end if;
  if public._portal_local_tz('Mars/Base') <> 'America/New_York'
     or public._portal_local_tz(null) <> 'America/New_York'
     or public._portal_local_tz('America/Chicago') <> 'America/Chicago' then
    raise exception '_portal_local_tz should keep a real zone and default the rest to New York';
  end if;
end $$;

-- T1: repNY (two), repCHI, repBad, admNY (the queue). Not admLA yet (15:30 there).
do $$ declare n int; begin
  -- The submission trigger already queued new-referral emails; only digests count here.
  n := public.enqueue_portal_nudges('2026-10-14 22:30+00');
  if n <> 4 then raise exception 'T1 should queue 4 digests, got %', n; end if;

  if _t_digest('a0480000-0000-0000-0000-000000000003') <> '{"appUrlPath":"/partners","companyNames":["Yesterday Co","Morning Co","Midday Co"],"count":3}'::jsonb then
    raise exception 'repNY digest wrong (Evening Co came after 18:00, Ancient Co is 8 days old): %', _t_digest('a0480000-0000-0000-0000-000000000003');
  end if;
  if _t_digest('a0480000-0000-0000-0000-000000000004') <> '{"appUrlPath":"/partners","companyNames":["Chicago Co"],"count":1}'::jsonb then
    raise exception 'repCHI digest wrong: %', _t_digest('a0480000-0000-0000-0000-000000000004');
  end if;
  if _t_digest('a0480000-0000-0000-0000-000000000005') <> '{"appUrlPath":"/partners","companyNames":["Fallback Co"],"count":1}'::jsonb then
    raise exception 'repBad should fall back to New York: %', _t_digest('a0480000-0000-0000-0000-000000000005');
  end if;
  if _t_digest('a0480000-0000-0000-0000-000000000001') <> '{"appUrlPath":"/partners","companyNames":["Queue Co","Orphan Co"],"count":2}'::jsonb then
    raise exception 'admNY should get the administrator queue: %', _t_digest('a0480000-0000-0000-0000-000000000001');
  end if;
  if _t_digest('a0480000-0000-0000-0000-000000000002') is not null then raise exception 'admLA is not at end of day yet'; end if;
  if _t_digest('a0480000-0000-0000-0000-000000000007') is not null then raise exception 'a disabled org must not nudge'; end if;

  if (select dedupe_key from portal_email_outbox where kind = 'internal_nudge' and recipient_user_id = 'a0480000-0000-0000-0000-000000000003')
     <> 'internal_nudge:a0480000-0000-0000-0000-000000000003:2026-10-14' then
    raise exception 'digest dedupe key should be per user per local day';
  end if;

  if (select count(*) from referrals where nudged_at = '2026-10-14 22:30+00') <> 7 then
    raise exception 'the seven nudged referrals should be stamped with the run time';
  end if;
  if (select nudged_at from referrals where id = 'a048f000-0000-0000-0000-000000000003') is not null then
    raise exception 'Evening Co was not nudged';
  end if;
  if (select nudged_at from referrals where id = 'a048f000-0000-0000-0000-00000000000c') <> '2026-10-14 20:00+00' then
    raise exception 'an already nudged referral keeps its first stamp';
  end if;
end $$;

-- Same clock again: nothing new.
do $$ begin
  if public.enqueue_portal_nudges('2026-10-14 22:30+00') <> 0 then raise exception 'a second run must queue nothing'; end if;
end $$;

-- T2: admLA reaches end of day on Oct 14 and gets the queue too; nobody else.
do $$ declare n int; begin
  n := public.enqueue_portal_nudges('2026-10-15 01:30+00');
  if n <> 1 then raise exception 'T2 should queue only admLA''s digest, got %', n; end if;
  if _t_digest('a0480000-0000-0000-0000-000000000002') <> '{"appUrlPath":"/partners","companyNames":["Queue Co","Orphan Co"],"count":2}'::jsonb then
    raise exception 'admLA digest wrong: %', _t_digest('a0480000-0000-0000-0000-000000000002');
  end if;
  if (select count(*) from referral_nudges where referral_id = 'a048f000-0000-0000-0000-000000000009') <> 2 then
    raise exception 'the queue item should be logged once per administrator';
  end if;
  if (select nudged_at from referrals where id = 'a048f000-0000-0000-0000-000000000009') <> '2026-10-14 22:30+00' then
    raise exception 'nudged_at keeps the first nudge';
  end if;
end $$;

-- T3: the next evening. Evening Co came after yesterday's end of day, so it
-- rides in today's digest. Ancient Co (8 days old) never does.
do $$ begin
  if public.enqueue_portal_nudges('2026-10-15 22:30+00') <> 1 then raise exception 'T3 should queue only repNY''s carried digest'; end if;
  if (select payload from portal_email_outbox where dedupe_key = 'internal_nudge:a0480000-0000-0000-0000-000000000003:2026-10-15')
     <> '{"appUrlPath":"/partners","companyNames":["Evening Co"],"count":1}'::jsonb then
    raise exception 'repNY T3 digest should carry Evening Co only';
  end if;
  if exists (select 1 from referral_nudges where referral_id = 'a048f000-0000-0000-0000-00000000000d') then
    raise exception 'a referral older than seven local days is never nudged';
  end if;
  if public.enqueue_portal_nudges('2026-10-15 22:30+00') <> 0 then raise exception 'already nudged referrals are not repeated'; end if;
end $$;

-- A referral reassigned after its nudge restarts the reminder: the new assignee
-- is nudged at their own next end of day, counted from the reassign time. The
-- RPC stamps the real clock, so the test moves nudge_from_at onto the fixed one.
do $$ begin
  perform set_config('request.jwt.claim.sub', 'a0480000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  perform public.reassign_referral('a048f000-0000-0000-0000-000000000001', 'a0480000-0000-0000-0000-000000000004');
  perform set_config('role', 'postgres', true);
  if (select nudge_from_at from referrals where id = 'a048f000-0000-0000-0000-000000000001') is null
     or (select nudged_at from referrals where id = 'a048f000-0000-0000-0000-000000000001') is not null
     or exists (select 1 from referral_nudges where referral_id = 'a048f000-0000-0000-0000-000000000001') then
    raise exception 'reassign should restart the reminder';
  end if;
  update referrals set nudge_from_at = '2026-10-15 15:00+00' where id = 'a048f000-0000-0000-0000-000000000001';
  if public.enqueue_portal_nudges('2026-10-15 22:30+00') <> 1 then
    raise exception 'the reassigned referral nudges its new assignee';
  end if;
  if (select payload from portal_email_outbox where dedupe_key = 'internal_nudge:a0480000-0000-0000-0000-000000000004:2026-10-15')
     <> '{"appUrlPath":"/partners","companyNames":["Morning Co"],"count":1}'::jsonb then
    raise exception 'repCHI digest should carry Morning Co';
  end if;
  if public.enqueue_portal_nudges('2026-10-15 22:30+00') <> 0 then raise exception 'and only once'; end if;
end $$;

-- F1: today's digest already exists, a newly due referral is NOT consumed.
do $$ begin
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id, submitted_at)
  values ('a048f000-0000-0000-0000-00000000000e', 'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Late Co', 'a0480000-0000-0000-0000-000000000003', '2026-10-15 10:00+00');
  if public.enqueue_portal_nudges('2026-10-15 22:40+00') <> 0 then raise exception 'digest for the day already exists'; end if;
  if exists (select 1 from referral_nudges where referral_id = 'a048f000-0000-0000-0000-00000000000e')
     or (select nudged_at from referrals where id = 'a048f000-0000-0000-0000-00000000000e') is not null then
    raise exception 'a referral whose digest hit the dedupe key must stay un-nudged';
  end if;
  -- It rides the next day.
  if public.enqueue_portal_nudges('2026-10-16 22:30+00') <> 1 then raise exception 'Late Co should ride the next day''s digest'; end if;
  if (select payload from portal_email_outbox where dedupe_key = 'internal_nudge:a0480000-0000-0000-0000-000000000003:2026-10-16')
     <> '{"appUrlPath":"/partners","companyNames":["Late Co"],"count":1}'::jsonb then
    raise exception 'next day digest should carry Late Co';
  end if;
end $$;

-- F3: 21 waiting items: names capped at 20 (oldest first), count is the true total.
do $$ begin
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id, submitted_at)
  select format('a048f100-0000-0000-0000-%s', lpad(i::text, 12, '0'))::uuid,
         'a048a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted',
         'Bulk ' || lpad(i::text, 2, '0'), null, '2026-10-17 10:00+00'::timestamptz + (i || ' minutes')::interval
    from generate_series(1, 21) i;
  if public.enqueue_portal_nudges('2026-10-17 22:30+00') <> 1 then raise exception 'only admNY is due'; end if;
  if (select jsonb_array_length(payload->'companyNames') from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0480000-0000-0000-0000-000000000001:2026-10-17') <> 20
     or (select (payload->>'count')::int from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0480000-0000-0000-0000-000000000001:2026-10-17') <> 21
     or (select payload->'companyNames'->>0 from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0480000-0000-0000-0000-000000000001:2026-10-17') <> 'Bulk 01' then
    raise exception 'digest should list 20 names, oldest first, with count 21';
  end if;
end $$;

rollback;
