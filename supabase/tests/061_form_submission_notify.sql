-- Tests for 20261020000003_form_submission_notify (Partner Portal Phase 2B-2, FR-PORT-80).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/061_form_submission_notify.sql
-- Self-cleans via ROLLBACK. Runs as postgres throughout (no role switch).
--
-- Org pf-ntf: boss and ann administrators, rita rep under boss (all New York,
-- end of day 18:00 local = 22:00 UTC in October). Partner P1 owned by rita.
-- R1 Ref Co: portal referral for rita at 14:00 UTC on 2026-10-20.
-- Submissions on 2026-10-20 (UTC): S1 Form Co (rita) 15:00, S2 Queue Co (company
-- link, administrator queue) 16:00, S3 Done Co (rita, declined), S4 Gone Co
-- (rita, purged), S5 Late Co (rita) 23:00, after her end of day.
--
-- Org pf-ntf-c (all on 2026-11-10 UTC, eight days clear of the October rows):
--   carl administrator in Los Angeles, end of day 17:00 (01:00 UTC next day);
--   dora administrator with no preferences (New York, 18:00 = 23:00 UTC);
--   vic rep, DEACTIVATED; tess rep (New York default). Partner P2 owned by tess.
--   R2 Attr Co: a portal_public referral for tess at 14:00 (attributed, not
--   finished); its submission S11 Attr Co is triaged (outcome attributed).
--   S12 Twice Co (tess) 14:30, S13 Vic Co (vic) 15:00, S14 Tz Co (company link) 15:30.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001061', 'Notify Org', 'pf-ntf', 'pf-ntf-a1', true);
update organizations set public_form_enabled = true where id = '00000000-0000-0000-0000-000000001061';

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0610000-0000-0000-0000-000000000001', 'boss@ntf.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0610000-0000-0000-0000-000000000002', 'ann@ntf.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0610000-0000-0000-0000-000000000003', 'rita@ntf.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0610000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001061', 'admin', 'administrator',      'Boss',     'boss@ntf.example', 'ntfboss'::ltree,      null),
  ('a0610000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001061', 'admin', 'administrator',      'Ann',      'ann@ntf.example',  'ntfann'::ltree,       null),
  ('a0610000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001061', 'rep',   'sales_professional', 'Rita Rep', 'rita@ntf.example', 'ntfboss.rita'::ltree, 'a0610000-0000-0000-0000-000000000001');

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001261', 'Notify Org C', 'pf-ntf-c', 'pf-ntf-c-a1', true);
update organizations set public_form_enabled = true where id = '00000000-0000-0000-0000-000000001261';

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0610000-0000-0000-0000-000000000011', 'carl@ntfc.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0610000-0000-0000-0000-000000000012', 'dora@ntfc.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0610000-0000-0000-0000-000000000013', 'vic@ntfc.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0610000-0000-0000-0000-000000000014', 'tess@ntfc.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0610000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000001261', 'admin', 'administrator',      'Carl', 'carl@ntfc.example', 'ntfcarl'::ltree,      null, null),
  ('a0610000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000001261', 'admin', 'administrator',      'Dora', 'dora@ntfc.example', 'ntfdora'::ltree,      null, null),
  ('a0610000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000001261', 'rep',   'sales_professional', 'Vic',  'vic@ntfc.example',  'ntfcarl.vic'::ltree,  'a0610000-0000-0000-0000-000000000011', '2026-11-01 00:00+00'),
  ('a0610000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000001261', 'rep',   'sales_professional', 'Tess', 'tess@ntfc.example', 'ntfcarl.tess'::ltree, 'a0610000-0000-0000-0000-000000000011', null);

insert into path_preferences (user_id, timezone, end_of_day_minutes) values
  ('a0610000-0000-0000-0000-000000000011', 'America/Los_Angeles', 1020);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a061a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001261', 'a0610000-0000-0000-0000-000000000014', 'a0610000-0000-0000-0000-000000000014', 'Tom CPA', 'Tom & Co', 'cpa', 'tom@ntfc.example');

insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id, submitted_at) values
  ('a061f000-0000-0000-0000-000000000011', 'a061a000-0000-0000-0000-000000000002', 'inbound', 'portal_public', 'submitted', 'Attr Co', 'a0610000-0000-0000-0000-000000000014', '2026-11-10 14:00+00');

