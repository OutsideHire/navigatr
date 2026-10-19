-- Tests for 20261022000003_portal_sent_referrals (Partner Portal Phase 2B-3,
-- FR-PORT-76, 77, 78, 80).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/064_portal_sent_referrals.sql
-- Self-cleans via ROLLBACK.
--
-- Org sent-read (portal on): boss and ada administrators; rita rep and rob rep in
-- separate branches. P1 Jane CPA (owner rita, ACTIVE PU1), P2 Kim CPA (owner
-- rita, ACTIVE PU2), P3 Lee CPA (owner rita, SUSPENDED PU3). Deals D1..D3 (rita).
-- Referrals (inserted as postgres):
--   R1 outbound P1 D1, shared, sent by boss, note for the partner, accepted
--   R2 outbound P1 D2, shared, sent by rita, internal note (not visible), working
--   R3 outbound P1 D3, shared, then the link was removed (withdrawn), with a
--      partner note written before the removal
--   R4 inbound  P1, rep-entered
--   R5 outbound P2 D1, shared (another partner)
--   R6 outbound P1 D4, from before this release (shared_with_partner_at null)
-- Org sent-read-b: bob administrator.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001064', 'Read Org',   'sent-read',   'sent-read-a1',   true),
  ('00000000-0000-0000-0000-000000001164', 'Read Org B', 'sent-read-b', 'sent-read-b-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0640000-0000-0000-0000-000000000001', 'boss@sr.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0640000-0000-0000-0000-000000000002', 'rita@sr.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0640000-0000-0000-0000-000000000003', 'rob@sr.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0640000-0000-0000-0000-000000000004', 'bob@srb.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0640000-0000-0000-0000-000000000005', 'ada@sr.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0640000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001064', 'admin', 'administrator',      'Boss',     'boss@sr.example', 'srboss'::ltree,      null),
  ('a0640000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001064', 'rep',   'sales_professional', 'Rita Rep', 'rita@sr.example', 'srboss.rita'::ltree, 'a0640000-0000-0000-0000-000000000001'),
  ('a0640000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001064', 'rep',   'sales_professional', 'Rob Rep',  'rob@sr.example',  'srboss.rob'::ltree,  'a0640000-0000-0000-0000-000000000001'),
  ('a0640000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001164', 'admin', 'administrator',      'Bob',      'bob@srb.example', 'srbob'::ltree,       null),
  ('a0640000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001064', 'admin', 'administrator',      'Ada',      'ada@sr.example',  'srada'::ltree,       null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email, phone) values
  ('a064a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@sr.example', null),
  ('a064a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@sr.example',  null),
  ('a064a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', 'Lee CPA',  'Lee & Co',  'cpa', 'lee@sr.example',  null);

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a064b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'jane@sr.example', 'active'),
  ('a064b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000002', 'kim@sr.example',  'active'),
  ('a064b000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000003', 'lee@sr.example',  'suspended');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a064d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'Fresh Bakery', '5 Oak St',  'Ann', 'ann@fresh.example', '5550640001', 500000, 'contacted', 'inbound'),
  ('a064d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'Gold Gym',     '7 Elm St',  'Gil', 'gil@gold.example',  '5550640002', 250000, 'contacted', 'inbound'),
  ('a064d000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'Blue Cafe',    '9 Pine St', 'Bea', 'bea@blue.example',  '5550640003', 100000, 'contacted', 'inbound'),
  ('a064d000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001064', 'a0640000-0000-0000-0000-000000000002', 'Red Shop',     '11 Ash St', 'Rod', 'rod@red.example',   '5550640004', 100000, 'contacted', 'inbound');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_email, contact_phone,
                       notes, partner_note_visible, deal_id, assigned_user_id, submitted_by_user_id, submitted_at, shared_with_partner_at) values
  ('a064e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'accepted',
   'Fresh Bakery', 'Ann', 'ann@fresh.example', '5550640001', 'Ask for Ann after 3pm.', true,
   'a064d000-0000-0000-0000-000000000001', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000001', now() - interval '2 days', now() - interval '2 days'),
  ('a064e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'working',
   'Gold Gym', 'Gil', 'gil@gold.example', '5550640002', 'INTERNAL: owner is difficult', false,
   'a064d000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', now() - interval '1 hour', now() - interval '1 hour'),
  ('a064e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'withdrawn',
   'Blue Cafe', 'Bea', 'bea@blue.example', '5550640003', 'For Jane', true,
   'a064d000-0000-0000-0000-000000000003', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', now() - interval '3 hours', now() - interval '3 hours'),
  ('a064e000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'submitted',
   'Inbound Co', null, null, null, 'rep wrote this', false,
   null, 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', now() - interval '1 hour', null),
  ('a064e000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000002', 'outbound', 'rep_entered', 'accepted',
   'Fresh Bakery', 'Ann', 'ann@fresh.example', '5550640001', 'For Kim', true,
   'a064d000-0000-0000-0000-000000000001', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', now() - interval '1 hour', now() - interval '1 hour'),
  ('a064e000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'accepted',
   'Red Shop', 'Rod', 'rod@red.example', '5550640004', 'old partner_deals note', false,
   'a064d000-0000-0000-0000-000000000004', 'a0640000-0000-0000-0000-000000000002', 'a0640000-0000-0000-0000-000000000002', now() - interval '30 days', null);

-- A note Jane wrote on R3 before the rep removed the link: it stays, internal only.
insert into referral_partner_notes (org_id, referral_id, portal_user_id, body) values
  ('00000000-0000-0000-0000-000000001064', 'a064e000-0000-0000-0000-000000000003', 'a064b000-0000-0000-0000-000000000001', 'Bea was not interested.');

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

create or replace function _t_visible_notes(p_user uuid) returns int language plpgsql as $$
declare n int;
begin
  perform _t_act(p_user);
  select count(*) into n from referral_partner_notes;
  perform set_config('role', 'postgres', true);
  return n;
end $$;

-- 1. Privileges (before any role switch).
do $$ declare f text; begin
  foreach f in array array[
    'public.portal_list_sent_referrals(uuid, uuid, timestamptz)',
    'public.portal_get_sent_referral(uuid, uuid, uuid, uuid, text)',
    'public.portal_partner_notes(uuid, uuid, uuid)',
    'public.portal_post_partner_note(uuid, uuid, uuid, uuid, text, text)'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '% must be service role only', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'service_role should execute %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public._portal_enqueue_partner_note(referrals, uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._portal_enqueue_partner_note(referrals, uuid)', 'EXECUTE') then
    raise exception '_portal_enqueue_partner_note must be private';
  end if;
  if not has_table_privilege('authenticated', 'public.referral_partner_notes', 'SELECT')
     or has_table_privilege('authenticated', 'public.referral_partner_notes', 'INSERT')
     or has_table_privilege('authenticated', 'public.referral_partner_notes', 'UPDATE')
     or has_table_privilege('authenticated', 'public.referral_partner_notes', 'DELETE')
     or has_table_privilege('anon', 'public.referral_partner_notes', 'SELECT') then
    raise exception 'referral_partner_notes: authenticated reads only, anon nothing';
  end if;
end $$;

-- 2. List: this partner's shared, not removed, outbound referrals only; window applied.
do $$ declare ids uuid[]; begin
  select array_agg(id order by id) into ids
    from public.portal_list_sent_referrals('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', null);
  if ids is distinct from array['a064e000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'sent list wrong (a removed link and an unshared legacy row must not appear): %', ids;
  end if;
  select array_agg(id order by id) into ids
    from public.portal_list_sent_referrals('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', now() - interval '1 day');
  if ids is distinct from array['a064e000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'the window must apply to the sent date: %', ids;
  end if;
  if exists (select 1 from public.portal_list_sent_referrals('00000000-0000-0000-0000-000000001164', 'a064a000-0000-0000-0000-000000000001', null)) then
    raise exception 'another org scope must see nothing';
  end if;
  update organizations set portal_enabled = false where id = '00000000-0000-0000-0000-000000001064';
  if exists (select 1 from public.portal_list_sent_referrals('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', null)) then
    raise exception 'nothing while the portal is off';
  end if;
  update organizations set portal_enabled = true where id = '00000000-0000-0000-0000-000000001064';
end $$;

-- 3. Detail: allowlisted fields, the rep note only when visible; a removed link, a
--    legacy row, an inbound row and another partner's row all look missing; a
--    deal-stage status (lost) is never hidden.
do $$ declare g record; n int; begin
  select * into g from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', '203.0.113.5');
  if g.id is null then raise exception 'detail row missing for R1'; end if;
  if g.company_name <> 'Fresh Bakery' or g.contact_name <> 'Ann' or g.contact_email <> 'ann@fresh.example'
     or g.contact_phone <> '5550640001' or g.rep_note <> 'Ask for Ann after 3pm.' or g.status <> 'accepted'
     or g.rep_name <> 'Boss' or g.rep_email <> 'boss@sr.example' or g.details_removed or not g.can_post_note
     or g.ref <> 'REF-A064E000' then
    raise exception 'detail wrong: %', row_to_json(g);
  end if;
  perform * from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', '203.0.113.5');
  select count(*) into n from portal_audit_log where referral_id = 'a064e000-0000-0000-0000-000000000001' and action = 'view_referral';
  if n <> 1 then raise exception 'views are audited once per hour, got %', n; end if;

  select * into g from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000002', null);
  if g.id is null then raise exception 'detail row missing for R2'; end if;
  if g.rep_note is not null then raise exception 'an internal note must never reach the partner: %', g.rep_note; end if;

  if exists (select 1 from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
               'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000003', null))
     or exists (select 1 from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
               'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000006', null)) then
    raise exception 'a removed link and an unshared legacy row must look missing';
  end if;
  if exists (select 1 from public.portal_partner_notes('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
               'a064e000-0000-0000-0000-000000000003')) then
    raise exception 'notes on a removed link must stay internal';
  end if;

  if exists (select 1 from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
               'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000004', null))
     or exists (select 1 from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
               'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000005', null)) then
    raise exception 'an inbound referral and another partner''s referral must look missing';
  end if;
  perform _t_raises($q$select * from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000003',
    'a064b000-0000-0000-0000-000000000003', 'a064e000-0000-0000-0000-000000000001', null)$q$, 'not_authorized');

  -- The deal is lost: R1 follows the stage (not a removal) and stays visible.
  update deals set stage = 'lost' where id = 'a064d000-0000-0000-0000-000000000001';
  select * into g from public.portal_get_sent_referral('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', null);
  if g.id is null then raise exception 'lost referral detail row missing'; end if;
  if g.status is distinct from 'lost' then raise exception 'a deal-stage status must not hide the referral: %', row_to_json(g); end if;
  if not exists (select 1 from public.portal_list_sent_referrals('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', null)
                  where id = 'a064e000-0000-0000-0000-000000000001') then
    raise exception 'a lost referral stays in the list';
  end if;
end $$;

-- 4. Note-back: stored, audited, emailed to the sender (then the deal owner), scoped, limited.
do $$ declare p record; o portal_email_outbox; n int; begin
  select * into p from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', E'  Called Ann, she is interested.\n', '203.0.113.5');
  if p.id is null then raise exception 'post returned no row'; end if;
  if p.body <> 'Called Ann, she is interested.' or p.id is null or p.created_at is null then
    raise exception 'post result wrong: %', row_to_json(p);
  end if;
  if not exists (select 1 from referral_partner_notes where id = p.id and portal_user_id = 'a064b000-0000-0000-0000-000000000001'
                  and referral_id = 'a064e000-0000-0000-0000-000000000001' and org_id = '00000000-0000-0000-0000-000000001064') then
    raise exception 'note not stored';
  end if;
  select count(*) into n from portal_audit_log where action = 'note' and portal_user_id = 'a064b000-0000-0000-0000-000000000001' and ip = '203.0.113.5';
  if n <> 1 then raise exception 'notes are audited, got %', n; end if;

  select * into o from portal_email_outbox where kind = 'internal_partner_note' and dedupe_key like 'internal_partner_note:' || p.id::text || ':%';
  if o.id is null then raise exception 'note email was not queued'; end if;
  if o.recipient_user_id <> 'a0640000-0000-0000-0000-000000000001'
     or o.payload <> jsonb_build_object('appUrlPath', '/pipeline/a064d000-0000-0000-0000-000000000001',
                                        'companyNames', jsonb_build_array('Fresh Bakery'), 'count', 1) then
    raise exception 'note email wrong: %', row_to_json(o);
  end if;

  -- The sender left: the deal owner hears about the next note.
  update profiles set deactivated_at = now() where id = 'a0640000-0000-0000-0000-000000000001';
  select * into p from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', 'Demo booked.', null);
  select * into o from portal_email_outbox where dedupe_key like 'internal_partner_note:' || p.id::text || ':%';
  if o.id is null then raise exception 'second note email was not queued'; end if;
  if o.recipient_user_id <> 'a0640000-0000-0000-0000-000000000002' then
    raise exception 'with the sender gone the deal owner is told';
  end if;

  if (select array_agg(body order by created_at desc, id) from public.portal_partner_notes('00000000-0000-0000-0000-000000001064',
        'a064a000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001'))
     is distinct from (select array_agg(body order by created_at desc, id) from referral_partner_notes
                        where referral_id = 'a064e000-0000-0000-0000-000000000001') then
    raise exception 'portal_partner_notes must list the notes newest first';
  end if;
  if exists (select 1 from public.portal_partner_notes('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000002', 'a064e000-0000-0000-0000-000000000001')) then
    raise exception 'another partner must not read these notes';
  end if;
  -- Portal off or the org disabled: no notes, like every other sent read.
  update organizations set portal_enabled = false where id = '00000000-0000-0000-0000-000000001064';
  if exists (select 1 from public.portal_partner_notes('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001')) then
    raise exception 'no notes while the portal is off';
  end if;
  update organizations set portal_enabled = true, is_disabled = true where id = '00000000-0000-0000-0000-000000001064';
  if exists (select 1 from public.portal_partner_notes('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001')) then
    raise exception 'no notes while the org is disabled';
  end if;
  update organizations set is_disabled = false where id = '00000000-0000-0000-0000-000000001064';
  if not exists (select 1 from public.portal_partner_notes('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001')) then
    raise exception 'control: notes are listed while the portal is on';
  end if;

  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000004', 'x', null)$q$, 'referral_not_found');
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000005', 'x', null)$q$, 'referral_not_found');
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000003', 'x', null)$q$, 'referral_not_found');
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000006', 'x', null)$q$, 'referral_not_found');
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', E' \n ', null)$q$, 'invalid_input:body');
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', repeat('y', 1001), null)$q$, 'invalid_input:body');
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000003',
    'a064b000-0000-0000-0000-000000000003', 'a064e000-0000-0000-0000-000000000001', 'x', null)$q$, 'not_authorized');

  -- Sender and deal owner both gone: every active administrator (ada; boss left) is told.
  update profiles set deactivated_at = now() where id = 'a0640000-0000-0000-0000-000000000002';
  select * into p from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', 'Contract signed.', null);
  if p.id is null then raise exception 'third post returned no row'; end if;
  if not exists (select 1 from portal_email_outbox where dedupe_key = 'internal_partner_note:' || p.id::text || ':a0640000-0000-0000-0000-000000000005') then
    raise exception 'with the sender and the deal owner gone an active administrator is told';
  end if;
  if exists (select 1 from portal_email_outbox where dedupe_key like 'internal_partner_note:' || p.id::text || ':%'
               and recipient_user_id is distinct from 'a0640000-0000-0000-0000-000000000005') then
    raise exception 'only active administrators are told when the sender and owner are gone';
  end if;
  update profiles set deactivated_at = null where id = 'a0640000-0000-0000-0000-000000000002';

  -- The email cannot be queued: the note still posts (the enqueue swallows its own error).
  alter table portal_email_outbox add constraint t064_block_note_email check (kind <> 'internal_partner_note') not valid;
  select * into p from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', 'Posted while email is down.', null);
  alter table portal_email_outbox drop constraint t064_block_note_email;
  if p.id is null then raise exception 'an enqueue failure must not fail the post'; end if;
  if not exists (select 1 from referral_partner_notes where id = p.id) then
    raise exception 'the note must be stored when its email cannot be queued';
  end if;
  if exists (select 1 from portal_email_outbox where dedupe_key like 'internal_partner_note:' || p.id::text || ':%') then
    raise exception 'control: the blocked email must not have been queued';
  end if;

  -- The limit: 20 notes per portal user in the last hour. Four posted so far;
  -- 15 more recent audit rows make 19, and rows older than an hour do not count.
  insert into portal_audit_log (org_id, portal_user_id, action)
  select '00000000-0000-0000-0000-000000001064', 'a064b000-0000-0000-0000-000000000001', 'note' from generate_series(1, 15);
  insert into portal_audit_log (org_id, portal_user_id, action, created_at)
  select '00000000-0000-0000-0000-000000001064', 'a064b000-0000-0000-0000-000000000001', 'note', now() - interval '61 minutes' from generate_series(1, 10);
  select * into p from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', 'the twentieth', null);
  if p.id is null then raise exception 'the 20th note in an hour is allowed'; end if;
  perform _t_raises($q$select * from public.portal_post_partner_note('00000000-0000-0000-0000-000000001064', 'a064a000-0000-0000-0000-000000000001',
    'a064b000-0000-0000-0000-000000000001', 'a064e000-0000-0000-0000-000000000001', 'one too many', null)$q$, 'rate_limited');
  select count(*) into n from referral_partner_notes where referral_id <> 'a064e000-0000-0000-0000-000000000003';
  if n <> 5 then raise exception 'refused notes must not be stored, got %', n; end if;
end $$;

-- 5. Internal reads under RLS: the deal owner sees the notes (including the one on
--    the removed link, which stays internal); another branch and another org do not.
do $$ begin
  if _t_visible_notes('a0640000-0000-0000-0000-000000000002') <> 6 then raise exception 'rita should see all six notes on her deals'; end if;
  if _t_visible_notes('a0640000-0000-0000-0000-000000000003') <> 0 then raise exception 'rob must not see them'; end if;
  if _t_visible_notes('a0640000-0000-0000-0000-000000000004') <> 0 then raise exception 'another org must not see them'; end if;
end $$;

rollback;
