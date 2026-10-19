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

rollback;
