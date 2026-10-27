-- Tests for 20261020000002_form_submission_triage (Partner Portal Phase 2B-2,
-- FR-PORT-31, 32, 49, 51).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/060_form_submission_triage.sql
-- Self-cleans via ROLLBACK.
--
-- Org A pf-tri (portal and public form on, consent v1 "I may share this."):
--   boss administrator; mia manager under boss; rita and rob reps under mia.
--   Partner P1 Jane CPA (owner rita, active portal user). Deal D1 Fresh Bakery
--   (owner rita, phone 5550600001). Referral R1 Corner Cafe (P1, rita, phone 5550600002).
--   Partner P3 Rob CPA (owner rob, invisible to rita). Deal D3 Rob Deal (owner rob).
--   Referral R2 Gus Sandwiches (won, P1, rita, phone 5550600016, same as S6).
--   Referral R3 Hal Diner (working, P3, rob, phone 5550600017, same as S7).
-- Org B pf-tri-b: bob administrator, partner P2, deal D2.
-- Submissions (org A): S1 Attr Co, S2 Accept Co, S3 Decline Co, S4 Fresh Bakery LLC,
--   S6 Subway #42 (all rita, personal link); S5 Corner Cafe (company link, administrator
--   queue); S7 Rob Co (rob).

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, consent_text, consent_version) values
  ('00000000-0000-0000-0000-000000001060', 'Triage Org',   'pf-tri',   'pf-tri-a1',   true, 'I may share this.', 1),
  ('00000000-0000-0000-0000-000000001160', 'Triage Org B', 'pf-tri-b', 'pf-tri-b-a1', true, null,                0);
update organizations set public_form_enabled = true where id = '00000000-0000-0000-0000-000000001060';

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0600000-0000-0000-0000-000000000001', 'boss@tri.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0600000-0000-0000-0000-000000000002', 'mia@tri.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0600000-0000-0000-0000-000000000003', 'rita@tri.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0600000-0000-0000-0000-000000000004', 'rob@tri.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0600000-0000-0000-0000-000000000005', 'bob@trib.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0600000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001060', 'admin',   'administrator',      'Boss',     'boss@tri.example', 'triboss'::ltree,          null),
  ('a0600000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001060', 'manager', 'sales_manager',      'Mia Mgr',  'mia@tri.example',  'triboss.mia'::ltree,      'a0600000-0000-0000-0000-000000000001'),
  ('a0600000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001060', 'rep',     'sales_professional', 'Rita Rep', 'rita@tri.example', 'triboss.mia.rita'::ltree, 'a0600000-0000-0000-0000-000000000002'),
  ('a0600000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001060', 'rep',     'sales_professional', 'Rob Rep',  'rob@tri.example',  'triboss.mia.rob'::ltree,  'a0600000-0000-0000-0000-000000000002'),
  ('a0600000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001160', 'admin',   'administrator',      'Bob',      'bob@trib.example', 'tribob'::ltree,           null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a060a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001060', 'a0600000-0000-0000-0000-000000000003', 'a0600000-0000-0000-0000-000000000003', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@tri.example'),
  ('a060a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001160', 'a0600000-0000-0000-0000-000000000005', 'a0600000-0000-0000-0000-000000000005', 'Bob CPA',  'Bob & Co',  'cpa', 'bobcpa@trib.example'),
  ('a060a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001060', 'a0600000-0000-0000-0000-000000000004', 'a0600000-0000-0000-0000-000000000004', 'Rob CPA',  'Rob & Co',  'cpa', 'robcpa@tri.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a060b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001060', 'a060a000-0000-0000-0000-000000000001', 'jane@tri.example', 'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a060d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001060', 'a0600000-0000-0000-0000-000000000003', 'Fresh Bakery', '1 Main St', 'Fay', 'fay@fresh.example', '+15550600001', 100000, 'contacted', 'path'),
  ('a060d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001160', 'a0600000-0000-0000-0000-000000000005', 'Other Co',     '2 Main St', 'Oz',  'oz@other.example',  '+15550600099', 100000, 'new',       'path'),
  ('a060d000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001060', 'a0600000-0000-0000-0000-000000000004', 'Rob Deal',     '3 Main St', 'Ray', 'ray@rob.example',   '+15550600077', 100000, 'new',       'path');

