-- Tests for 20261029000002_nudge_rearm (Partner Portal audit fixes, FR-PORT-48/55).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/074_nudge_rearm.sql
-- Self-cleans via ROLLBACK.
--
-- A reinstated referral and a reassigned form submission restart the end-of-day
-- reminder: nudge_from_at = now(), the old nudge rows are cleared, and the
-- digest window counts from nudge_from_at instead of submitted_at. The RPCs
-- stamp the real clock, so the tests move nudge_from_at onto the fixed clock
-- the digest is run with (2026-10-20 and 2026-10-21, New York, end of day 18:00).
--
-- Org portal-rearm: boss administrator; rita and rob reps. Partner P1 owned by rita.
--   H1 withdrawn Holder Co (holds credit)
--   D1 declined duplicate of H1, Dup One, submitted 10 days before the run, already nudged
--   D2 declined duplicate of H1, Dup Two, same age, never reinstated (control)
--   S1 submission Form Co for rita, nudged on the 21st, then reassigned to rob

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001074', 'Rearm Org', 'portal-rearm', 'portal-rearm-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0740000-0000-0000-0000-000000000001', 'boss@rearm.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0740000-0000-0000-0000-000000000002', 'rita@rearm.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0740000-0000-0000-0000-000000000003', 'rob@rearm.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0740000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001074', 'admin', 'administrator',      'Boss',     'boss@rearm.example', 'rmboss'::ltree,      null),
  ('a0740000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001074', 'rep',   'sales_professional', 'Rita Rep', 'rita@rearm.example', 'rmboss.rita'::ltree, 'a0740000-0000-0000-0000-000000000001'),
  ('a0740000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001074', 'rep',   'sales_professional', 'Rob Rep',  'rob@rearm.example',  'rmboss.rob'::ltree,  'a0740000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a074a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001074', 'a0740000-0000-0000-0000-000000000002', 'a0740000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@rearm.example');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_phone,
                       decline_reason, duplicate_of_referral_id, triaged_by, triaged_at, assigned_user_id, submitted_at, nudged_at) values
  ('a074f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001074', 'a074a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'withdrawn', 'Holder Co', 'Hal', '5550740001',
   null, null, null, null, 'a0740000-0000-0000-0000-000000000002', '2026-10-09 15:00+00', null),
  ('a074f000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000001074', 'a074a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined', 'Dup One', 'Ann', '5550740011',
   'duplicate', 'a074f000-0000-0000-0000-000000000001', 'a0740000-0000-0000-0000-000000000002', '2026-10-11 15:00+00', 'a0740000-0000-0000-0000-000000000002', '2026-10-10 15:00+00', '2026-10-10 22:30+00'),
  ('a074f000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000001074', 'a074a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined', 'Dup Two', 'Bea', '5550740012',
   'duplicate', 'a074f000-0000-0000-0000-000000000001', 'a0740000-0000-0000-0000-000000000002', '2026-10-11 15:00+00', 'a0740000-0000-0000-0000-000000000002', '2026-10-10 15:00+00', null);

insert into referral_nudges (referral_id, user_id, nudged_at) values
  ('a074f000-0000-0000-0000-000000000011', 'a0740000-0000-0000-0000-000000000002', '2026-10-10 22:30+00');

insert into referral_form_submissions (
  id, org_id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone,
  notes, consent_version, submitted_at
) values
  ('a074e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001074', 'user', 'a0740000-0000-0000-0000-000000000002', 'Form Co', 'Cy', 'c@x.example', '5550740021', 'n', 0, '2026-10-21 15:00+00');

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- 1. Reinstating a 10 day old referral clears its nudge and stamps the restart.
do $$ declare r record; begin
  perform _t_act('a0740000-0000-0000-0000-000000000002');
  perform public.reinstate_referral('a074f000-0000-0000-0000-000000000011');
  perform set_config('role', 'postgres', true);
  select * into r from referrals where id = 'a074f000-0000-0000-0000-000000000011';
  if r.nudge_from_at is null or r.nudge_from_at < now() - interval '1 minute' then
    raise exception 'reinstate should stamp nudge_from_at = now(), got %', r.nudge_from_at;
  end if;
  if r.nudged_at is not null then raise exception 'reinstate should clear nudged_at'; end if;
  if exists (select 1 from referral_nudges where referral_id = r.id) then
    raise exception 'reinstate should delete the referral''s nudge rows';
  end if;
  if (select nudge_from_at from referrals where id = 'a074f000-0000-0000-0000-000000000012') is not null then
    raise exception 'an untouched referral has no restart time';
  end if;
