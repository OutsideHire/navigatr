-- Tests for 20261012000004_portal_referral_read (Partner Portal Phase 1B).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/043_portal_referral_read.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- Fixture, org A portal-read: boss; rep1 Rita Rep (rita@read.example) owns P1 and P2.
--   R1 P1 portal  submitted  Fresh Bakery   2 days ago
--   R2 P1 rep     won        Won Co         40 days ago, deal DW worth $5,000, extra history 1 hour ago
--   R3 P1 portal  declined   Nope Co        100 days ago (internal decline reason and note)
--   R4 P1 rep     accepted   Logged Co      1 day ago (rep-typed notes)
--   R5 P2 portal  submitted  Other Partner Co
--   RO P1 outbound referral
-- Org B portal-read-b: PB with RB.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001043', 'Read Org',   'portal-read',   'portal-read-a1', true),
  ('00000000-0000-0000-0000-000000001143', 'Read Org B', 'portal-read-b', 'portal-read-b1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0430000-0000-0000-0000-000000000001', 'boss@read.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0430000-0000-0000-0000-000000000002', 'rita@read.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0430000-0000-0000-0000-000000000003', 'bossb@read.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0430000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001043', 'admin', 'administrator',      'Boss',      'boss@read.example',  'readboss'::ltree,      null),
  ('a0430000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001043', 'rep',   'sales_professional', 'Rita Rep',  'rita@read.example',  'readboss.rita'::ltree, 'a0430000-0000-0000-0000-000000000001'),
  ('a0430000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001143', 'admin', 'administrator',      'Boss B',    'bossb@read.example', 'readbossb'::ltree,     null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a043a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001043', 'a0430000-0000-0000-0000-000000000002', 'a0430000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@read.example'),
  ('a043a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001043', 'a0430000-0000-0000-0000-000000000002', 'a0430000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@read.example'),
  ('a043a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001143', 'a0430000-0000-0000-0000-000000000003', 'a0430000-0000-0000-0000-000000000003', 'Bea CPA',  'Bea & Co',  'cpa', 'bea@read.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a043b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'jane@read.example', 'active'),
  ('a043b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000002', 'kim@read.example',  'active'),
  ('a043b000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001143', 'a043a000-0000-0000-0000-000000000003', 'bea@read.example',  'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a043d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001043', 'a0430000-0000-0000-0000-000000000002', 'Won Co', '9 Gold St', 'Wes', 'wes@won.example', '5550100200', 500000, 'won', 'partner_referral');

insert into referrals (
  id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_email,
  contact_phone, address, industry, urgency, notes, deal_id, assigned_user_id,
  submitted_by_portal_user_id, decline_reason, decline_note, submitted_at
) values
  ('a043f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'inbound',  'portal_signed_in', 'submitted', 'Fresh Bakery',     'Ann', 'ann@fresh.example',  '5550100100', '5 Oak St',  'restaurant', 'this_week', 'Wants a demo',          null,                                   'a0430000-0000-0000-0000-000000000002', 'a043b000-0000-0000-0000-000000000001', null,          null,                    now() - interval '2 days'),
  ('a043f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered',      'won',       'Won Co',           'Wes', 'wes@won.example',    '5550100200', '9 Gold St', 'retail',     null,        'internal: big margins', 'a043d000-0000-0000-0000-000000000001', 'a0430000-0000-0000-0000-000000000002', null,                                   null,          null,                    now() - interval '40 days'),
  ('a043f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'inbound',  'portal_signed_in', 'declined',  'Nope Co',          'Nia', null,                 '5550100300', null,        null,         null,        'please call',           null,                                   'a0430000-0000-0000-0000-000000000002', 'a043b000-0000-0000-0000-000000000001', 'outside_icp', 'internal decline note', now() - interval '100 days'),
  ('a043f000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered',      'accepted',  'Logged Co',        'Bob', 'bob@logged.example', '5550100400', '4 Log Rd',  null,         null,        'rep secret note',       null,                                   'a0430000-0000-0000-0000-000000000002', null,                                   null,          null,                    now() - interval '1 day'),
  ('a043f000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000002', 'inbound',  'portal_signed_in', 'submitted', 'Other Partner Co', 'Oz',  null,                 '5550100500', null,        null,         null,        '',                      null,                                   'a0430000-0000-0000-0000-000000000002', 'a043b000-0000-0000-0000-000000000002', null,          null,                    now() - interval '3 days'),
  ('a043f000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered',      'accepted',  'Outbound Co',      null,  null,                 null,         null,        null,         null,        '',                      null,                                   'a0430000-0000-0000-0000-000000000002', null,                                   null,          null,                    now() - interval '5 days'),
  ('a043f000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000001143', 'a043a000-0000-0000-0000-000000000003', 'inbound',  'portal_signed_in', 'submitted', 'Tenant B Co',      'Bo',  null,                 '5550100700', null,        null,         null,        '',                      null,                                   'a0430000-0000-0000-0000-000000000003', 'a043b000-0000-0000-0000-000000000003', null,          null,                    now() - interval '1 day');

-- History rows were written at transaction time; date them like real life,
-- then give R2 a later change so it is the most recently active.
update referral_status_history h
   set created_at = r.submitted_at
  from referrals r
 where r.id = h.referral_id
   and r.org_id in ('00000000-0000-0000-0000-000000001043', '00000000-0000-0000-0000-000000001143');
insert into referral_status_history (org_id, referral_id, from_status, to_status, actor_type, created_at) values
  ('00000000-0000-0000-0000-000000001043', 'a043f000-0000-0000-0000-000000000002', 'working', 'won', 'system', now() - interval '1 hour');

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
    'public.portal_list_referrals(uuid, uuid, timestamptz)',
    'public.portal_get_referral(uuid, uuid, uuid, uuid, text)',
    'public.portal_referral_history(uuid, uuid, uuid)',
    'public.portal_dashboard_stats(uuid, uuid, timestamptz)',
    'public.portal_withdraw_referral(uuid, uuid, uuid, uuid, text)',
    'public.portal_claim_transcribe(uuid, uuid, uuid, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
end $$;

-- 2. List: own inbound referrals only, latest activity first, window on submitted_at.
do $$ declare ids uuid[]; r record; begin
  select array_agg(l.id order by l.n) into ids
    from public.portal_list_referrals('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', null)
         with ordinality as l(id, ref, company_name, status, submitted_at, last_activity_at, n);
  if ids is distinct from array['a043f000-0000-0000-0000-000000000002', 'a043f000-0000-0000-0000-000000000004',
                                'a043f000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000003']::uuid[] then
    raise exception 'all-time list wrong or out of order: %', ids;
  end if;

  select * into r from public.portal_list_referrals('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', null) l
   where l.id = 'a043f000-0000-0000-0000-000000000001';
  if r.ref <> 'REF-A043F000' or r.status <> 'submitted' or r.company_name <> 'Fresh Bakery' then
    raise exception 'list row wrong: %', row_to_json(r);
  end if;

  select array_agg(l.id order by l.n) into ids
    from public.portal_list_referrals('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', now() - interval '30 days')
         with ordinality as l(id, ref, company_name, status, submitted_at, last_activity_at, n);
  if ids is distinct from array['a043f000-0000-0000-0000-000000000004', 'a043f000-0000-0000-0000-000000000001']::uuid[] then
    raise exception '30-day list wrong: %', ids;
  end if;

  select array_agg(l.id) into ids
    from public.portal_list_referrals('00000000-0000-0000-0000-000000001143', 'a043a000-0000-0000-0000-000000000003', null) l;
  if ids is distinct from array['a043f000-0000-0000-0000-000000000007']::uuid[] then
    raise exception 'org B list wrong: %', ids;
  end if;
  if exists (select 1 from public.portal_list_referrals('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000003', null)) then
    raise exception 'a partner paired with the wrong org must see nothing';
  end if;
end $$;

-- 3. Detail: allowlisted fields, rep-typed text hidden, other partners and orgs invisible.
do $$ declare r record; n int; begin
  select * into r from public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000001', '10.43.0.1');
  if r.company_name <> 'Fresh Bakery' or r.contact_name <> 'Ann' or r.contact_email <> 'ann@fresh.example'
     or r.contact_phone <> '5550100100' or r.address <> '5 Oak St' or r.industry <> 'restaurant'
     or r.urgency <> 'this_week' or r.notes <> 'Wants a demo' or r.status <> 'submitted'
     or r.source <> 'portal_signed_in' or r.ref <> 'REF-A043F000' then
    raise exception 'portal referral detail wrong: %', row_to_json(r);
  end if;
  if r.rep_name <> 'Rita Rep' or r.rep_email <> 'rita@read.example' or not r.can_withdraw then
    raise exception 'rep contact or withdraw flag wrong: %', row_to_json(r);
  end if;

  select * into r from public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000004', null);
  if r.company_name <> 'Logged Co' or r.contact_name is not null or r.contact_email is not null or r.contact_phone is not null
     or r.address is not null or r.notes is not null or r.can_withdraw then
    raise exception 'a rep-logged referral must hide rep-typed detail: %', row_to_json(r);
  end if;

  select count(*) into n from public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000005', null);
  if n <> 0 then raise exception 'another partner''s referral must look missing'; end if;
  select count(*) into n from public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000007', null);
  if n <> 0 then raise exception 'another org''s referral must look missing'; end if;
  select count(*) into n from public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000006', null);
  if n <> 0 then raise exception 'an outbound referral must look missing'; end if;
  select count(*) into n from public.portal_get_referral('00000000-0000-0000-0000-000000001143', 'a043a000-0000-0000-0000-000000000003',
    'a043b000-0000-0000-0000-000000000003', 'a043f000-0000-0000-0000-000000000007', null);
  if n <> 1 then raise exception 'org B should see its own referral'; end if;

  perform _t_raises($q$select * from public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000002', 'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000005', null)$q$, 'not_authorized');

  -- A second look within the hour is not audited again.
  perform public.portal_get_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000001', '10.43.0.1');
  select count(*) into n from portal_audit_log
   where action = 'view_referral' and portal_user_id = 'a043b000-0000-0000-0000-000000000001'
     and referral_id = 'a043f000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'detail views should be audited once per hour, got %', n; end if;
end $$;

-- 4. History: oldest first, scoped like the detail.
do $$ declare s text[]; n int; begin
  select array_agg(h.status::text order by h.n) into s
    from public.portal_referral_history('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
                                        'a043f000-0000-0000-0000-000000000002')
         with ordinality as h(status, created_at, n);
  if s is distinct from array['won', 'won'] then raise exception 'history for R2 wrong: %', s; end if;
  select count(*) into n from public.portal_referral_history('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
                                                             'a043f000-0000-0000-0000-000000000005');
  if n <> 0 then raise exception 'another partner''s history must look missing'; end if;
end $$;

-- 5. Stats with windows and the value flag.
do $$ declare r record; begin
  select * into r from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', null);
  if r.submitted <> 4 or r.active <> 2 or r.closed_won <> 1 or r.not_moving_forward <> 1
     or r.won_value_cents <> 500000 or r.value_visible then
    raise exception 'all-time stats wrong: %', row_to_json(r);
  end if;
  select * into r from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', now() - interval '30 days');
  if r.submitted <> 2 or r.active <> 2 or r.closed_won <> 0 or r.not_moving_forward <> 0 or r.won_value_cents <> 0 then
    raise exception '30-day stats wrong: %', row_to_json(r);
  end if;
  update organizations set partner_value_visibility = true where id = '00000000-0000-0000-0000-000000001043';
  select * into r from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', null);
  if not r.value_visible then raise exception 'value flag should follow the org setting'; end if;
  select * into r from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000003', null);
  if r.submitted <> 0 or r.won_value_cents <> 0 then raise exception 'a mismatched partner must count nothing'; end if;
end $$;

-- 6. Withdraw: only the partner's own portal submissions, only while submitted.
do $$
declare
  head text := $q$select public.portal_withdraw_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001', 'a043b000-0000-0000-0000-000000000001', $q$;
  h record;
begin
  perform _t_raises(head || $q$'a043f000-0000-0000-0000-000000000004', null)$q$, 'not_withdrawable');
  perform _t_raises(head || $q$'a043f000-0000-0000-0000-000000000002', null)$q$, 'not_withdrawable');
  perform _t_raises(head || $q$'a043f000-0000-0000-0000-000000000005', null)$q$, 'referral_not_found');
  perform _t_raises(head || $q$'a043f000-0000-0000-0000-000000000007', null)$q$, 'referral_not_found');

  perform public.portal_withdraw_referral('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
    'a043b000-0000-0000-0000-000000000001', 'a043f000-0000-0000-0000-000000000001', '10.43.0.2');
  if (select status from referrals where id = 'a043f000-0000-0000-0000-000000000001') <> 'withdrawn' then
    raise exception 'R1 should be withdrawn';
  end if;
  select * into h from referral_status_history
   where referral_id = 'a043f000-0000-0000-0000-000000000001' and to_status = 'withdrawn';
  if h.from_status <> 'submitted' or h.actor_type <> 'partner' or h.actor_id is distinct from 'a043b000-0000-0000-0000-000000000001' then
    raise exception 'withdraw history should credit the partner: %', row_to_json(h);
  end if;
  if not exists (select 1 from portal_audit_log where action = 'withdraw' and referral_id = 'a043f000-0000-0000-0000-000000000001'
                   and portal_user_id = 'a043b000-0000-0000-0000-000000000001' and ip = '10.43.0.2') then
    raise exception 'withdraw should be audited';
  end if;
  if coalesce(current_setting('navigatr.referral_actor', true), '') <> '' then
    raise exception 'actor setting must be cleared after withdraw';
  end if;
  perform _t_raises(head || $q$'a043f000-0000-0000-0000-000000000001', null)$q$, 'not_withdrawable');
end $$;

-- 7. Transcribe claim: 30 per portal user per hour.
do $$ declare n int; begin
  if not public.portal_claim_transcribe('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
                                        'a043b000-0000-0000-0000-000000000001', '10.43.0.3') then
    raise exception 'the first transcription should be allowed';
  end if;
  insert into portal_audit_log (org_id, portal_user_id, action, created_at)
  select '00000000-0000-0000-0000-000000001043', 'a043b000-0000-0000-0000-000000000001', 'transcribe', now() - interval '5 minutes'
    from generate_series(1, 29);
  if public.portal_claim_transcribe('00000000-0000-0000-0000-000000001043', 'a043a000-0000-0000-0000-000000000001',
                                    'a043b000-0000-0000-0000-000000000001', '10.43.0.3') then
    raise exception 'the 31st transcription in an hour must be refused';
  end if;
  select count(*) into n from portal_audit_log where action = 'transcribe' and portal_user_id = 'a043b000-0000-0000-0000-000000000001';
  if n <> 30 then raise exception 'a refused claim must not be recorded, got %', n; end if;
end $$;

rollback;