insert into referral_form_submissions (
  id, org_id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone,
  notes, consent_version, submitted_at, triaged_at, outcome, referral_id
) values
  ('a061e000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000001261', 'user',   'a0610000-0000-0000-0000-000000000014', 'Attr Co',  null,  null,          null,         null, 0, '2026-11-10 14:00+00', '2026-11-10 14:10+00', 'attributed', 'a061f000-0000-0000-0000-000000000011'),
  ('a061e000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000001261', 'user',   'a0610000-0000-0000-0000-000000000014', 'Twice Co', 'Fay', 'f@x.example', '5550610012', 'n',  0, '2026-11-10 14:30+00', null,                  null,         null),
  ('a061e000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000001261', 'user',   'a0610000-0000-0000-0000-000000000013', 'Vic Co',   'Gil', 'g@x.example', '5550610013', 'n',  0, '2026-11-10 15:00+00', null,                  null,         null),
  ('a061e000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000001261', 'tenant', null,                                   'Tz Co',    'Hu',  'h@x.example', '5550610014', 'n',  0, '2026-11-10 15:30+00', null,                  null,         null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a061a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001061', 'a0610000-0000-0000-0000-000000000003', 'a0610000-0000-0000-0000-000000000003', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@ntf.example');

insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id, submitted_at) values
  ('a061f000-0000-0000-0000-000000000001', 'a061a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Ref Co', 'a0610000-0000-0000-0000-000000000003', '2026-10-20 14:00+00');

insert into referral_form_submissions (
  id, org_id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone,
  notes, consent_version, submitted_at, triaged_at, outcome, purged_at
) values
  ('a061e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001061', 'user',   'a0610000-0000-0000-0000-000000000003', 'Form Co',  'Ann', 'a@x.example', '5550610001', 'n', 0, '2026-10-20 15:00+00', null,                  null,       null),
  ('a061e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001061', 'tenant', null,                                   'Queue Co', 'Bo',  'b@x.example', '5550610002', 'n', 0, '2026-10-20 16:00+00', null,                  null,       null),
  ('a061e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001061', 'user',   'a0610000-0000-0000-0000-000000000003', 'Done Co',  'Cy',  'c@x.example', '5550610003', 'n', 0, '2026-10-20 15:30+00', '2026-10-20 17:00+00', 'declined', null),
  ('a061e000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001061', 'user',   'a0610000-0000-0000-0000-000000000003', 'Gone Co',  'Di',  'd@x.example', '5550610004', 'n', 0, '2026-10-20 15:45+00', null,                  null,       '2026-10-20 18:00+00'),
  ('a061e000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001061', 'user',   'a0610000-0000-0000-0000-000000000003', 'Late Co',  'Ed',  'e@x.example', '5550610005', 'n', 0, '2026-10-20 23:00+00', null,                  null,       null);

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
do $$ begin
  if has_table_privilege('authenticated', 'public.form_submission_nudges', 'SELECT')
     or has_table_privilege('anon', 'public.form_submission_nudges', 'SELECT') then
    raise exception 'form_submission_nudges is invisible to clients';
  end if;
  if has_function_privilege('authenticated', 'public.referral_form_submissions_enqueue_email()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.referral_form_submissions_enqueue_email()', 'EXECUTE') then
    raise exception 'the enqueue trigger function is private';
  end if;
  if has_function_privilege('authenticated', 'public.enqueue_portal_nudges(timestamptz)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.enqueue_portal_nudges(timestamptz)', 'EXECUTE') then
    raise exception 'enqueue_portal_nudges stays service role only';
  end if;
end $$;

