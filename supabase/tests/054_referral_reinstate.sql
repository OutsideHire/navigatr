-- Tests for 20261016000005_referral_reinstate (Partner Portal Phase 2A, FR-PORT-48/80).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/054_referral_reinstate.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org portal-reinstate): boss administrator; rita rep and rob rep in
-- separate branches. Partners P1 (Jane) and P2 (Kim), both owned by rita.
--   H1 P1 submitted Holder Co          (holds credit)
--   H2 P1 submitted Second Holder Co   (holds credit)
--   D1 P1 declined duplicate of H1     Dup One       reinstatable once H1 closes
--   D2 P2 declined duplicate of H1     Dup Two       reinstatable once H1 closes
--   D3 P1 declined outside_icp, points at H1        never reinstatable
--   D4 P1 declined duplicate of H1, purged          never reinstatable
--   D5 P1 declined duplicate of H2     Late Dup Co   reinstatable once H2 closes

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001054', 'Reinstate Org', 'portal-reinstate', 'portal-reinstate-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0540000-0000-0000-0000-000000000001', 'boss@rin.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0540000-0000-0000-0000-000000000002', 'rita@rin.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0540000-0000-0000-0000-000000000003', 'rob@rin.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0540000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001054', 'admin', 'administrator',      'Boss',     'boss@rin.example', 'rinboss'::ltree,      null),
  ('a0540000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001054', 'rep',   'sales_professional', 'Rita Rep', 'rita@rin.example', 'rinboss.rita'::ltree, 'a0540000-0000-0000-0000-000000000001'),
  ('a0540000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001054', 'rep',   'sales_professional', 'Rob Rep',  'rob@rin.example',  'rinboss.rob'::ltree,  'a0540000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a054a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001054', 'a0540000-0000-0000-0000-000000000002', 'a0540000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@rin.example'),
  ('a054a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001054', 'a0540000-0000-0000-0000-000000000002', 'a0540000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@rin.example');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_phone, assigned_user_id, submitted_at) values
  ('a054f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Holder Co',        'Hal', '5550540001', 'a0540000-0000-0000-0000-000000000002', now() - interval '5 days'),
  ('a054f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Second Holder Co', 'Hil', '5550540002', 'a0540000-0000-0000-0000-000000000002', now() - interval '5 days');

