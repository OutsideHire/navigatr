-- Tests for 20261016000002_referral_purge (Partner Portal Phase 2A).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/051_referral_purge.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture, org A portal-purge (retention 90 days): boss administrator, rita rep.
-- Partner P1 (owner rita) with active portal user PU1 (terms IP, one session,
-- weekly email off). Referrals, dated by when they reached their status:
--   R1 P1 portal declined   100 days ago  purged (has an update, emails, a sent email)
--   R2 P1 portal declined    10 days ago  kept (inside the window)
--   R3 P1 rep    withdrawn   95 days ago  purged
--   R4 P1 portal submitted  200 days ago  kept (not closed)
--   R5 P1 portal declined   130 days ago, already purged yesterday: untouched
-- Org B portal-purge-b (retention 30 days): bob administrator, partner PB with
-- portal user PUB, RB declined 40 days ago: purged.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001051', 'Purge Org',   'portal-purge',   'portal-purge-a1',   true),
  ('00000000-0000-0000-0000-000000001151', 'Purge Org B', 'portal-purge-b', 'portal-purge-b-a1', true);
update organizations set declined_retention_days = 30 where id = '00000000-0000-0000-0000-000000001151';

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0510000-0000-0000-0000-000000000001', 'boss@purge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0510000-0000-0000-0000-000000000002', 'rita@purge.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0510000-0000-0000-0000-000000000003', 'bob@purgeb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0510000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001051', 'admin', 'administrator',      'Boss',     'boss@purge.example', 'prgboss'::ltree,      null),
  ('a0510000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001051', 'rep',   'sales_professional', 'Rita Rep', 'rita@purge.example', 'prgboss.rita'::ltree, 'a0510000-0000-0000-0000-000000000001'),
  ('a0510000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001151', 'admin', 'administrator',      'Bob',      'bob@purgeb.example', 'prgbob'::ltree,       null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a051a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001051', 'a0510000-0000-0000-0000-000000000002', 'a0510000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@purge.example'),
  ('a051a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001151', 'a0510000-0000-0000-0000-000000000003', 'a0510000-0000-0000-0000-000000000003', 'Bea CPA',  'Bea & Co',  'cpa', 'bea@purgeb.example');

insert into portal_users (id, org_id, partner_id, email, status, terms_ip, notification_prefs) values
  ('a051b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001051', 'a051a000-0000-0000-0000-000000000001', 'jane@purge.example', 'active', '198.51.100.7', '{"digest": false}'),
  ('a051b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001151', 'a051a000-0000-0000-0000-000000000002', 'bea@purgeb.example', 'active', '198.51.100.8', '{}');

insert into portal_sessions (org_id, portal_user_id, token_hash, expires_at, ip, user_agent) values
  ('00000000-0000-0000-0000-000000001051', 'a051b000-0000-0000-0000-000000000001', 't051-session', now() + interval '1 day', '198.51.100.7', 'Phone browser');
insert into portal_tokens (org_id, portal_user_id, token_type, token_hash, expires_at, ip) values
  ('00000000-0000-0000-0000-000000001051', 'a051b000-0000-0000-0000-000000000001', 'sign_in_code', 't051-code', now() + interval '10 minutes', '198.51.100.7');
insert into portal_audit_log (org_id, portal_user_id, action, ip) values
  ('00000000-0000-0000-0000-000000001051', 'a051b000-0000-0000-0000-000000000001', 'sign_in', '198.51.100.7');

insert into referrals (
  id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_email,
  contact_phone, address, industry, urgency, notes, consent_text_snapshot, decline_reason,
  decline_note, partner_company_snapshot, assigned_user_id, submitted_by_portal_user_id,
  submitted_at, purged_at
) values
  ('a051f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001051', 'a051a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined',  'Old Bakery',  'Ann', 'ann@old.example',    '5550510001', '1 Old St', 'restaurant', 'this_week', 'Call after 5', 'I have permission to share this business''s contact details.', 'outside_icp',       'Owner is Ann, mobile only', 'Jane & Co', 'a0510000-0000-0000-0000-000000000002', 'a051b000-0000-0000-0000-000000000001', now() - interval '110 days', null),
  ('a051f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001051', 'a051a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined',  'Recent Cafe', 'Rae', 'rae@recent.example', '5550510002', '2 New St', 'restaurant', null,        '',             'I have permission to share this business''s contact details.', 'outside_footprint', null,                        'Jane & Co', 'a0510000-0000-0000-0000-000000000002', 'a051b000-0000-0000-0000-000000000001', now() - interval '12 days',  null),
  ('a051f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001051', 'a051a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered',      'withdrawn', 'Gone Co',     'Gus', null,                 '5550510003', null,       null,         null,        'rep note',     null,                                                          null,                null,                        'Jane & Co', 'a0510000-0000-0000-0000-000000000002', null,                                   now() - interval '100 days', null),
  ('a051f000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001051', 'a051a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Waiting Co',  'Wes', null,                 '5550510004', null,       null,         null,        '',             null,                                                          null,                null,                        'Jane & Co', 'a0510000-0000-0000-0000-000000000002', 'a051b000-0000-0000-0000-000000000001', now() - interval '200 days', null),
  ('a051f000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001051', 'a051a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined',  'Done Co',     null,  null,                 null,         null,       null,         null,        '',             null,                                                          'existing_customer', null,                        'Jane & Co', 'a0510000-0000-0000-0000-000000000002', 'a051b000-0000-0000-0000-000000000001', now() - interval '130 days', now() - interval '1 day'),
  ('a051f000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001151', 'a051a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'declined',  'B Co',        'Bo',  null,                 '5550510006', null,       null,         null,        '',             null,                                                          'outside_icp',       null,                        'Bea & Co',  'a0510000-0000-0000-0000-000000000003', 'a051b000-0000-0000-0000-000000000002', now() - interval '50 days',  null);

-- Each referral was inserted straight into its status, so it has one history
-- row stamped now. Date it to when it reached that status.
update referral_status_history h
   set created_at = v.closed_at
  from (values
    ('a051f000-0000-0000-0000-000000000001'::uuid, now() - interval '100 days'),
    ('a051f000-0000-0000-0000-000000000002'::uuid, now() - interval '10 days'),
    ('a051f000-0000-0000-0000-000000000003'::uuid, now() - interval '95 days'),
    ('a051f000-0000-0000-0000-000000000004'::uuid, now() - interval '200 days'),
    ('a051f000-0000-0000-0000-000000000005'::uuid, now() - interval '120 days'),
    ('a051f000-0000-0000-0000-000000000006'::uuid, now() - interval '40 days')
  ) as v(id, closed_at)
 where h.referral_id = v.id;

-- D1: R1 also has a Google place id, a decline note copied into its history (as
-- decline_referral does), and an audit row carrying a partner IP.
update referrals set place_id = 'ChIJ-purge-r1' where id = 'a051f000-0000-0000-0000-000000000001';
update referral_status_history set note = 'Owner is Ann, mobile only'
 where referral_id = 'a051f000-0000-0000-0000-000000000001';
update referral_status_history set note = 'kept note'
 where referral_id = 'a051f000-0000-0000-0000-000000000002';
insert into portal_audit_log (org_id, portal_user_id, action, ip, referral_id) values
  ('00000000-0000-0000-0000-000000001051', 'a051b000-0000-0000-0000-000000000001', 'sign_in', '198.51.100.9', 'a051f000-0000-0000-0000-000000000001');

-- Published updates (each queues a partner_update email) and one email already sent.
insert into referral_updates (org_id, referral_id, author_user_id, body) values
  ('00000000-0000-0000-0000-000000001051', 'a051f000-0000-0000-0000-000000000001', 'a0510000-0000-0000-0000-000000000002', 'Spoke to Ann, her cell is 5550519999'),
  ('00000000-0000-0000-0000-000000001051', 'a051f000-0000-0000-0000-000000000002', 'a0510000-0000-0000-0000-000000000002', 'Will revisit in spring');
insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, payload, dedupe_key, created_at, sent_at, attempts) values
  ('00000000-0000-0000-0000-000000001051', 'partner_update', 'a051f000-0000-0000-0000-000000000001', 'a051b000-0000-0000-0000-000000000001',
   jsonb_build_object('companyName', 'Old Bakery', 'updateBody', 'Earlier update with Ann''s cell 5550518888'),
   't051:sent', now() - interval '60 days', now() - interval '60 days', 1);

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

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

-- 1. Privileges (before any role switch).
do $$ begin
  if has_function_privilege('authenticated', 'public.purge_declined_referrals(timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.purge_declined_referrals(timestamptz)', 'EXECUTE') then
    raise exception 'purge_declined_referrals must be service role only';
  end if;
  if not has_function_privilege('service_role', 'public.purge_declined_referrals(timestamptz)', 'EXECUTE') then
    raise exception 'service_role should execute purge_declined_referrals';
  end if;
  if not has_function_privilege('authenticated', 'public.portal_purge_user(uuid)', 'EXECUTE') then
    raise exception 'authenticated should execute portal_purge_user';
  end if;
  if has_function_privilege('anon', 'public.portal_purge_user(uuid)', 'EXECUTE') then
    raise exception 'anon must not execute portal_purge_user';
  end if;
  if has_function_privilege('authenticated', 'public._referral_status_since(uuid, referral_status)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._referral_status_since(uuid, referral_status)', 'EXECUTE') then
    raise exception '_referral_status_since must be private';
  end if;
end $$;

-- 2. The daily job is scheduled and calls the function directly.
do $$ declare j record; begin
  select schedule, command into j from cron.job where jobname = 'purge-declined-referrals';
  if j.schedule is distinct from '15 6 * * *' then
    raise exception 'purge-declined-referrals should run daily at 06:15, got %', j.schedule;
  end if;
  if position('public.purge_declined_referrals(now())' in j.command) = 0 then
    raise exception 'purge-declined-referrals runs the wrong command: %', j.command;
  end if;
end $$;

-- 3. Run the purge: R1, R3 and RB go; everything else stays.
do $$ declare n int; r record; begin
  n := public.purge_declined_referrals(now());
  if n <> 3 then raise exception 'expected 3 purged (R1, R3, RB), got %', n; end if;

  select * into r from referrals where id = 'a051f000-0000-0000-0000-000000000001';
  if r.purged_at is null or r.contact_name is not null or r.contact_email is not null
     or r.contact_phone is not null or r.address is not null or r.notes <> ''
     or r.consent_text_snapshot is not null or r.decline_note is not null
     or r.place_id is not null then
    raise exception 'R1 personal details should be cleared: %', row_to_json(r);
  end if;
  if r.company_name <> 'Old Bakery' or r.industry <> 'restaurant' or r.urgency <> 'this_week'
     or r.decline_reason <> 'outside_icp' or r.partner_company_snapshot <> 'Jane & Co'
     or r.status <> 'declined' or r.partner_id <> 'a051a000-0000-0000-0000-000000000001'
     or r.source <> 'portal_signed_in'
     or r.assigned_user_id is distinct from 'a0510000-0000-0000-0000-000000000002'
     or r.submitted_at is null
     or r.submitted_at not between now() - interval '110 days 1 hour' and now() - interval '109 days 23 hours' then
    raise exception 'R1 kept fields changed: %', row_to_json(r);
  end if;

  select * into r from referrals where id = 'a051f000-0000-0000-0000-000000000003';
  if r.purged_at is null or r.contact_name is not null or r.notes <> '' then
    raise exception 'R3 (withdrawn 95 days ago) should be purged: %', row_to_json(r);
  end if;
  select * into r from referrals where id = 'a051f000-0000-0000-0000-000000000006';
  if r.purged_at is null or r.contact_name is not null then
    raise exception 'RB (org retention 30 days) should be purged: %', row_to_json(r);
  end if;
  select * into r from referrals where id = 'a051f000-0000-0000-0000-000000000002';
  if r.purged_at is not null or r.contact_name is distinct from 'Rae' then
    raise exception 'R2 is inside the window and must be kept: %', row_to_json(r);
  end if;
  select * into r from referrals where id = 'a051f000-0000-0000-0000-000000000004';
  if r.purged_at is not null or r.contact_name is distinct from 'Wes' then
    raise exception 'a submitted referral is never purged: %', row_to_json(r);
  end if;
  select * into r from referrals where id = 'a051f000-0000-0000-0000-000000000005';
  if r.purged_at > now() - interval '12 hours' then
    raise exception 'an already purged referral keeps its purge date: %', r.purged_at;
  end if;

  select count(*) into n from referral_status_history where referral_id = 'a051f000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'status history must be kept as is, got % rows', n; end if;
  if exists (select 1 from referral_status_history
              where referral_id = 'a051f000-0000-0000-0000-000000000001' and note is not null) then
    raise exception 'R1 history note must be erased (rows kept)';
  end if;
  if not exists (select 1 from referral_status_history
                  where referral_id = 'a051f000-0000-0000-0000-000000000002' and note = 'kept note') then
    raise exception 'R2 history note must stay';
  end if;
end $$;

-- 4. Updates, emails and the audit trail.
do $$ declare n int; begin
  select count(*) into n from referral_updates where referral_id = 'a051f000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'R1 published updates should be deleted, % left', n; end if;
  select count(*) into n from referral_updates where referral_id = 'a051f000-0000-0000-0000-000000000002';
  if n <> 1 then raise exception 'R2 update must stay'; end if;

  select count(*) into n from portal_email_outbox
   where referral_id = 'a051f000-0000-0000-0000-000000000001'
     and sent_at is null and dropped_at is null and failed_at is null;
  if n <> 0 then raise exception 'no R1 email may stay pending, % left', n; end if;
  select count(*) into n from portal_email_outbox
   where referral_id = 'a051f000-0000-0000-0000-000000000001' and last_error = 'purged';
  if n <> 3 then raise exception 'R1 received, new-referral and update emails should be dropped as purged, got %', n; end if;
  select count(*) into n from portal_email_outbox
   where referral_id = 'a051f000-0000-0000-0000-000000000001' and payload->>'updateBody' is not null;
  if n <> 0 then raise exception 'no R1 email payload may keep update text, % do', n; end if;
  if not exists (select 1 from portal_email_outbox where dedupe_key = 't051:sent' and sent_at is not null and dropped_at is null) then
    raise exception 'a sent email stays sent';
  end if;

  select count(*) into n from portal_email_outbox
   where referral_id = 'a051f000-0000-0000-0000-000000000002'
     and sent_at is null and dropped_at is null and failed_at is null;
  if n <> 3 then raise exception 'R2 emails must stay pending, got %', n; end if;

  select count(*) into n from portal_audit_log
   where action = 'purge' and referral_id in ('a051f000-0000-0000-0000-000000000001',
                                             'a051f000-0000-0000-0000-000000000003',
                                             'a051f000-0000-0000-0000-000000000006');
  if n <> 3 then raise exception 'one purge audit row per purged referral, got %', n; end if;
  if exists (select 1 from portal_audit_log where action = 'purge' and ip is not null) then
    raise exception 'purge audit rows must carry no IP';
  end if;
  if not exists (select 1 from portal_audit_log
                  where referral_id = 'a051f000-0000-0000-0000-000000000001' and action = 'sign_in') then
    raise exception 'the R1 sign_in audit row must be kept (only its IP is erased)';
  end if;
  if exists (select 1 from portal_audit_log
              where referral_id = 'a051f000-0000-0000-0000-000000000001' and ip is not null) then
    raise exception 'R1 audit rows must not keep an IP after the purge';
  end if;
end $$;

-- 5. A second run finds nothing.
do $$ begin
  if public.purge_declined_referrals(now()) <> 0 then raise exception 'second run must purge nothing'; end if;
end $$;

-- 6. Erase a partner's portal identity (role switches from here on).
do $$ begin
  perform _t_act('a0510000-0000-0000-0000-000000000002');
  perform _t_raises($q$select public.portal_purge_user('a051a000-0000-0000-0000-000000000001')$q$, 'not_authorized');
  perform _t_act('a0510000-0000-0000-0000-000000000003');
  perform _t_raises($q$select public.portal_purge_user('a051a000-0000-0000-0000-000000000001')$q$, 'portal_user_not_found');
  perform _t_act('a0510000-0000-0000-0000-000000000001');
  perform _t_raises($q$select public.portal_purge_user('a051a000-0000-0000-0000-0000000000ff')$q$, 'portal_user_not_found');
  perform public.portal_purge_user('a051a000-0000-0000-0000-000000000001');
end $$;

do $$ declare u record; n int; begin
  perform set_config('role', 'postgres', true);
  select * into u from portal_users where id = 'a051b000-0000-0000-0000-000000000001';
  if u.status <> 'revoked'
     or u.email <> ('purged+' || u.id::text || '@invalid')
     or u.terms_ip is not null
     or u.notification_prefs <> '{}'::jsonb then
    raise exception 'portal user should be erased: %', row_to_json(u);
  end if;
  select count(*) into n from portal_sessions
   where portal_user_id = 'a051b000-0000-0000-0000-000000000001'
     and (revoked_at is null or ip is not null or user_agent is not null);
  if n <> 0 then raise exception 'sessions must be revoked with no IP or user agent'; end if;
  select count(*) into n from portal_tokens
   where portal_user_id = 'a051b000-0000-0000-0000-000000000001'
     and (revoked_at is null or ip is not null);
  if n <> 0 then raise exception 'tokens must be revoked with no IP'; end if;
  if not exists (select 1 from portal_tokens where token_hash = 't051-code') then
    raise exception 'the token row is kept, just revoked';
  end if;
  select count(*) into n from portal_audit_log
   where portal_user_id = 'a051b000-0000-0000-0000-000000000001' and ip is not null;
  if n <> 0 then raise exception 'audit rows must not keep the partner IP'; end if;
  select count(*) into n from portal_audit_log
   where portal_user_id = 'a051b000-0000-0000-0000-000000000001' and action = 'purge'
     and actor_user_id = 'a0510000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'the erase is audited with the acting admin'; end if;
  select count(*) into n from portal_email_outbox
   where portal_user_id = 'a051b000-0000-0000-0000-000000000001'
     and sent_at is null and dropped_at is null and failed_at is null;
  if n <> 0 then raise exception 'an erased partner gets no more email, % pending', n; end if;
  select count(*) into n from referrals where submitted_by_portal_user_id = 'a051b000-0000-0000-0000-000000000001';
  if n <> 4 then raise exception 'referrals are kept, got %', n; end if;
  if not exists (select 1 from portal_users where id = 'a051b000-0000-0000-0000-000000000002'
                  and status = 'active' and email = 'bea@purgeb.example') then
    raise exception 'another org''s portal user must be untouched';
  end if;
end $$;

rollback;
