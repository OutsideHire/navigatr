-- Tests for 20261014000003_portal_email_enqueue (Partner Portal Phase 1C).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/047_portal_email_enqueue.sql
-- Self-cleans via ROLLBACK. Runs as postgres: every write below fires the
-- triggers exactly as the SECURITY DEFINER RPCs would.
--
-- Fixture (org portal-mail "Mail ISO", portal on, value hidden):
--   admins ad1, ad2 (active) and ad3 (deactivated); rep rita under ad1.
--   P1 (owner rita) has an ACTIVE portal user; P2 has no portal user; P3 has a
--   SUSPENDED one. Deals D1 (value 5000.00) and D2 (value 2500.00), owner rita.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, partner_value_visibility) values
  ('00000000-0000-0000-0000-000000001047', 'Mail ISO', 'portal-mail', 'portal-mail-a1', true, false);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0470000-0000-0000-0000-000000000001', 'ad1@mail.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0470000-0000-0000-0000-000000000002', 'ad2@mail.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0470000-0000-0000-0000-000000000003', 'ad3@mail.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0470000-0000-0000-0000-000000000004', 'rita@mail.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0470000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001047', 'admin', 'administrator',      'Ada One',  'ad1@mail.example',  'mailad1'::ltree,      null, null),
  ('a0470000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001047', 'admin', 'administrator',      'Ada Two',  'ad2@mail.example',  'mailad2'::ltree,      null, null),
  ('a0470000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001047', 'admin', 'administrator',      'Ada Gone', 'ad3@mail.example',  'mailad3'::ltree,      null, now()),
  ('a0470000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001047', 'rep',   'sales_professional', 'Rita Rep', 'rita@mail.example', 'mailad1.rita'::ltree, 'a0470000-0000-0000-0000-000000000001', null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a047a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001047', 'a0470000-0000-0000-0000-000000000004', 'a0470000-0000-0000-0000-000000000004', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@mail.example'),
  ('a047a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001047', 'a0470000-0000-0000-0000-000000000004', 'a0470000-0000-0000-0000-000000000004', 'Pat CPA',  'Pat & Co',  'cpa', 'pat@mail.example'),
  ('a047a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001047', 'a0470000-0000-0000-0000-000000000004', 'a0470000-0000-0000-0000-000000000004', 'Sus CPA',  'Sus & Co',  'cpa', 'sus@mail.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a047b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001047', 'a047a000-0000-0000-0000-000000000001', 'jane@mail.example', 'active'),
  ('a047b000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001047', 'a047a000-0000-0000-0000-000000000003', 'sus@mail.example',  'suspended');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a047d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001047', 'a0470000-0000-0000-0000-000000000004', 'Fresh Bakery', '5 Oak St', 'Ann', 'ann@fresh.example', '5550470001', 500000, 'contacted', 'partner_referral'),
  ('a047d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001047', 'a0470000-0000-0000-0000-000000000004', 'Gold Gym',     '7 Elm St', 'Gil', 'gil@gold.example',  '5550470002', 250000, 'contacted', 'partner_referral');

create or replace function _t_rows(p_referral uuid, p_kind text) returns int language sql as $$
  select count(*)::int from portal_email_outbox where referral_id = p_referral and kind = p_kind
$$;

create or replace function _t_payload(p_referral uuid, p_kind text) returns jsonb language sql as $$
  select payload from portal_email_outbox where referral_id = p_referral and kind = p_kind
$$;