end $$;

-- 2. At the end of the day the reinstated referral nudges rita again. The
--    control (same age, never reinstated) does not: it is ten days old.
do $$ begin
  update referrals set nudge_from_at = '2026-10-20 15:00+00' where id = 'a074f000-0000-0000-0000-000000000011';
  -- The decline to reinstate happened to the other referral too: make D2 submitted,
  -- so it is a real candidate that only its age rules out.
  update referrals set status = 'submitted', decline_reason = null, duplicate_of_referral_id = null
   where id = 'a074f000-0000-0000-0000-000000000012';
  if public.enqueue_portal_nudges('2026-10-20 22:30+00') <> 1 then
    raise exception 'only rita is due, for the reinstated referral';
  end if;
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0740000-0000-0000-0000-000000000002:2026-10-20')
     <> '{"appUrlPath":"/partners","companyNames":["Dup One"],"count":1}'::jsonb then
    raise exception 'rita''s digest should carry the reinstated Dup One only';
  end if;
  if public.enqueue_portal_nudges('2026-10-20 22:30+00') <> 0 then
    raise exception 'the reinstated referral is nudged once per restart';
  end if;
end $$;

-- 3. Reassigning a nudged submission clears its rows and restarts the clock.
do $$ declare s record; begin
  if public.enqueue_portal_nudges('2026-10-21 22:35+00') <> 1 then
    raise exception 'the submission should have nudged rita first';
  end if;
  if not exists (select 1 from form_submission_nudges where submission_id = 'a074e000-0000-0000-0000-000000000001'
                    and user_id = 'a0740000-0000-0000-0000-000000000002') then
    raise exception 'rita should be in the submission nudge log';
  end if;
  perform _t_act('a0740000-0000-0000-0000-000000000001');
  perform public.reassign_form_submission('a074e000-0000-0000-0000-000000000001', 'a0740000-0000-0000-0000-000000000003');
  perform set_config('role', 'postgres', true);
  select * into s from referral_form_submissions where id = 'a074e000-0000-0000-0000-000000000001';
  if s.assigned_user_id <> 'a0740000-0000-0000-0000-000000000003' or s.nudge_from_at is null or s.nudge_from_at < now() - interval '1 minute' or s.nudged_at is not null then
    raise exception 'reassign should move, stamp nudge_from_at and clear nudged_at: %', row_to_json(s);
  end if;
  if exists (select 1 from form_submission_nudges where submission_id = s.id) then
    raise exception 'reassign should delete the submission''s nudge rows';
  end if;
end $$;

-- 4. The new rep is nudged at their next end of day, counted from the reassign.
do $$ begin
  update referral_form_submissions set nudge_from_at = '2026-10-22 10:00+00' where id = 'a074e000-0000-0000-0000-000000000001';
  -- Before the reassign time there is nothing to nudge (it started the restart window).
  if public.enqueue_portal_nudges('2026-10-22 09:00+00') <> 0 then raise exception 'not due before end of day'; end if;
  if public.enqueue_portal_nudges('2026-10-22 22:30+00') <> 1 then raise exception 'rob is due at his end of day'; end if;
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0740000-0000-0000-0000-000000000003:2026-10-22')
     <> '{"appUrlPath":"/partners","companyNames":["Form Co"],"count":1}'::jsonb then
    raise exception 'rob''s digest should carry Form Co';
  end if;
end $$;

rollback;