-- 2. A new submission emails its reviewer; the administrator queue emails every administrator.
do $$ declare o portal_email_outbox; begin
  select * into o from portal_email_outbox
   where kind = 'internal_new_submission' and dedupe_key like 'internal_new_submission:a061e000-0000-0000-0000-000000000001:%';
  if o.recipient_user_id is distinct from 'a0610000-0000-0000-0000-000000000003'::uuid
     or o.referral_id is not null or o.portal_user_id is not null
     or o.payload <> '{"appUrlPath":"/partners","companyNames":["Form Co"],"count":1}'::jsonb
     or o.dedupe_key <> 'internal_new_submission:a061e000-0000-0000-0000-000000000001:a0610000-0000-0000-0000-000000000003' then
    raise exception 'S1 emails rita, got %', row_to_json(o);
  end if;
  if (select count(*) from portal_email_outbox where kind = 'internal_new_submission'
       and dedupe_key like 'internal_new_submission:a061e000-0000-0000-0000-000000000001:%') <> 1 then
    raise exception 'one email per reviewer per submission';
  end if;
  if (select string_agg(recipient_user_id::text, ',' order by recipient_user_id) from portal_email_outbox
       where kind = 'internal_new_submission' and dedupe_key like 'internal_new_submission:a061e000-0000-0000-0000-000000000002:%')
     <> 'a0610000-0000-0000-0000-000000000001,a0610000-0000-0000-0000-000000000002' then
    raise exception 'the queue submission emails both administrators';
  end if;
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, recipient_user_id, dedupe_key)
    values ('00000000-0000-0000-0000-000000001061', 'bogus', 'a0610000-0000-0000-0000-000000000001', 't61:bad')$q$, 'portal_email_outbox_kind_check');
end $$;

-- 3. One digest per person: rita's lists her referral and her submission together.
do $$ declare n integer; begin
  n := public.enqueue_portal_nudges('2026-10-20 22:30+00');
  if n <> 3 then raise exception 'rita, boss and ann each get one digest, got %', n; end if;
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0610000-0000-0000-0000-000000000003:2026-10-20')
     <> '{"appUrlPath":"/partners","companyNames":["Ref Co","Form Co"],"count":2}'::jsonb then
    raise exception 'rita''s digest combines both, oldest first';
  end if;
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0610000-0000-0000-0000-000000000001:2026-10-20')
     <> '{"appUrlPath":"/partners","companyNames":["Queue Co"],"count":1}'::jsonb then
    raise exception 'boss''s digest has the queue submission';
  end if;
  if (select count(*) from form_submission_nudges) <> 3
     or not exists (select 1 from form_submission_nudges
                     where submission_id = 'a061e000-0000-0000-0000-000000000001' and user_id = 'a0610000-0000-0000-0000-000000000003')
     or (select count(*) from form_submission_nudges where submission_id = 'a061e000-0000-0000-0000-000000000002') <> 2 then
    raise exception 'nudge log: S1 for rita, S2 for both administrators';
  end if;
  if (select nudged_at from referral_form_submissions where id = 'a061e000-0000-0000-0000-000000000001') <> '2026-10-20 22:30+00'::timestamptz
     or (select nudged_at from referral_form_submissions where id = 'a061e000-0000-0000-0000-000000000005') is not null then
    raise exception 'nudged_at marks S1 only';
  end if;
  if not exists (select 1 from referral_nudges where referral_id = 'a061f000-0000-0000-0000-000000000001') then
    raise exception 'the partner referral is still logged in referral_nudges';
  end if;
  if public.enqueue_portal_nudges('2026-10-20 22:30+00') <> 0 then raise exception 'a second run queues nothing'; end if;
end $$;

-- 4. After end of day, a late arrival rides the next day's digest; nothing repeats.
do $$ begin
  if public.enqueue_portal_nudges('2026-10-21 22:30+00') <> 1 then raise exception 'only rita is due on the 21st'; end if;
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0610000-0000-0000-0000-000000000003:2026-10-21')
     <> '{"appUrlPath":"/partners","companyNames":["Late Co"],"count":1}'::jsonb then
    raise exception 'Late Co rides the next digest alone';
  end if;
end $$;

-- 5. A deactivated assignee: the new-submission email goes to every active administrator.
do $$ begin
  if (select string_agg(recipient_user_id::text, ',' order by recipient_user_id) from portal_email_outbox
       where kind = 'internal_new_submission' and dedupe_key like 'internal_new_submission:a061e000-0000-0000-0000-000000000013:%')
     is distinct from 'a0610000-0000-0000-0000-000000000011,a0610000-0000-0000-0000-000000000012' then
    raise exception 'Vic Co emails carl and dora, never the deactivated vic';
  end if;
end $$;