insert into referrals (
  id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_phone,
  decline_reason, decline_note, duplicate_of_referral_id, triaged_by, triaged_at, assigned_user_id,
  submitted_at, purged_at
) values
  ('a054f000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined', 'Dup One',       'Ann', '5550540011', 'duplicate',   'same as Holder Co', 'a054f000-0000-0000-0000-000000000001', 'a0540000-0000-0000-0000-000000000002', now() - interval '1 day', 'a0540000-0000-0000-0000-000000000002', now() - interval '4 days', null),
  ('a054f000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'declined', 'Dup Two',       'Bea', '5550540012', 'duplicate',   null,                'a054f000-0000-0000-0000-000000000001', 'a0540000-0000-0000-0000-000000000002', now() - interval '1 day', 'a0540000-0000-0000-0000-000000000002', now() - interval '4 days', null),
  ('a054f000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined', 'Not Dup Co',    'Cy',  '5550540013', 'outside_icp', null,                'a054f000-0000-0000-0000-000000000001', 'a0540000-0000-0000-0000-000000000002', now() - interval '1 day', 'a0540000-0000-0000-0000-000000000002', now() - interval '4 days', null),
  ('a054f000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined', 'Purged Dup Co', null,  null,         'duplicate',   null,                'a054f000-0000-0000-0000-000000000001', 'a0540000-0000-0000-0000-000000000002', now() - interval '1 day', 'a0540000-0000-0000-0000-000000000002', now() - interval '4 days', now()),
  ('a054f000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined', 'Late Dup Co',   'Lu',  '5550540015', 'duplicate',   null,                'a054f000-0000-0000-0000-000000000002', 'a0540000-0000-0000-0000-000000000002', now() - interval '1 day', 'a0540000-0000-0000-0000-000000000002', now() - interval '4 days', null);

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

-- can_reinstate as the given user, through RLS (an invisible row reads as false).
create or replace function _t_can(p_user uuid, p_referral uuid) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform _t_act(p_user);
  select public.can_reinstate(r) into v from referrals r where r.id = p_referral;
  return coalesce(v, false);
end $$;

-- 1. Privileges (before any role switch).
do $$ begin
  if not has_function_privilege('authenticated', 'public.reinstate_referral(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.can_reinstate(referrals)', 'EXECUTE') then
    raise exception 'authenticated should execute reinstate_referral and can_reinstate';
  end if;
  if has_function_privilege('anon', 'public.reinstate_referral(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.can_reinstate(referrals)', 'EXECUTE') then
    raise exception 'anon must not execute the reinstate functions';
  end if;
  if has_function_privilege('authenticated', 'public._referral_reinstatable(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public._referral_reinstatable(uuid)', 'EXECUTE') then
    raise exception '_referral_reinstatable must be private';
  end if;
end $$;

-- 2. Nothing is reinstatable while the holder is still live (role switches from here on).
do $$ begin
  if _t_can('a0540000-0000-0000-0000-000000000002', 'a054f000-0000-0000-0000-000000000011') then
    raise exception 'D1 is not reinstatable while H1 holds credit';
  end if;
  perform _t_act('a0540000-0000-0000-0000-000000000002');
  perform _t_raises($q$select public.reinstate_referral('a054f000-0000-0000-0000-000000000011')$q$, 'referral_not_reinstatable');
end $$;

-- 3. Declining the holder emails the duplicates' owner, once per partner.
do $$ declare n int; p jsonb; begin
  perform _t_act('a0540000-0000-0000-0000-000000000002');
  perform public.decline_referral('a054f000-0000-0000-0000-000000000001', 'outside_footprint', null);

  perform set_config('role', 'postgres', true);
  select count(*) into n from portal_email_outbox where kind = 'internal_reinstate_available';
  if n <> 2 then raise exception 'expected 2 reinstate emails (one per partner), got %', n; end if;
  select payload into p from portal_email_outbox
   where kind = 'internal_reinstate_available'
     and recipient_user_id = 'a0540000-0000-0000-0000-000000000002'
     and portal_user_id is null and referral_id is null
     and payload->>'appUrlPath' = '/partners/a054a000-0000-0000-0000-000000000001';
  if p is distinct from jsonb_build_object(
       'appUrlPath', '/partners/a054a000-0000-0000-0000-000000000001',
       'companyNames', jsonb_build_array('Dup One'),
       'count', 1) then
    raise exception 'P1 reinstate payload wrong: %', p;
  end if;
  select payload into p from portal_email_outbox
   where kind = 'internal_reinstate_available'
     and payload->>'appUrlPath' = '/partners/a054a000-0000-0000-0000-000000000002';
  if p->'companyNames' is distinct from jsonb_build_array('Dup Two') then
    raise exception 'P2 reinstate payload wrong: %', p;
  end if;
end $$;

-- 4. Who can reinstate what.
do $$ begin
  if not _t_can('a0540000-0000-0000-0000-000000000002', 'a054f000-0000-0000-0000-000000000011') then raise exception 'rita can reinstate D1'; end if;
  if not _t_can('a0540000-0000-0000-0000-000000000002', 'a054f000-0000-0000-0000-000000000012') then raise exception 'rita can reinstate D2'; end if;
  if _t_can('a0540000-0000-0000-0000-000000000002', 'a054f000-0000-0000-0000-000000000013') then raise exception 'D3 was not declined as a duplicate'; end if;
  if _t_can('a0540000-0000-0000-0000-000000000002', 'a054f000-0000-0000-0000-000000000014') then raise exception 'D4 is purged'; end if;
  if _t_can('a0540000-0000-0000-0000-000000000003', 'a054f000-0000-0000-0000-000000000011') then raise exception 'rob cannot triage D1'; end if;
  if not _t_can('a0540000-0000-0000-0000-000000000001', 'a054f000-0000-0000-0000-000000000011') then raise exception 'an admin can reinstate D1'; end if;
  perform _t_act('a0540000-0000-0000-0000-000000000003');
  perform _t_raises($q$select public.reinstate_referral('a054f000-0000-0000-0000-000000000011')$q$, 'not_authorized');
end $$;

-- 5. Reinstate D1: back in the queue, triage reset, attribution flag cleared.
do $$ declare r record; h record; begin
  perform _t_act('a0540000-0000-0000-0000-000000000002');
  perform public.reinstate_referral('a054f000-0000-0000-0000-000000000011');
  select * into r from referrals where id = 'a054f000-0000-0000-0000-000000000011';
  if r.status <> 'submitted' or r.decline_reason is not null or r.decline_note is not null
     or r.triaged_by is not null or r.triaged_at is not null or r.nudged_at is not null
     or r.duplicate_of_referral_id is not null then
    raise exception 'reinstated referral wrong: %', row_to_json(r);
  end if;
  select * into h from referral_status_history
   where referral_id = 'a054f000-0000-0000-0000-000000000011' and to_status = 'submitted';
  if h.from_status is distinct from 'declined' or h.actor_type <> 'user'
     or h.actor_id is distinct from 'a0540000-0000-0000-0000-000000000002'
     or h.note not like 'Reinstated: earlier referral REF-% is closed' then
    raise exception 'reinstate history wrong: %', row_to_json(h);
  end if;

  perform _t_raises($q$select public.reinstate_referral('a054f000-0000-0000-0000-000000000011')$q$, 'referral_not_reinstatable');
  perform _t_raises($q$select public.reinstate_referral('a054f000-0000-0000-0000-000000000013')$q$, 'referral_not_reinstatable');
  perform _t_raises($q$select public.reinstate_referral('a054f000-0000-0000-0000-000000000014')$q$, 'referral_not_reinstatable');

  -- Accepting it no longer needs an override reason.
  if (public.accept_referral('a054f000-0000-0000-0000-000000000011') ->> 'result') <> 'accepted' then
    raise exception 'a reinstated referral accepts like a fresh one';
  end if;
end $$;

-- 6. Withdrawing a holder also offers its duplicates.
do $$ declare n int; begin
  perform _t_act('a0540000-0000-0000-0000-000000000002');
  perform public.withdraw_referral('a054f000-0000-0000-0000-000000000002', null);
  perform set_config('role', 'postgres', true);
  select count(*) into n from portal_email_outbox
   where kind = 'internal_reinstate_available'
     and dedupe_key = 'internal_reinstate_available:a054f000-0000-0000-0000-000000000002:a0540000-0000-0000-0000-000000000002:a054a000-0000-0000-0000-000000000001'
     and payload->'companyNames' = jsonb_build_array('Late Dup Co');
  if n <> 1 then raise exception 'withdrawing H2 should offer D5, got % rows', n; end if;
end $$;

-- 7. Controller ruling D4: reinstating also clears the duplicate-of-deal flag, and a
-- referral declined, reinstated, declined again emails its partner twice.
do $$ declare n int; r record; begin
  perform set_config('role', 'postgres', true);
  insert into portal_users (id, org_id, partner_id, email, status) values
    ('a054b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000002', 'kim@mail.example', 'active');
  insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
    ('a054d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001054', 'a0540000-0000-0000-0000-000000000002', 'Existing Deal', '1 Oak St', 'Ed', 'ed@x.example', '5550540099', 1000, 'contacted', 'partner_referral');
  insert into referrals (id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_phone,
                         duplicate_of_referral_id, duplicate_of_deal_id, assigned_user_id, submitted_at) values
    ('a054f000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'submitted', 'Twice Dup Co', 'Tim', '5550540016',
     'a054f000-0000-0000-0000-000000000001', 'a054d000-0000-0000-0000-000000000001', 'a0540000-0000-0000-0000-000000000002', now() - interval '3 days');

  perform _t_act('a0540000-0000-0000-0000-000000000002');
  perform public.decline_referral('a054f000-0000-0000-0000-000000000016', 'duplicate', null);
  perform public.reinstate_referral('a054f000-0000-0000-0000-000000000016');
  select * into r from referrals where id = 'a054f000-0000-0000-0000-000000000016';
  if r.status <> 'submitted' or r.duplicate_of_deal_id is not null or r.duplicate_of_referral_id is not null then
    raise exception 'reinstate must clear both duplicate pointers: %', row_to_json(r);
  end if;
  if (public.accept_referral('a054f000-0000-0000-0000-000000000016') ->> 'result') is distinct from 'accepted' then
    raise exception 'accept after reinstate needs no override reason (expected result accepted)';
  end if;
end $$;

do $$ declare n int; begin
  perform set_config('role', 'postgres', true);
  -- A second reinstatable duplicate transition on a fresh referral.
  insert into referrals (id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_phone,
                         duplicate_of_referral_id, assigned_user_id, submitted_at) values
    ('a054f000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-000000001054', 'a054a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'submitted', 'Again Dup Co', 'Al', '5550540017',
     'a054f000-0000-0000-0000-000000000001', 'a0540000-0000-0000-0000-000000000002', now() - interval '3 days');
  perform _t_act('a0540000-0000-0000-0000-000000000002');
  perform public.decline_referral('a054f000-0000-0000-0000-000000000017', 'duplicate', null);
  perform public.reinstate_referral('a054f000-0000-0000-0000-000000000017');
  perform set_config('role', 'postgres', true);
  update referrals set duplicate_of_referral_id = 'a054f000-0000-0000-0000-000000000001'
   where id = 'a054f000-0000-0000-0000-000000000017';
  perform _t_act('a0540000-0000-0000-0000-000000000002');
  perform public.decline_referral('a054f000-0000-0000-0000-000000000017', 'duplicate', null);
  perform set_config('role', 'postgres', true);
  select count(*) into n from portal_email_outbox
   where kind = 'partner_not_moving_forward' and referral_id = 'a054f000-0000-0000-0000-000000000017';
  if n <> 2 then raise exception 'decline, reinstate, decline should queue two not-moving-forward rows, got %', n; end if;
  -- A single decline still queues exactly one.
  select count(*) into n from portal_email_outbox
   where kind = 'partner_not_moving_forward' and referral_id = 'a054f000-0000-0000-0000-000000000016';
  if n <> 1 then raise exception 'one decline should queue one row, got %', n; end if;
end $$;

rollback;
