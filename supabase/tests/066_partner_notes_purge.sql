-- Tests for 20261022000005_partner_notes_purge (Partner Portal Phase 2B-3,
-- FR-PORT-91..95, NFR-PORT-09).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/066_partner_notes_purge.sql
-- Self-cleans via ROLLBACK.
--
-- Org np-a: boss administrator; rita rep. P1 Jane CPA (owner rita) with ACTIVE
-- PU1 (token set). R1 outbound, withdrawn 100 days ago, with a partner note and
-- a queued "sent to you" email carrying a note. R2 outbound, live, with a note.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001066', 'Purge Org', 'np-a', 'np-a-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0660000-0000-0000-0000-000000000001', 'boss@np.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0660000-0000-0000-0000-000000000002', 'rita@np.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0660000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001066', 'admin', 'administrator',      'Boss',     'boss@np.example', 'npboss'::ltree,      null),
  ('a0660000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001066', 'rep',   'sales_professional', 'Rita Rep', 'rita@np.example', 'npboss.rita'::ltree, 'a0660000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email, phone) values
  ('a066a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001066', 'a0660000-0000-0000-0000-000000000002', 'a0660000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@np.example', null);

insert into portal_users (id, org_id, partner_id, email, status, digest_unsubscribe_token, digest_week) values
  ('a066b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001066', 'a066a000-0000-0000-0000-000000000001', 'jane@np.example', 'active', 'npTokennpTokennpToken1', '2030-02');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email, phone) values
  ('a066a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001066', 'a0660000-0000-0000-0000-000000000002', 'a0660000-0000-0000-0000-000000000002', 'Kim CPA', 'Kim & Co', 'cpa', 'kim@np.example', null);
insert into portal_users (id, org_id, partner_id, email, status, digest_unsubscribe_token, digest_week) values
  ('a066b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001066', 'a066a000-0000-0000-0000-000000000002', 'kim@np.example', 'active', 'npTokennpTokennpToken2', '2030-03');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, contact_name, notes, partner_note_visible,
                       assigned_user_id, submitted_by_user_id) values
  ('a066e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001066', 'a066a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'withdrawn',
   'Old Co', 'Olga', 'For Jane', true, 'a0660000-0000-0000-0000-000000000002', 'a0660000-0000-0000-0000-000000000002'),
  ('a066e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001066', 'a066a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'accepted',
   'Live Co', 'Liv', '', false, 'a0660000-0000-0000-0000-000000000002', 'a0660000-0000-0000-0000-000000000002');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, contact_name, notes, partner_note_visible,
                       assigned_user_id, submitted_by_user_id) values
  ('a066e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001066', 'a066a000-0000-0000-0000-000000000002', 'outbound', 'rep_entered', 'accepted',
   'Kim Live Co', 'Kay', '', false, 'a0660000-0000-0000-0000-000000000002', 'a0660000-0000-0000-0000-000000000002');

update referral_status_history set created_at = now() - interval '100 days'
 where referral_id = 'a066e000-0000-0000-0000-000000000001';

insert into referral_partner_notes (org_id, referral_id, portal_user_id, body) values
  ('00000000-0000-0000-0000-000000001066', 'a066e000-0000-0000-0000-000000000001', 'a066b000-0000-0000-0000-000000000001', 'Olga says no'),
  ('00000000-0000-0000-0000-000000001066', 'a066e000-0000-0000-0000-000000000002', 'a066b000-0000-0000-0000-000000000001', 'Liv is keen'),
  ('00000000-0000-0000-0000-000000001066', 'a066e000-0000-0000-0000-000000000003', 'a066b000-0000-0000-0000-000000000002', 'Kay is keen');

-- Negative controls: a queued sent-to-you email on a LIVE referral, and the other partner's digest.
insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, payload, dedupe_key) values
  ('00000000-0000-0000-0000-000000001066', 'partner_referral_sent', 'a066e000-0000-0000-0000-000000000002', 'a066b000-0000-0000-0000-000000000001',
   '{"slug": "np-a", "companyName": "Live Co", "note": "Live note"}', 't066-sent-live');
insert into portal_email_outbox (org_id, kind, portal_user_id, payload, dedupe_key) values
  ('00000000-0000-0000-0000-000000001066', 'partner_digest', 'a066b000-0000-0000-0000-000000000002',
   '{"partnerName": "Kim CPA", "unsubscribeToken": "npTokennpTokennpToken2"}', 't066-digest-kim');

insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, payload, dedupe_key) values
  ('00000000-0000-0000-0000-000000001066', 'partner_referral_sent', 'a066e000-0000-0000-0000-000000000001', 'a066b000-0000-0000-0000-000000000001',
   '{"slug": "np-a", "orgName": "Purge Org", "partnerName": "Jane CPA", "companyName": "Old Co", "ref": "REF-A066E000", "repName": "Rita Rep", "repEmail": "rita@np.example", "note": "For Jane"}',
   't066-sent');
insert into portal_email_outbox (org_id, kind, portal_user_id, payload, dedupe_key) values
  ('00000000-0000-0000-0000-000000001066', 'partner_digest', 'a066b000-0000-0000-0000-000000000001',
   '{"slug": "np-a", "orgName": "Purge Org", "partnerName": "Jane CPA", "weekLabel": "Dec 31", "counts": {}, "valueCents": null, "items": [], "unsubscribeToken": "npTokennpTokennpToken1"}',
   't066-digest');

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- 1. The referral purge erases the note-back on purged referrals and the note in queued payloads.
do $$ declare n int; begin
  -- The job is global; other fixtures in the database may also be due, so at least one.
  n := public.purge_declined_referrals(now());
  if n < 1 or not exists (select 1 from referrals where id = 'a066e000-0000-0000-0000-000000000001' and purged_at is not null) then
    raise exception 'R1 should be purged (count %)', n;
  end if;
  if exists (select 1 from referral_partner_notes where referral_id = 'a066e000-0000-0000-0000-000000000001') then
    raise exception 'notes on a purged referral must be deleted';
  end if;
  if not exists (select 1 from referral_partner_notes where referral_id = 'a066e000-0000-0000-0000-000000000002') then
    raise exception 'notes on a live referral stay';
  end if;
  if not exists (select 1 from portal_email_outbox where dedupe_key = 't066-sent' and payload ? 'note' and payload->'note' = 'null'::jsonb) then
    raise exception 'a queued payload must not keep the note';
  end if;
  if not exists (select 1 from portal_email_outbox where dedupe_key = 't066-sent' and dropped_at is not null) then
    raise exception 'the unsent email for a purged referral is dropped (2A rule)';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from portal_email_outbox where dedupe_key = 't066-sent-live'
                  and payload->>'note' = 'Live note' and dropped_at is null) then
    raise exception 'a queued email on a live referral keeps its note and stays queued';
  end if;
end $$;

-- 2. Erasing the identity deletes their notes and the unsubscribe token everywhere.
do $$ begin
  perform _t_act('a0660000-0000-0000-0000-000000000001');
  perform public.portal_purge_user('a066a000-0000-0000-0000-000000000001');
  perform set_config('role', 'postgres', true);
  if exists (select 1 from referral_partner_notes where portal_user_id = 'a066b000-0000-0000-0000-000000000001') then
    raise exception 'an erased identity keeps no notes';
  end if;
  if not exists (select 1 from portal_users where id = 'a066b000-0000-0000-0000-000000000001'
                  and digest_unsubscribe_token is null and digest_week is null) then
    raise exception 'the token and digest week must be cleared';
  end if;
  if not exists (select 1 from portal_email_outbox where dedupe_key = 't066-digest'
                  and payload->'unsubscribeToken' = 'null'::jsonb and payload->'partnerName' = 'null'::jsonb) then
    raise exception 'queued payloads must lose the token and the name';
  end if;
  if not exists (select 1 from referral_partner_notes where portal_user_id = 'a066b000-0000-0000-0000-000000000002' and body = 'Kay is keen') then
    raise exception 'another partner''s notes survive';
  end if;
  if not exists (select 1 from portal_users where id = 'a066b000-0000-0000-0000-000000000002' and status = 'active'
                  and digest_unsubscribe_token = 'npTokennpTokennpToken2' and digest_week = '2030-03') then
    raise exception 'another partner''s token, digest week and status survive';
  end if;
  if not exists (select 1 from portal_email_outbox where dedupe_key = 't066-digest-kim'
                  and payload->>'unsubscribeToken' = 'npTokennpTokennpToken2' and payload->>'partnerName' = 'Kim CPA') then
    raise exception 'another partner''s queued payload survives';
  end if;
  if not exists (select 1 from portal_users where id = 'a066b000-0000-0000-0000-000000000001' and status = 'revoked') then
    raise exception 'the 2A erase still revokes access';
  end if;
end $$;

rollback;