-- 6. Each reviewer's own end of day; an attributed but unfinished referral
--    reaches its reviewer, and its triaged submission is not counted again.
do $$ declare n integer; begin
  -- 23:30 UTC: past 18:00 in New York (tess, dora), still 15:30 in Los Angeles (carl).
  n := public.enqueue_portal_nudges('2026-11-10 23:30+00');
  if n <> 2 then raise exception 'tess and dora are due, carl is not yet, got %', n; end if;
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0610000-0000-0000-0000-000000000014:2026-11-10')
     is distinct from '{"appUrlPath":"/partners","companyNames":["Attr Co","Twice Co"],"count":2}'::jsonb then
    raise exception 'tess''s digest has the attributed referral once and her open submission, got %',
      (select payload from portal_email_outbox where dedupe_key = 'internal_nudge:a0610000-0000-0000-0000-000000000014:2026-11-10');
  end if;
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0610000-0000-0000-0000-000000000012:2026-11-10')
     is distinct from '{"appUrlPath":"/partners","companyNames":["Vic Co","Tz Co"],"count":2}'::jsonb then
    raise exception 'dora''s digest has the deactivated rep''s submission and the queue';
  end if;
  if exists (select 1 from portal_email_outbox where kind = 'internal_nudge'
              and recipient_user_id = 'a0610000-0000-0000-0000-000000000011') then
    raise exception 'carl''s end of day has not come yet';
  end if;
  if exists (select 1 from form_submission_nudges where submission_id = 'a061e000-0000-0000-0000-000000000011') then
    raise exception 'the triaged submission S11 is never nudged';
  end if;
  if not exists (select 1 from referral_nudges where referral_id = 'a061f000-0000-0000-0000-000000000011'
                  and user_id = 'a0610000-0000-0000-0000-000000000014')
     or (select nudged_at from referrals where id = 'a061f000-0000-0000-0000-000000000011') is distinct from '2026-11-10 23:30+00'::timestamptz then
    raise exception 'the attributed referral is logged as nudged';
  end if;

  -- 01:30 UTC on the 11th is 17:30 on the 10th in Los Angeles: carl's digest, his local day.
  n := public.enqueue_portal_nudges('2026-11-11 01:30+00');
  if n <> 1 then raise exception 'only carl is due now, got %', n; end if;
  if (select payload from portal_email_outbox
       where dedupe_key = 'internal_nudge:a0610000-0000-0000-0000-000000000011:2026-11-10')
     is distinct from '{"appUrlPath":"/partners","companyNames":["Vic Co","Tz Co"],"count":2}'::jsonb then
    raise exception 'carl''s digest is dated his local day';
  end if;
end $$;

-- 7. Nudged at most once: a submission already in a digest, attributed later and
--    left unfinished, does not come back as a referral the next day.
insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id, submitted_at) values
  ('a061f000-0000-0000-0000-000000000012', 'a061a000-0000-0000-0000-000000000002', 'inbound', 'portal_public', 'submitted', 'Twice Co', 'a0610000-0000-0000-0000-000000000014', '2026-11-10 14:30+00');
update referral_form_submissions
   set triaged_at = '2026-11-11 15:00+00', outcome = 'attributed', referral_id = 'a061f000-0000-0000-0000-000000000012',
       contact_name = null, contact_email = null, contact_phone = null, notes = null
 where id = 'a061e000-0000-0000-0000-000000000012';

do $$ begin
  if public.enqueue_portal_nudges('2026-11-11 23:30+00') <> 0 then
    raise exception 'Twice Co was already in tess''s digest as a submission';
  end if;
end $$;

-- 8. The enqueue trigger never fails the public insert, even when the outbox refuses.
set local client_min_messages = error;
alter table portal_email_outbox add constraint t061_block check (kind <> 'internal_new_submission') not valid;
insert into referral_form_submissions (id, org_id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone, consent_version, submitted_at)
values ('a061e000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000001261', 'tenant', null, 'Blocked Co', 'Ike', 'i@x.example', '5550610015', 0, '2026-11-12 15:00+00');
alter table portal_email_outbox drop constraint t061_block;
reset client_min_messages;

do $$ begin
  if not exists (select 1 from referral_form_submissions where id = 'a061e000-0000-0000-0000-000000000015') then
    raise exception 'the submission is saved even though its email failed';
  end if;
  if exists (select 1 from portal_email_outbox where dedupe_key like 'internal_new_submission:a061e000-0000-0000-0000-000000000015:%') then
    raise exception 'the refused email was not queued';
  end if;
  if position('exception when others' in pg_get_functiondef('public.referral_form_submissions_enqueue_email()'::regprocedure)) = 0 then
    raise exception 'the trigger keeps its catch-all block';
  end if;
end $$;

rollback;