-- Privileges: every helper and trigger function is private.
do $$ declare f text; begin
  foreach f in array array[
    'public._portal_status_label(referral_status)',
    'public._portal_review_recipients(uuid, uuid)',
    'public._portal_partner_payload(uuid, referral_status, text)',
    'public._portal_enqueue_partner(referrals, text, text, text)',
    'public._portal_enqueue_new_referral(referrals)',
    'public.referrals_enqueue_insert_email()',
    'public.referrals_enqueue_status_email()',
    'public.referral_updates_enqueue_email()'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role must not execute private %', f; end if;
  end loop;
end $$;

-- Labels mirror portalLabels.ts.
do $$ begin
  if public._portal_status_label('submitted') <> 'Received'
     or public._portal_status_label('accepted') <> 'Accepted'
     or public._portal_status_label('working') <> 'In Progress'
     or public._portal_status_label('won') <> 'Closed Won'
     or public._portal_status_label('lost') <> 'Not Moving Forward'
     or public._portal_status_label('declined') <> 'Not Moving Forward'
     or public._portal_status_label('withdrawn') <> 'Withdrawn' then
    raise exception 'SQL labels drifted from portalLabels.ts';
  end if;
end $$;

-- 1. A portal submission: "received" to the partner, "new referral" to the assignee.
do $$ declare p jsonb; keys text[]; begin
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id, notes, decline_note) values
    ('a047f000-0000-0000-0000-000000000001', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Fresh Bakery',
     'a0470000-0000-0000-0000-000000000004', 'SECRET partner note', 'SECRET decline note');

  if _t_rows('a047f000-0000-0000-0000-000000000001', 'partner_received') <> 1 then raise exception 'portal submission should queue one received email'; end if;
  p := _t_payload('a047f000-0000-0000-0000-000000000001', 'partner_received');
  select array_agg(k order by k) into keys from jsonb_object_keys(p) k;
  if keys <> array['companyName','label','orgName','partnerName','ref','repEmail','repName','slug','updateBody','valueCents'] then
    raise exception 'partner payload keys must be the allowlist, got %', keys;
  end if;
  if p->>'slug' <> 'portal-mail' or p->>'orgName' <> 'Mail ISO' or p->>'partnerName' <> 'Jane CPA'
     or p->>'companyName' <> 'Fresh Bakery' or p->>'label' <> 'Received'
     or p->>'ref' <> 'REF-A047F000' or p->>'repName' <> 'Rita Rep' or p->>'repEmail' <> 'rita@mail.example'
     or jsonb_typeof(p->'valueCents') <> 'null' or jsonb_typeof(p->'updateBody') <> 'null' then
    raise exception 'received payload wrong: %', p;
  end if;
  if p::text like '%SECRET%' then raise exception 'payload must never carry notes or reasons: %', p; end if;
  if (select portal_user_id from portal_email_outbox where referral_id = 'a047f000-0000-0000-0000-000000000001' and kind = 'partner_received')
     is distinct from 'a047b000-0000-0000-0000-000000000001' then
    raise exception 'received email should go to the partner''s portal user';
  end if;

  if (select count(*) from portal_email_outbox
       where referral_id = 'a047f000-0000-0000-0000-000000000001' and kind = 'internal_new_referral'
         and recipient_user_id = 'a0470000-0000-0000-0000-000000000004') <> 1 then
    raise exception 'the assignee should get one new-referral email';
  end if;
  p := _t_payload('a047f000-0000-0000-0000-000000000001', 'internal_new_referral');
  select array_agg(k order by k) into keys from jsonb_object_keys(p) k;
  if keys <> array['appUrlPath','companyNames','count'] or p <> '{"appUrlPath":"/partners","companyNames":["Fresh Bakery"],"count":1}'::jsonb then
    raise exception 'internal payload wrong: %', p;
  end if;
end $$;