insert into referrals (id, partner_id, direction, source, status, company_name, contact_phone, assigned_user_id) values
  ('a060f000-0000-0000-0000-000000000001', 'a060a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'submitted', 'Corner Cafe',    '5550600002', 'a0600000-0000-0000-0000-000000000003'),
  ('a060f000-0000-0000-0000-000000000002', 'a060a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'won',       'Gus Sandwiches', '5550600016', 'a0600000-0000-0000-0000-000000000003'),
  ('a060f000-0000-0000-0000-000000000003', 'a060a000-0000-0000-0000-000000000003', 'inbound', 'rep_entered', 'working',   'Hal Diner',      '5550600017', 'a0600000-0000-0000-0000-000000000004');

insert into referral_form_submissions (
  id, org_id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone,
  notes, referred_by_text, referrer_email, consent_version, consent_text_snapshot, submitter_ip, submitted_at
) values
  ('a060e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001060', 'user',   'a0600000-0000-0000-0000-000000000003', 'Attr Co',          'Ann', 'ann@attr.example',    '5550600011',     'Wants a demo',    'Jane at Jane & Co', 'jane@janeco.example', 1, 'I may share this.', '198.51.100.60', '2026-10-01 15:00+00'),
  ('a060e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001060', 'user',   'a0600000-0000-0000-0000-000000000003', 'Accept Co',        'Bea', 'bea@accept.example',  '5550600012',     'Call after 3',    'A neighbor',        null,                  1, 'I may share this.', '198.51.100.60', now()),
  ('a060e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001060', 'user',   'a0600000-0000-0000-0000-000000000003', 'Decline Co',       'Cal', 'cal@decline.example', '5550600013',     'Too small maybe', null,                null,                  1, 'I may share this.', '198.51.100.60', now()),
  ('a060e000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001060', 'user',   'a0600000-0000-0000-0000-000000000003', 'Fresh Bakery LLC', 'Dan', 'dan@fresh.example',   '(555) 060-0001', 'Second location', null,                null,                  1, 'I may share this.', '198.51.100.60', now()),
  ('a060e000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001060', 'tenant', null,                                   'Corner Cafe',      'Eve', 'eve@corner.example',  '555-060-0002',   'Saw your sign',   null,                null,                  1, 'I may share this.', '198.51.100.60', now()),
  ('a060e000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001060', 'user',   'a0600000-0000-0000-0000-000000000003', 'Subway #42',       'Gus', 'gus@sub.example',     '5550600016',     'Franchise',       null,                null,                  1, 'I may share this.', '198.51.100.60', now()),
  ('a060e000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000001060', 'user',   'a0600000-0000-0000-0000-000000000004', 'Rob Co',           'Hal', 'hal@rob.example',     '5550600017',     'Busy mornings',   null,                null,                  1, 'I may share this.', '198.51.100.60', now());

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

-- The fixture submissions this user can see, by company, comma-joined.
create or replace function _t_seen(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform _t_act(p_user);
  select string_agg(s.company_name, ',' order by s.company_name) into v
    from referral_form_submissions s
   where s.id::text like 'a060e000-%' and s.triaged_at is null and s.purged_at is null;
  perform set_config('role', 'postgres', true);
  return coalesce(v, '');
end $$;

-- 1. Privileges (before any role switch).
do $$ declare f text; begin
  foreach f in array array[
    'public.form_submission_advice(uuid)',
    'public.attribute_form_submission(uuid, uuid)',
    'public.accept_form_submission(uuid)',
    'public.decline_form_submission(uuid, referral_decline_reason, text)',
    'public.merge_form_submission(uuid, uuid)',
    'public.reassign_form_submission(uuid, uuid)'] loop
    if not has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '% is for signed-in users only', f;
    end if;
  end loop;
  foreach f in array array[
    'public._form_submission_for_update(uuid)',
    'public._form_submission_close(uuid, text, uuid, uuid)',
    'public._form_submission_note(referral_form_submissions, boolean)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('service_role', f, 'EXECUTE')
       or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '% is private', f;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.referral_form_submissions', 'submitter_ip', 'SELECT')
     or has_table_privilege('authenticated', 'public.referral_form_submissions', 'UPDATE') then
    raise exception 'authenticated still never reads the IP and never writes submissions';
  end if;
end $$;

-- 2. What each person sees is exactly what they may triage (Deviation 3).
do $$ begin
  if _t_seen('a0600000-0000-0000-0000-000000000003') <> 'Accept Co,Attr Co,Decline Co,Fresh Bakery LLC,Subway #42' then
    raise exception 'rita sees her own, got %', _t_seen('a0600000-0000-0000-0000-000000000003');
  end if;
  if _t_seen('a0600000-0000-0000-0000-000000000004') <> 'Rob Co' then
    raise exception 'rob sees only his own';
  end if;
  if _t_seen('a0600000-0000-0000-0000-000000000002') <> 'Accept Co,Attr Co,Decline Co,Fresh Bakery LLC,Rob Co,Subway #42' then
    raise exception 'mia sees her team but not the administrator queue';
  end if;
  if _t_seen('a0600000-0000-0000-0000-000000000001') <> 'Accept Co,Attr Co,Corner Cafe,Decline Co,Fresh Bakery LLC,Rob Co,Subway #42' then
    raise exception 'boss sees everything including the queue';
  end if;
  if _t_seen('a0600000-0000-0000-0000-000000000005') <> '' then
    raise exception 'another org sees nothing';
  end if;
end $$;

-- 3. Advice at triage time, inside the reviewer's visibility (FR-PORT-46 style, advisory).
do $$ declare a record; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  select * into a from public.form_submission_advice('a060e000-0000-0000-0000-000000000004');
  if a.dup_deal_id is distinct from 'a060d000-0000-0000-0000-000000000001'::uuid
     or a.dup_deal_company is distinct from 'Fresh Bakery'
     or a.dup_referral_id is not null or a.chain_brand is not null then
    raise exception 'S4 matches D1 by phone and name, got %', row_to_json(a);
  end if;
  -- R2 shares S6's phone but is won, so it is not an open referral.
  select * into a from public.form_submission_advice('a060e000-0000-0000-0000-000000000006');
  if a.chain_brand is distinct from 'Subway' or a.dup_deal_id is not null or a.dup_referral_id is not null then
    raise exception 'S6 is a chain only (the won R2 is not open), got %', row_to_json(a);
  end if;
  perform _t_act('a0600000-0000-0000-0000-000000000001');
  select * into a from public.form_submission_advice('a060e000-0000-0000-0000-000000000005');
  if a.dup_referral_id is distinct from 'a060f000-0000-0000-0000-000000000001'::uuid
     or a.dup_referral_company is distinct from 'Corner Cafe' or a.dup_deal_id is not null then
    raise exception 'S5 matches the open referral R1, got %', row_to_json(a);
  end if;
  perform _t_act('a0600000-0000-0000-0000-000000000004');
  -- R3 is working, which is still open.
  select * into a from public.form_submission_advice('a060e000-0000-0000-0000-000000000007');
  if a.dup_referral_id is distinct from 'a060f000-0000-0000-0000-000000000003'::uuid then
    raise exception 'S7 matches the working referral R3, got %', row_to_json(a);
  end if;
  perform _t_raises('select * from public.form_submission_advice(''a060e000-0000-0000-0000-000000000004'')', 'submission_not_found');
  perform _t_act('a0600000-0000-0000-0000-000000000005');
  perform _t_raises('select * from public.form_submission_advice(''a060e000-0000-0000-0000-000000000004'')', 'submission_not_found');
  perform set_config('role', 'postgres', true);
end $$;

-- 4. Who may attribute, and to whom.
do $$ begin
  -- A teammate's submission reads as missing, never as forbidden.
  perform _t_act('a0600000-0000-0000-0000-000000000004');
  perform _t_raises('select public.attribute_form_submission(''a060e000-0000-0000-0000-000000000001'', ''a060a000-0000-0000-0000-000000000001'')', 'submission_not_found');
  perform _t_act('a0600000-0000-0000-0000-000000000005');
  perform _t_raises('select public.attribute_form_submission(''a060e000-0000-0000-0000-000000000001'', ''a060a000-0000-0000-0000-000000000001'')', 'submission_not_found');
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  perform _t_raises('select public.attribute_form_submission(''a060e000-0000-0000-0000-000000000001'', ''a060a000-0000-0000-0000-000000000002'')', 'partner_not_visible');
  -- Same org, but rob's partner is outside rita's visibility.
  perform _t_raises('select public.attribute_form_submission(''a060e000-0000-0000-0000-000000000001'', ''a060a000-0000-0000-0000-000000000003'')', 'partner_not_visible');
  perform _t_raises('select public.attribute_form_submission(''a060e000-0000-0000-0000-0000000000ff'', ''a060a000-0000-0000-0000-000000000001'')', 'submission_not_found');
  perform set_config('role', 'postgres', true);
end $$;

-- 5. Attribution makes a referral that keeps the original time (FR-PORT-49), the
--    reviewer keeps it, the partner gets no "Received" email; then the EXISTING
--    accept_referral finishes it.
do $$ declare a record; v uuid; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  select * into a from public.attribute_form_submission('a060e000-0000-0000-0000-000000000001', 'a060a000-0000-0000-0000-000000000001');
  v := a.referral_id;
  if v is null or a.duplicate_of_referral_id is not null or a.duplicate_of_deal_id is not null
     or a.assigned_user_id is distinct from 'a0600000-0000-0000-0000-000000000003'::uuid then
    raise exception 'S1 is not a duplicate and rita keeps it, got %', row_to_json(a);
  end if;
  perform set_config('t.ref', v::text, true);
  perform _t_raises('select public.attribute_form_submission(''a060e000-0000-0000-0000-000000000001'', ''a060a000-0000-0000-0000-000000000001'')', 'submission_handled');
  perform set_config('role', 'postgres', true);
end $$;

do $$ declare r referrals; s referral_form_submissions; h referral_status_history; v uuid := current_setting('t.ref')::uuid; begin
  select * into r from referrals where id = v;
  if r.source <> 'portal_public' or r.status <> 'submitted' or r.direction <> 'inbound'
     or r.partner_id <> 'a060a000-0000-0000-0000-000000000001'
     or r.assigned_user_id <> 'a0600000-0000-0000-0000-000000000003'
     or r.submitted_at <> '2026-10-01 15:00+00'::timestamptz
     or r.company_name <> 'Attr Co' or r.contact_name <> 'Ann' or r.contact_email <> 'ann@attr.example'
     or r.contact_phone <> '5550600011' or r.notes <> 'Wants a demo'
     or r.partner_company_snapshot <> 'Jane & Co'
     or r.consent_text_version <> '1' or r.consent_text_snapshot <> 'I may share this.' then
    raise exception 'attributed referral is wrong: %', row_to_json(r);
  end if;
  select * into h from referral_status_history where referral_id = v;
  if h.to_status <> 'submitted' or h.actor_type <> 'user' or h.actor_id <> 'a0600000-0000-0000-0000-000000000003'
     or h.note is distinct from 'From the referral form. Who referred this business: Jane at Jane & Co' then
    raise exception 'history row is wrong: %', row_to_json(h);
  end if;
  select * into s from referral_form_submissions where id = 'a060e000-0000-0000-0000-000000000001';
  if s.outcome <> 'attributed' or s.referral_id <> v or s.triaged_by <> 'a0600000-0000-0000-0000-000000000003'
     or s.triaged_at is null or s.deal_id is not null
     or s.contact_name is not null or s.contact_email is not null or s.contact_phone is not null or s.notes is not null
     or s.referred_by_text is not null or s.referrer_email is not null or s.submitter_ip is not null
     or s.company_name <> 'Attr Co' or s.consent_text_snapshot <> 'I may share this.' or s.purged_at is not null then
    raise exception 'attributed submission is wrong: %', row_to_json(s);
  end if;
  if exists (select 1 from portal_email_outbox where referral_id = v and kind in ('partner_received', 'internal_new_referral')) then
    raise exception 'an attributed referral sends no Received or new-referral email';
  end if;
end $$;

do $$ declare res jsonb; v uuid := current_setting('t.ref')::uuid; d deals; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  res := public.accept_referral(v);
  perform set_config('role', 'postgres', true);
  if res->>'result' <> 'accepted' then raise exception 'accept_referral should accept, got %', res; end if;
  select * into d from deals where id = (res->>'deal_id')::uuid;
  if d.lead_source <> 'partner_referral' or d.owner_id <> 'a0600000-0000-0000-0000-000000000003'
     or d.source_partner_id <> 'a060a000-0000-0000-0000-000000000001' then
    raise exception 'deal from the attributed referral is wrong: %', row_to_json(d);
  end if;
  -- Deviation 16: same as a rep-logged referral, the partner hears Accepted.
  if not exists (select 1 from portal_email_outbox where referral_id = v and kind = 'partner_accepted') then
    raise exception 'the partner with portal access hears Accepted';
  end if;
end $$;

-- 5b. First referral wins (FR-PORT-46, 47): attributing a submission whose phone matches
--     an earlier open referral from another partner stores the duplicate flags, so the
--     existing accept_referral needs a written reason (accept_referral_override).
--     Fixtures: partner P4 Kim CPA (owner rita) with open referral R4 Lou Bistro
--     (phone 5550600018); submission S8 Lou Bistro LLC (rita, same phone), attributed to P1.
insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a060a000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001060', 'a0600000-0000-0000-0000-000000000003', 'a0600000-0000-0000-0000-000000000003', 'Kim CPA', 'Kim & Co', 'cpa', 'kim@tri.example');
insert into referrals (id, partner_id, direction, source, status, company_name, contact_phone, assigned_user_id, submitted_at) values
  ('a060f000-0000-0000-0000-000000000004', 'a060a000-0000-0000-0000-000000000004', 'inbound', 'rep_entered', 'submitted', 'Lou Bistro', '5550600018', 'a0600000-0000-0000-0000-000000000003', '2026-09-01 15:00+00');
insert into referral_form_submissions (
  id, org_id, link_type, assigned_user_id, company_name, contact_name, contact_email, contact_phone,
  notes, referred_by_text, referrer_email, consent_version, consent_text_snapshot, submitter_ip, submitted_at
) values
  ('a060e000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000001060', 'user', 'a0600000-0000-0000-0000-000000000003', 'Lou Bistro LLC', 'Lou', 'lou@bistro.example', '555-060-0018', 'Two registers', null, null, 1, 'I may share this.', '198.51.100.60', '2026-10-02 15:00+00');

do $$ declare a record; r referrals; res jsonb; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  select * into a from public.attribute_form_submission('a060e000-0000-0000-0000-000000000008', 'a060a000-0000-0000-0000-000000000001');
  if a.duplicate_of_referral_id is distinct from 'a060f000-0000-0000-0000-000000000004'::uuid
     or a.duplicate_of_deal_id is not null
     or a.assigned_user_id is distinct from 'a0600000-0000-0000-0000-000000000003'::uuid then
    raise exception 'S8 is flagged as a duplicate of R4, got %', row_to_json(a);
  end if;
  perform _t_raises(format('select public.accept_referral(%L)', a.referral_id), 'override_reason_required');
  res := public.accept_referral_override(a.referral_id, 'Different owner, second location');
  perform set_config('role', 'postgres', true);
  select * into r from referrals where id = a.referral_id;
  if r.duplicate_of_referral_id is distinct from 'a060f000-0000-0000-0000-000000000004'::uuid
     or r.duplicate_of_deal_id is not null then
    raise exception 'the stored referral keeps the flag: %', row_to_json(r);
  end if;
  if res->>'result' <> 'accepted' or r.status <> 'accepted' then
    raise exception 'accept with a reason goes through, got %', res;
  end if;
end $$;

-- 6. No partner: accept creates the reviewer's deal, the first follow-up and a deal note.
do $$ declare v uuid; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  v := public.accept_form_submission('a060e000-0000-0000-0000-000000000002');
  perform set_config('t.deal', v::text, true);
  perform set_config('role', 'postgres', true);
end $$;

do $$ declare d deals; s referral_form_submissions; n integer; v uuid := current_setting('t.deal')::uuid; begin
  select * into d from deals where id = v;
  if d.owner_id <> 'a0600000-0000-0000-0000-000000000003' or d.lead_source <> 'referral_form' or d.stage <> 'new'
     or d.company_name <> 'Accept Co' or d.contact_name <> 'Bea' or d.contact_email <> 'bea@accept.example'
     or d.contact_phone <> '5550600012' or d.source_referral_id is not null or d.source_partner_id is not null then
    raise exception 'no-partner deal is wrong: %', row_to_json(d);
  end if;
  select count(*) into n from task
   where deal_id = v and type = 'call' and owner_id = 'a0600000-0000-0000-0000-000000000003'
     and title = 'Follow up on referral from your form';
  if n <> 1 then raise exception 'one first follow-up task, got %', n; end if;
  if (select body from deal_notes where deal_id = v and created_by = 'a0600000-0000-0000-0000-000000000003')
     is distinct from E'From the referral form.\nCall after 3\nWho referred this business: A neighbor' then
    raise exception 'the deal note keeps the notes and who referred';
  end if;
  select * into s from referral_form_submissions where id = 'a060e000-0000-0000-0000-000000000002';
  if s.outcome <> 'accepted' or s.deal_id <> v or s.referral_id is not null or s.contact_name is not null
     or s.notes is not null or s.referred_by_text is not null or s.submitter_ip is not null
     or s.consent_text_snapshot <> 'I may share this.' then
    raise exception 'accepted submission is wrong: %', row_to_json(s);
  end if;
end $$;

-- 7. Decline: a reason is required and kept; personal details wait for the purge.
do $$ declare s referral_form_submissions; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  perform _t_raises('select public.decline_form_submission(''a060e000-0000-0000-0000-000000000003'', ''withdrawn_by_partner'')', 'invalid_reason');
  perform _t_raises('select public.decline_form_submission(''a060e000-0000-0000-0000-000000000003'', null)', 'invalid_reason');
  perform public.decline_form_submission('a060e000-0000-0000-0000-000000000003', 'outside_icp', '  Too small  ');
  perform set_config('role', 'postgres', true);
  select * into s from referral_form_submissions where id = 'a060e000-0000-0000-0000-000000000003';
  if s.outcome <> 'declined' or s.decline_reason <> 'outside_icp' or s.decline_note <> 'Too small'
     or s.triaged_by <> 'a0600000-0000-0000-0000-000000000003' or s.contact_name <> 'Cal' or s.purged_at is not null then
    raise exception 'declined submission is wrong: %', row_to_json(s);
  end if;
end $$;

-- 8. Merge into a deal the reviewer can see; the contact and notes land in a deal note.
do $$ declare s referral_form_submissions; begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  perform _t_raises('select public.merge_form_submission(''a060e000-0000-0000-0000-000000000004'', ''a060d000-0000-0000-0000-000000000002'')', 'deal_not_visible');
  -- Same org, but rob's deal is outside rita's visibility.
  perform _t_raises('select public.merge_form_submission(''a060e000-0000-0000-0000-000000000004'', ''a060d000-0000-0000-0000-000000000003'')', 'deal_not_visible');
  perform public.merge_form_submission('a060e000-0000-0000-0000-000000000004', 'a060d000-0000-0000-0000-000000000001');
  perform set_config('role', 'postgres', true);
  select * into s from referral_form_submissions where id = 'a060e000-0000-0000-0000-000000000004';
  if s.outcome <> 'merged' or s.deal_id <> 'a060d000-0000-0000-0000-000000000001' or s.contact_name is not null then
    raise exception 'merged submission is wrong: %', row_to_json(s);
  end if;
  if (select body from deal_notes where deal_id = 'a060d000-0000-0000-0000-000000000001')
     is distinct from E'From the referral form.\nContact: Dan, dan@fresh.example, (555) 060-0001\nSecond location' then
    raise exception 'the merge note keeps the contact and notes';
  end if;
  if (select lead_source from deals where id = 'a060d000-0000-0000-0000-000000000001') <> 'path' then
    raise exception 'merge never touches the lead source';
  end if;
end $$;

-- 9. The administrator queue: administrators only (to anyone else it reads as missing).
do $$ declare v uuid; begin
  perform _t_act('a0600000-0000-0000-0000-000000000002');
  perform _t_raises('select public.accept_form_submission(''a060e000-0000-0000-0000-000000000005'')', 'submission_not_found');
  perform _t_act('a0600000-0000-0000-0000-000000000001');
  v := public.accept_form_submission('a060e000-0000-0000-0000-000000000005');
  perform set_config('role', 'postgres', true);
  if (select owner_id from deals where id = v) <> 'a0600000-0000-0000-0000-000000000001' then
    raise exception 'the administrator who accepts owns the deal';
  end if;
end $$;

-- 10. Reassign: managers and administrators, to someone active they can see.
--     A teammate's submission reads as missing; on one the rep can see, the
--     role check refuses.
do $$ begin
  perform _t_act('a0600000-0000-0000-0000-000000000003');
  perform _t_raises('select public.reassign_form_submission(''a060e000-0000-0000-0000-000000000007'', ''a0600000-0000-0000-0000-000000000003'')', 'submission_not_found');
  perform _t_raises('select public.reassign_form_submission(''a060e000-0000-0000-0000-000000000006'', ''a0600000-0000-0000-0000-000000000004'')', 'not_authorized');
  perform _t_act('a0600000-0000-0000-0000-000000000002');
  perform _t_raises('select public.reassign_form_submission(''a060e000-0000-0000-0000-000000000007'', ''a0600000-0000-0000-0000-000000000005'')', 'assignee_invalid');
  perform _t_raises('select public.reassign_form_submission(''a060e000-0000-0000-0000-000000000002'', ''a0600000-0000-0000-0000-000000000004'')', 'submission_handled');
  perform public.reassign_form_submission('a060e000-0000-0000-0000-000000000007', 'a0600000-0000-0000-0000-000000000003');
  perform set_config('role', 'postgres', true);
  if (select assigned_user_id from referral_form_submissions where id = 'a060e000-0000-0000-0000-000000000007')
     <> 'a0600000-0000-0000-0000-000000000003' then
    raise exception 'S7 now belongs to rita';
  end if;
  if _t_seen('a0600000-0000-0000-0000-000000000003') <> 'Rob Co,Subway #42' then
    raise exception 'rita now sees Rob Co, got %', _t_seen('a0600000-0000-0000-0000-000000000003');
  end if;
end $$;

rollback;
