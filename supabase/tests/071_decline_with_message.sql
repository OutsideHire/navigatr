-- Tests for 20261028000003_decline_with_message (FR-PORT-65, Q8).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/071_decline_with_message.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org portal-dwm, portal on): rep rita under admin ada. Partner P1
-- (owner rita) has an ACTIVE portal user. Referrals X, Y, Z are inbound,
-- rep-entered (so inserting them queues nothing) and submitted to rita.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001071', 'Decline ISO', 'portal-dwm', 'portal-dwm-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0710000-0000-0000-0000-000000000001', 'ada@dwm.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0710000-0000-0000-0000-000000000002', 'rita@dwm.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0710000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001071', 'admin', 'administrator',      'Ada Admin', 'ada@dwm.example',  'dwmada'::ltree,      null),
  ('a0710000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001071', 'rep',   'sales_professional', 'Rita Rep',  'rita@dwm.example', 'dwmada.rita'::ltree, 'a0710000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a071a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001071', 'a0710000-0000-0000-0000-000000000002', 'a0710000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@dwm.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a071b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001071', 'a071a000-0000-0000-0000-000000000001', 'jane@dwm.example', 'active');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, assigned_user_id) values
  ('a071f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001071', 'a071a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'submitted', 'Fresh Bakery', 'a0710000-0000-0000-0000-000000000002'),
  ('a071f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001071', 'a071a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'submitted', 'Gold Gym',     'a0710000-0000-0000-0000-000000000002'),
  ('a071f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001071', 'a071a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'submitted', 'Corner Cafe',  'a0710000-0000-0000-0000-000000000002');

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

-- Privileges (before any role switch): the app calls it, nobody else.
do $$ begin
  if not has_function_privilege('authenticated', 'public.decline_referral_with_message(uuid, referral_decline_reason, text, text)', 'EXECUTE') then
    raise exception 'authenticated must execute decline_referral_with_message';
  end if;
  if has_function_privilege('anon', 'public.decline_referral_with_message(uuid, referral_decline_reason, text, text)', 'EXECUTE') then
    raise exception 'anon must not execute decline_referral_with_message';
  end if;
end $$;

-- 1. Decline X with an internal note and a partner message.
select _t_act('a0710000-0000-0000-0000-000000000002');
select public.decline_referral_with_message(
  'a071f000-0000-0000-0000-000000000001', 'outside_icp', 'SECRET internal note',
  E'  Thanks Jane. They are a little too small for us right now.\n  ');
reset role;

do $$
declare
  v_rows int;
  v_payload jsonb;
  v_ref referrals;
begin
  select * into v_ref from referrals where id = 'a071f000-0000-0000-0000-000000000001';
  if v_ref.status <> 'declined' or v_ref.decline_reason <> 'outside_icp' or v_ref.decline_note <> 'SECRET internal note' then
    raise exception 'the decline itself should land unchanged: %', row_to_json(v_ref);
  end if;

  -- Exactly ONE email: the status email carries the message, the update row sends none.
  select count(*) into v_rows from portal_email_outbox where referral_id = 'a071f000-0000-0000-0000-000000000001';
  if v_rows <> 1 then
    raise exception 'expected exactly one outbox row, got %', v_rows;
  end if;
  select payload into v_payload from portal_email_outbox
   where referral_id = 'a071f000-0000-0000-0000-000000000001' and kind = 'partner_not_moving_forward';
  if v_payload is null then
    raise exception 'the one row should be partner_not_moving_forward';
  end if;
  if v_payload->>'message' is distinct from 'Thanks Jane. They are a little too small for us right now.' then
    raise exception 'payload message should be the trimmed partner message, got %', v_payload->>'message';
  end if;
  if v_payload::text like '%outside_icp%' or v_payload::text like '%SECRET%' then
    raise exception 'decline reason or internal note leaked into the payload: %', v_payload;
  end if;
  if (select count(*) from jsonb_object_keys(v_payload)) <> 11 then
    raise exception 'payload should be the ten partner keys plus message: %', v_payload;
  end if;

  -- The message is on the partner's referral page.
  if (select count(*) from public.portal_referral_updates(
        '00000000-0000-0000-0000-000000001071', 'a071a000-0000-0000-0000-000000000001',
        'a071f000-0000-0000-0000-000000000001')
       where body = 'Thanks Jane. They are a little too small for us right now.'
         and author_name = 'Rita Rep') <> 1 then
    raise exception 'the message should appear in portal_referral_updates';
  end if;

  -- Nothing leaks into later statements of this transaction.
  if coalesce(current_setting('navigatr.decline_message', true), '') <> '' then
    raise exception 'navigatr.decline_message leaked';
  end if;
  if coalesce(current_setting('navigatr.skip_update_email', true), '') = 'on' then
    raise exception 'navigatr.skip_update_email leaked';
  end if;
end $$;

-- 2. A later update in the same transaction still emails the partner.
select _t_act('a0710000-0000-0000-0000-000000000002');
select public.publish_referral_update('a071f000-0000-0000-0000-000000000001', 'One more thing.');
reset role;
do $$ begin
  if (select count(*) from portal_email_outbox
       where referral_id = 'a071f000-0000-0000-0000-000000000001' and kind = 'partner_update') <> 1 then
    raise exception 'a normal update after the decline should still queue its email';
  end if;
end $$;

-- 3. A blank message is a plain decline: no update row, no message key.
select _t_act('a0710000-0000-0000-0000-000000000002');
select public.decline_referral_with_message('a071f000-0000-0000-0000-000000000002', 'duplicate', null, E'  \n ');
reset role;
do $$
declare v_payload jsonb;
begin
  if exists (select 1 from referral_updates where referral_id = 'a071f000-0000-0000-0000-000000000002') then
    raise exception 'a blank message must not publish an update';
  end if;
  select payload into v_payload from portal_email_outbox
   where referral_id = 'a071f000-0000-0000-0000-000000000002' and kind = 'partner_not_moving_forward';
  if v_payload is null or v_payload ? 'message' then
    raise exception 'a blank message should send the plain email: %', v_payload;
  end if;
end $$;

-- 4. Too long a message is refused and nothing changes.
select _t_act('a0710000-0000-0000-0000-000000000002');
select _t_raises(
  format('select public.decline_referral_with_message(%L, %L, null, %L)',
         'a071f000-0000-0000-0000-000000000003', 'outside_icp', repeat('x', 1001)),
  'partner_message_too_long');
reset role;
do $$ begin
  if (select status from referrals where id = 'a071f000-0000-0000-0000-000000000003') <> 'submitted' then
    raise exception 'a refused message must not decline the referral';
  end if;
end $$;

-- 5. The plain decline is untouched: no message key.
select _t_act('a0710000-0000-0000-0000-000000000002');
select public.decline_referral('a071f000-0000-0000-0000-000000000003', 'outside_icp', null);
reset role;
do $$ begin
  if (select payload ? 'message' from portal_email_outbox
       where referral_id = 'a071f000-0000-0000-0000-000000000003' and kind = 'partner_not_moving_forward') then
    raise exception 'a plain decline must not carry a message';
  end if;
end $$;

rollback;