-- 2. No portal access, or suspended access: no partner mail, internal mail still goes.
do $$ begin
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id) values
    ('a047f000-0000-0000-0000-000000000002', 'a047a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'submitted', 'No Portal Co',  'a0470000-0000-0000-0000-000000000004'),
    ('a047f000-0000-0000-0000-000000000003', 'a047a000-0000-0000-0000-000000000003', 'inbound', 'portal_signed_in', 'submitted', 'Suspended Co', 'a0470000-0000-0000-0000-000000000004');
  if exists (select 1 from portal_email_outbox
              where referral_id in ('a047f000-0000-0000-0000-000000000002', 'a047f000-0000-0000-0000-000000000003')
                and kind like 'partner\_%') then
    raise exception 'partners without active portal access must get no email';
  end if;
  if _t_rows('a047f000-0000-0000-0000-000000000002', 'internal_new_referral') <> 1 then
    raise exception 'the rep still hears about a referral whose partner has no portal access';
  end if;
end $$;

-- 3. Administrator queue: every active administrator, nobody deactivated.
do $$ declare got uuid[]; begin
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id) values
    ('a047f000-0000-0000-0000-000000000004', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Queue Co', null);
  select array_agg(recipient_user_id order by recipient_user_id) into got
    from portal_email_outbox where referral_id = 'a047f000-0000-0000-0000-000000000004' and kind = 'internal_new_referral';
  if got <> array['a0470000-0000-0000-0000-000000000001'::uuid, 'a0470000-0000-0000-0000-000000000002'::uuid] then
    raise exception 'admin-queue referral should mail ad1 and ad2 only, got %', got;
  end if;
  if (_t_payload('a047f000-0000-0000-0000-000000000004', 'partner_received'))->'repName' <> 'null'::jsonb then
    raise exception 'an unassigned referral has no rep in the partner email';
  end if;
end $$;

-- 4. Rep-logged and outbound referrals send nothing on creation.
do $$ begin
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id) values
    ('a047f000-0000-0000-0000-000000000005', 'a047a000-0000-0000-0000-000000000001', 'inbound',  'rep_entered', 'submitted', 'Logged Co', 'a0470000-0000-0000-0000-000000000004'),
    ('a047f000-0000-0000-0000-000000000006', 'a047a000-0000-0000-0000-000000000001', 'outbound', 'rep_entered', 'submitted', 'Out Co',    'a0470000-0000-0000-0000-000000000004');
  if exists (select 1 from portal_email_outbox
              where referral_id in ('a047f000-0000-0000-0000-000000000005', 'a047f000-0000-0000-0000-000000000006')) then
    raise exception 'rep-logged or outbound referrals must not email on creation';
  end if;
end $$;

-- 5. Status changes: accepted, In Progress is silent, Closed Won without value, dedupe on a re-win.
do $$ declare p jsonb; begin
  update referrals set status = 'accepted', deal_id = 'a047d000-0000-0000-0000-000000000001'
   where id = 'a047f000-0000-0000-0000-000000000001';
  if _t_rows('a047f000-0000-0000-0000-000000000001', 'partner_accepted') <> 1 then raise exception 'accept should queue one email'; end if;
  if (_t_payload('a047f000-0000-0000-0000-000000000001', 'partner_accepted'))->>'label' <> 'Accepted' then
    raise exception 'accepted email should carry the Accepted label';
  end if;

  update referrals set status = 'working' where id = 'a047f000-0000-0000-0000-000000000001';
  if (select count(*) from portal_email_outbox where referral_id = 'a047f000-0000-0000-0000-000000000001') <> 3 then
    raise exception 'In Progress must not email (expected received, new referral, accepted only)';
  end if;

  update referrals set status = 'won' where id = 'a047f000-0000-0000-0000-000000000001';
  p := _t_payload('a047f000-0000-0000-0000-000000000001', 'partner_closed_won');
  if p->>'label' <> 'Closed Won' or jsonb_typeof(p->'valueCents') <> 'null' then
    raise exception 'closed won with value hidden must carry no value: %', p;
  end if;

  update referrals set status = 'working' where id = 'a047f000-0000-0000-0000-000000000001';
  update referrals set status = 'won' where id = 'a047f000-0000-0000-0000-000000000001';
  if _t_rows('a047f000-0000-0000-0000-000000000001', 'partner_closed_won') <> 1 then
    raise exception 'a reopen and re-win must not send a second Closed Won';
  end if;
end $$;

