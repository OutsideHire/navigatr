-- Tests for 20261022000001_portal_audit_actions_2b3 and
-- 20261022000002_referral_sent_to_partner (Partner Portal Phase 2B-3,
-- FR-PORT-76, FR-PORT-79).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/063_referral_sent_to_partner.sql
-- Self-cleans via ROLLBACK.
--
-- Org sent-a (portal on): boss administrator; rita rep under boss.
-- P1 Jane CPA (owner rita) with ACTIVE portal user PU1; P2 Kim CPA (owner rita)
-- without portal access. Deals D1..D5 owned by rita.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001063', 'Sent Org', 'sent-a', 'sent-a-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0630000-0000-0000-0000-000000000001', 'boss@st.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0630000-0000-0000-0000-000000000002', 'rita@st.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0630000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001063', 'admin', 'administrator',      'Boss',     'boss@st.example', 'stboss'::ltree,      null),
  ('a0630000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001063', 'rep',   'sales_professional', 'Rita Rep', 'rita@st.example', 'stboss.rita'::ltree, 'a0630000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email, phone) values
  ('a063a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'a0630000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@st.example', null),
  ('a063a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'a0630000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@st.example',  null);

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a063b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001063', 'a063a000-0000-0000-0000-000000000001', 'jane@st.example', 'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a063d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'Fresh Bakery', '5 Oak St',  'Ann', 'ann@fresh.example', '5550630001', 500000, 'contacted', 'inbound'),
  ('a063d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'Gold Gym',     '7 Elm St',  'Gil', 'gil@gold.example',  '5550630002', 250000, 'contacted', 'inbound'),
  ('a063d000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'Blue Cafe',    '9 Pine St', 'Bea', 'bea@blue.example',  '5550630003', 100000, 'contacted', 'inbound'),
  ('a063d000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'Red Shop',     '11 Ash St', 'Rod', 'rod@red.example',   '5550630004', 100000, 'contacted', 'inbound'),
  ('a063d000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001063', 'a0630000-0000-0000-0000-000000000002', 'Green Spa',    '13 Fir St', 'Gus', 'gus@green.example', '5550630005', 100000, 'contacted', 'inbound');

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

-- 1. Privileges and enum values (before any role switch).
do $$ begin
  if has_function_privilege('anon', 'public.send_referral_to_partner(uuid, uuid, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.send_referral_to_partner(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'send_referral_to_partner: authenticated only';
  end if;
  if not has_function_privilege('authenticated', 'public.refer_deal_to_partner(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.refer_deal_to_partner(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'refer_deal_to_partner keeps its grants';
  end if;
  if has_function_privilege('authenticated', 'public._portal_enqueue_referral_sent(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._portal_enqueue_referral_sent(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._portal_referral_sent_payload(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._portal_referral_sent_payload(uuid)', 'EXECUTE') then
    raise exception 'referral-sent helpers must be private';
  end if;
  if (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'portal_audit_action' and e.enumlabel in ('note', 'export', 'unsubscribe')) <> 3 then
    raise exception 'portal_audit_action must have note, export and unsubscribe';
  end if;
end $$;

-- 2. A note written for the partner: visible, and it rides the partner email.
do $$ declare v_id uuid; r referrals; o portal_email_outbox; begin
  perform _t_act('a0630000-0000-0000-0000-000000000002');
  v_id := public.send_referral_to_partner('a063a000-0000-0000-0000-000000000001', 'a063d000-0000-0000-0000-000000000001', E'  Ask for Ann after 3pm.\n ');
  perform set_config('role', 'postgres', true);

  select * into r from referrals where id = v_id;
  if r.direction <> 'outbound' or r.notes <> 'Ask for Ann after 3pm.' or not r.partner_note_visible
     or r.submitted_by_user_id <> 'a0630000-0000-0000-0000-000000000002' or r.contact_name <> 'Ann'
     or r.shared_with_partner_at is null then
    raise exception 'sent referral wrong: %', row_to_json(r);
  end if;

  select * into o from portal_email_outbox where referral_id = v_id;
  if o.id is null or o.kind <> 'partner_referral_sent' or o.portal_user_id <> 'a063b000-0000-0000-0000-000000000001'
     or o.recipient_user_id is not null or o.dedupe_key <> 'partner_referral_sent:' || v_id::text then
    raise exception 'partner email not queued as expected: %', row_to_json(o);
  end if;
  if (select count(*) from jsonb_object_keys(o.payload)) <> 8 then
    raise exception 'payload must carry exactly 8 keys: %', o.payload;
  end if;
  if o.payload->>'note' <> 'Ask for Ann after 3pm.' or o.payload->>'repName' <> 'Rita Rep'
     or o.payload->>'repEmail' <> 'rita@st.example' or o.payload->>'companyName' <> 'Fresh Bakery'
     or o.payload->>'slug' <> 'sent-a' or o.payload->>'orgName' <> 'Sent Org' or o.payload->>'partnerName' <> 'Jane CPA'
     or o.payload->>'ref' <> 'REF-' || upper(left(v_id::text, 8)) then
    raise exception 'payload wrong: %', o.payload;
  end if;
end $$;

-- 3. A blank note is not a note: nothing visible, and the email says nothing.
do $$ declare v_id uuid; o portal_email_outbox; begin
  perform _t_act('a0630000-0000-0000-0000-000000000002');
  v_id := public.send_referral_to_partner('a063a000-0000-0000-0000-000000000001', 'a063d000-0000-0000-0000-000000000002', '   ');
  perform set_config('role', 'postgres', true);
  if (select partner_note_visible or notes <> '' from referrals where id = v_id) then
    raise exception 'a blank note must not be visible';
  end if;
  select * into o from portal_email_outbox where referral_id = v_id and kind = 'partner_referral_sent';
  if o.id is null then raise exception 'a blank-note send must still queue the partner email'; end if;
  if o.payload->'note' <> 'null'::jsonb then
    raise exception 'a blank note must not ride the email: %', o.payload;
  end if;
end $$;

-- 4. The old RPC (Partner Detail before this PR, stale clients): the note stays internal.
do $$ declare v_id uuid; o portal_email_outbox; begin
  perform _t_act('a0630000-0000-0000-0000-000000000002');
  v_id := public.refer_deal_to_partner('a063a000-0000-0000-0000-000000000001', 'a063d000-0000-0000-0000-000000000003', 'Internal: the owner is difficult');
  perform set_config('role', 'postgres', true);
  if (select partner_note_visible from referrals where id = v_id) then
    raise exception 'refer_deal_to_partner must never make a note visible';
  end if;
  if (select shared_with_partner_at is null from referrals where id = v_id) then
    raise exception 'refer_deal_to_partner shares the referral from this release on';
  end if;
  select * into o from portal_email_outbox where referral_id = v_id and kind = 'partner_referral_sent';
  if o.id is null then raise exception 'refer_deal_to_partner must queue the partner email'; end if;
  if o.payload->'note' <> 'null'::jsonb then
    raise exception 'refer_deal_to_partner queues the email without the note: %', o.payload;
  end if;
end $$;

-- 5. No portal access, too long, already linked, portal off.
do $$ declare v_id uuid; n int; begin
  perform _t_act('a0630000-0000-0000-0000-000000000002');
  v_id := public.send_referral_to_partner('a063a000-0000-0000-0000-000000000002', 'a063d000-0000-0000-0000-000000000001', 'Hello Kim');
  perform _t_raises($q$select public.send_referral_to_partner('a063a000-0000-0000-0000-000000000001', 'a063d000-0000-0000-0000-000000000004', repeat('x', 1001))$q$, 'note_too_long');
  perform _t_raises($q$select public.send_referral_to_partner('a063a000-0000-0000-0000-000000000001', 'a063d000-0000-0000-0000-000000000001', '')$q$, 'already_linked');
  perform set_config('role', 'postgres', true);
  select count(*) into n from portal_email_outbox where referral_id = v_id;
  if n <> 0 then raise exception 'a partner without portal access gets no email, got %', n; end if;
  if exists (select 1 from referrals where deal_id = 'a063d000-0000-0000-0000-000000000004') then
    raise exception 'a refused send must create nothing';
  end if;

  update organizations set portal_enabled = false where id = '00000000-0000-0000-0000-000000001063';
  perform _t_act('a0630000-0000-0000-0000-000000000002');
  v_id := public.send_referral_to_partner('a063a000-0000-0000-0000-000000000001', 'a063d000-0000-0000-0000-000000000005', 'Portal is off');
  perform set_config('role', 'postgres', true);
  if exists (select 1 from portal_email_outbox where referral_id = v_id) then
    raise exception 'no partner email while the portal is off';
  end if;
  update organizations set portal_enabled = true where id = '00000000-0000-0000-0000-000000001063';
end $$;

-- 6. Existing paths keep the flag off.
do $$ declare v_id uuid; begin
  perform _t_act('a0630000-0000-0000-0000-000000000002');
  v_id := public.log_referral('a063a000-0000-0000-0000-000000000001', 'Logged Co');
  perform set_config('role', 'postgres', true);
  if (select partner_note_visible or shared_with_partner_at is not null from referrals where id = v_id) then
    raise exception 'an inbound referral is never partner-note-visible or shared';
  end if;
end $$;

-- 6b. An outbound row from before this release (backfill, old links) is never
--     shared: no email even when the helper is asked directly. A removed
--     (withdrawn) shared link is not emailed either.
do $$ declare v_old uuid := 'a063e000-0000-0000-0000-000000000001'; v_gone uuid := 'a063e000-0000-0000-0000-000000000002'; begin
  insert into referrals (id, org_id, partner_id, direction, source, status, company_name, deal_id, assigned_user_id, submitted_by_user_id, shared_with_partner_at)
  values (v_old,  '00000000-0000-0000-0000-000000001063', 'a063a000-0000-0000-0000-000000000002', 'outbound', 'rep_entered', 'accepted', 'Legacy Co',
          'a063d000-0000-0000-0000-000000000004', 'a0630000-0000-0000-0000-000000000002', 'a0630000-0000-0000-0000-000000000002', null),
         (v_gone, '00000000-0000-0000-0000-000000001063', 'a063a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'withdrawn', 'Removed Co',
          null, 'a0630000-0000-0000-0000-000000000002', 'a0630000-0000-0000-0000-000000000002', now());
  -- Give P2 portal access so only the sharing rule can stop the legacy email.
  insert into portal_users (id, org_id, partner_id, email, status) values
    ('a063b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001063', 'a063a000-0000-0000-0000-000000000002', 'kim@st.example', 'active');
  perform public._portal_enqueue_referral_sent(v_old);
  perform public._portal_enqueue_referral_sent(v_gone);
  if exists (select 1 from portal_email_outbox where referral_id in (v_old, v_gone)) then
    raise exception 'an unshared or removed outbound referral is never emailed';
  end if;
end $$;

-- 6c. Only an ACTIVE portal user of an enabled, not disabled org is emailed:
--     suspended, revoked and a disabled org each queue nothing. The D3 referral
--     is shared and live; its queued email is cleared so each case starts empty.
do $$ declare v_ref uuid; st text; begin
  select id into v_ref from referrals where deal_id = 'a063d000-0000-0000-0000-000000000003' and direction = 'outbound';
  foreach st in array array['suspended', 'revoked'] loop
    delete from portal_email_outbox where referral_id = v_ref;
    update portal_users set status = st::portal_user_status where id = 'a063b000-0000-0000-0000-000000000001';
    perform public._portal_enqueue_referral_sent(v_ref);
    if exists (select 1 from portal_email_outbox where referral_id = v_ref) then
      raise exception 'a % portal user must get no email', st;
    end if;
  end loop;
  update portal_users set status = 'active' where id = 'a063b000-0000-0000-0000-000000000001';
  update organizations set is_disabled = true where id = '00000000-0000-0000-0000-000000001063';
  perform public._portal_enqueue_referral_sent(v_ref);
  if exists (select 1 from portal_email_outbox where referral_id = v_ref) then
    raise exception 'a disabled org must get no email';
  end if;
  update organizations set is_disabled = false where id = '00000000-0000-0000-0000-000000001063';
  perform public._portal_enqueue_referral_sent(v_ref);
  if not exists (select 1 from portal_email_outbox where referral_id = v_ref and kind = 'partner_referral_sent') then
    raise exception 'control: an active user of an enabled org is emailed';
  end if;
end $$;

-- 7. The recipient rule: a digest has no referral; every other partner email has one.
do $$ begin
  insert into portal_email_outbox (org_id, kind, portal_user_id, payload, dedupe_key)
  values ('00000000-0000-0000-0000-000000001063', 'partner_digest', 'a063b000-0000-0000-0000-000000000001', '{}', 't063-digest');
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, portal_user_id, referral_id, payload, dedupe_key)
    select '00000000-0000-0000-0000-000000001063', 'partner_digest', 'a063b000-0000-0000-0000-000000000001', r.id, '{}', 't063-digest-ref'
      from referrals r limit 1$q$, 'portal_email_outbox_recipient_check');
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, portal_user_id, payload, dedupe_key)
    values ('00000000-0000-0000-0000-000000001063', 'partner_update', 'a063b000-0000-0000-0000-000000000001', '{}', 't063-update')$q$,
    'portal_email_outbox_recipient_check');
  insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
  values ('00000000-0000-0000-0000-000000001063', 'internal_partner_note', 'a0630000-0000-0000-0000-000000000002', '{}', 't063-note');
end $$;

rollback;