-- 6. Value shown only when the ISO allows it.
do $$ declare p jsonb; begin
  update organizations set partner_value_visibility = true where id = '00000000-0000-0000-0000-000000001047';
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id) values
    ('a047f000-0000-0000-0000-000000000007', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Gold Gym', 'a0470000-0000-0000-0000-000000000004');
  update referrals set status = 'accepted', deal_id = 'a047d000-0000-0000-0000-000000000002' where id = 'a047f000-0000-0000-0000-000000000007';
  update referrals set status = 'won' where id = 'a047f000-0000-0000-0000-000000000007';
  p := _t_payload('a047f000-0000-0000-0000-000000000007', 'partner_closed_won');
  if (p->>'valueCents')::bigint is distinct from 250000 then raise exception 'closed won should carry the value when allowed: %', p; end if;
  if jsonb_typeof((_t_payload('a047f000-0000-0000-0000-000000000007', 'partner_accepted'))->'valueCents') <> 'null' then
    raise exception 'only Closed Won ever carries a value';
  end if;
end $$;

-- 7. Not moving forward (lost or declined), withdrawn by the ISO vs by the partner.
do $$ begin
  insert into referrals (id, partner_id, direction, source, status, company_name, assigned_user_id) values
    ('a047f000-0000-0000-0000-000000000008', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Lost Co',     'a0470000-0000-0000-0000-000000000004'),
    ('a047f000-0000-0000-0000-000000000009', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Declined Co', 'a0470000-0000-0000-0000-000000000004'),
    ('a047f000-0000-0000-0000-00000000000a', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Pulled Co',   'a0470000-0000-0000-0000-000000000004'),
    ('a047f000-0000-0000-0000-00000000000b', 'a047a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Self Co',     'a0470000-0000-0000-0000-000000000004');
  update referrals set status = 'accepted' where id = 'a047f000-0000-0000-0000-000000000008';
  update referrals set status = 'lost'     where id = 'a047f000-0000-0000-0000-000000000008';
  update referrals set status = 'declined', decline_reason = 'outside_icp', decline_note = 'SECRET reason'
   where id = 'a047f000-0000-0000-0000-000000000009';
  if (_t_payload('a047f000-0000-0000-0000-000000000008', 'partner_not_moving_forward'))->>'label' <> 'Not Moving Forward'
     or (_t_payload('a047f000-0000-0000-0000-000000000009', 'partner_not_moving_forward'))->>'label' <> 'Not Moving Forward' then
    raise exception 'lost and declined should both send Not Moving Forward';
  end if;
  if (_t_payload('a047f000-0000-0000-0000-000000000009', 'partner_not_moving_forward'))::text like '%outside_icp%'
     or (_t_payload('a047f000-0000-0000-0000-000000000009', 'partner_not_moving_forward'))::text like '%SECRET%' then
    raise exception 'a decline reason must never reach the payload';
  end if;

  update referrals set status = 'withdrawn' where id = 'a047f000-0000-0000-0000-00000000000a';
  if _t_rows('a047f000-0000-0000-0000-00000000000a', 'partner_withdrawn') <> 1 then
    raise exception 'a withdrawal by the ISO should email the partner';
  end if;

  perform set_config('navigatr.referral_actor', 'partner', true);
  update referrals set status = 'withdrawn' where id = 'a047f000-0000-0000-0000-00000000000b';
  perform set_config('navigatr.referral_actor', '', true);
  if _t_rows('a047f000-0000-0000-0000-00000000000b', 'partner_withdrawn') <> 0 then
    raise exception 'a partner who withdrew their own referral gets no email';
  end if;
end $$;

-- 8. A rep-logged referral emails on status changes; an outbound one never does.
do $$ begin
  update referrals set status = 'accepted' where id = 'a047f000-0000-0000-0000-000000000005';
  update referrals set status = 'accepted' where id = 'a047f000-0000-0000-0000-000000000006';
  if _t_rows('a047f000-0000-0000-0000-000000000005', 'partner_accepted') <> 1 then
    raise exception 'a rep-logged inbound referral should email its partner when accepted';
  end if;
  if exists (select 1 from portal_email_outbox where referral_id = 'a047f000-0000-0000-0000-000000000006') then
    raise exception 'an outbound referral must never email';
  end if;
end $$;

-- 9. A published update: one email with the body and the current label.
do $$ declare v_update uuid; p jsonb; begin
  insert into referral_updates (org_id, referral_id, author_user_id, body) values
    ('00000000-0000-0000-0000-000000001047', 'a047f000-0000-0000-0000-000000000001', 'a0470000-0000-0000-0000-000000000004', 'Demo booked for Tuesday')
  returning id into v_update;
  p := _t_payload('a047f000-0000-0000-0000-000000000001', 'partner_update');
  if p->>'updateBody' <> 'Demo booked for Tuesday' or p->>'label' <> 'Closed Won' then
    raise exception 'update email wrong: %', p;
  end if;
  if (select dedupe_key from portal_email_outbox where referral_id = 'a047f000-0000-0000-0000-000000000001' and kind = 'partner_update')
     <> 'partner_update:a047f000-0000-0000-0000-000000000001:' || v_update::text then
    raise exception 'update dedupe key should name the update';
  end if;
end $$;

rollback;
