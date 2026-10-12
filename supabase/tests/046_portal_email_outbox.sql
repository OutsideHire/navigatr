-- Tests for 20261014000002_portal_email_outbox (Partner Portal Phase 1C).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/046_portal_email_outbox.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- Fixture (org portal-outbox, portal on): boss administrator, rita (active rep),
-- gone (deactivated rep). Partner P1 has an active portal user, P2 a suspended one.
-- Outbox rows:
--   E1 partner_received        -> P1 portal user   (claimable)
--   E2 partner_accepted        -> P2 portal user   (suspended: dropped on claim)
--   E3 internal_new_referral   -> rita             (claimable)
--   E4 internal_nudge          -> gone             (deactivated: dropped on claim)
--   E5 partner_update          -> P1, attempts 5   (never claimed)
--   E6 partner_closed_won      -> P1, already sent (never claimed)

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001046', 'Outbox Org', 'portal-outbox', 'portal-outbox-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0460000-0000-0000-0000-000000000001', 'boss@outbox.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0460000-0000-0000-0000-000000000002', 'rita@outbox.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0460000-0000-0000-0000-000000000003', 'gone@outbox.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0460000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001046', 'admin', 'administrator',      'Boss',     'boss@outbox.example', 'obboss'::ltree,      null, null),
  ('a0460000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001046', 'rep',   'sales_professional', 'Rita Rep', 'rita@outbox.example', 'obboss.rita'::ltree, 'a0460000-0000-0000-0000-000000000001', null),
  ('a0460000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001046', 'rep',   'sales_professional', 'Gone Rep', 'gone@outbox.example', 'obboss.gone'::ltree, 'a0460000-0000-0000-0000-000000000001', now());

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a046a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001046', 'a0460000-0000-0000-0000-000000000002', 'a0460000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@outbox.example'),
  ('a046a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001046', 'a0460000-0000-0000-0000-000000000002', 'a0460000-0000-0000-0000-000000000002', 'Sam CPA',  'Sam & Co',  'cpa', 'sam@outbox.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a046b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001046', 'a046a000-0000-0000-0000-000000000001', 'jane@outbox.example', 'active'),
  ('a046b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001046', 'a046a000-0000-0000-0000-000000000002', 'sam@outbox.example',  'suspended');


-- Referrals: R1 is Jane's, R2 is Sam's.
insert into referrals (id, org_id, partner_id, direction, source, status, company_name) values
  ('a046f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001046', 'a046a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'R1 Co'),
  ('a046f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001046', 'a046a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'submitted', 'R2 Co');

-- Rejection fixtures. (profiles.email is NOT NULL, so a blank address stands in for a missing one.) Org B is healthy; C has the portal off; D is disabled.
insert into organizations (id, name, slug, invite_code, portal_enabled, is_disabled) values
  ('00000000-0000-0000-0000-000000002046', 'Outbox B', 'portal-outbox-b', 'portal-outbox-b1', true,  false),
  ('00000000-0000-0000-0000-000000003046', 'Outbox C', 'portal-outbox-c', 'portal-outbox-c1', false, false),
  ('00000000-0000-0000-0000-000000004046', 'Outbox D', 'portal-outbox-d', 'portal-outbox-d1', true,  true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0460000-0000-0000-0000-0000000000b1', 'repb@outbox.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('a0460000-0000-0000-0000-0000000000b2', 'noemail@outbox.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0460000-0000-0000-0000-0000000000b3', 'repd@outbox.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('a0460000-0000-0000-0000-0000000000b4', 'bossb@outbox.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0460000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-000000002046', 'admin', 'administrator',      'Boss B',  'bossb@outbox.example', 'obbossb'::ltree, null, null),
  ('a0460000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000002046', 'rep',   'sales_professional', 'Rep B',   'repb@outbox.example',  'obbossb.repb'::ltree, 'a0460000-0000-0000-0000-0000000000b4', null),
  ('a0460000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000001046', 'rep',   'sales_professional', 'No Email', '',                     'obboss.noemail'::ltree, 'a0460000-0000-0000-0000-000000000001', null),
  ('a0460000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000004046', 'admin', 'administrator',      'Rep D',   'repd@outbox.example',  'obrepd'::ltree, null, null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a046a000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000002046', 'a0460000-0000-0000-0000-0000000000b1', 'a0460000-0000-0000-0000-0000000000b1', 'PB', 'PB Co', 'cpa', 'pb@outbox.example'),
  ('a046a000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000003046', 'a0460000-0000-0000-0000-0000000000b4', 'a0460000-0000-0000-0000-0000000000b4', 'PC', 'PC Co', 'cpa', 'pc@outbox.example'),
  ('a046a000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000004046', 'a0460000-0000-0000-0000-0000000000b3', 'a0460000-0000-0000-0000-0000000000b3', 'PD', 'PD Co', 'cpa', 'pd@outbox.example'),
  ('a046a000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000001046', 'a0460000-0000-0000-0000-000000000002', 'a0460000-0000-0000-0000-000000000002', 'PI', 'PI Co', 'cpa', 'pi@outbox.example'),
  ('a046a000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000001046', 'a0460000-0000-0000-0000-000000000002', 'a0460000-0000-0000-0000-000000000002', 'PR', 'PR Co', 'cpa', 'pr@outbox.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a046b000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000002046', 'a046a000-0000-0000-0000-0000000000b1', 'pb@outbox.example', 'active'),
  ('a046b000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000003046', 'a046a000-0000-0000-0000-0000000000c1', 'pc@outbox.example', 'active'),
  ('a046b000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000004046', 'a046a000-0000-0000-0000-0000000000d1', 'pd@outbox.example', 'active'),
  ('a046b000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000001046', 'a046a000-0000-0000-0000-0000000000e1', 'pi@outbox.example', 'invited'),
  ('a046b000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000001046', 'a046a000-0000-0000-0000-0000000000e2', 'pr@outbox.example', 'revoked');

insert into referrals (id, org_id, partner_id, direction, source, status, company_name) values
  ('a046f000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000003046', 'a046a000-0000-0000-0000-0000000000c1', 'inbound', 'portal_signed_in', 'submitted', 'RC Co'),
  ('a046f000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000004046', 'a046a000-0000-0000-0000-0000000000d1', 'inbound', 'portal_signed_in', 'submitted', 'RD Co'),
  ('a046f000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000001046', 'a046a000-0000-0000-0000-0000000000e1', 'inbound', 'portal_signed_in', 'submitted', 'RI Co'),
  ('a046f000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000001046', 'a046a000-0000-0000-0000-0000000000e2', 'inbound', 'portal_signed_in', 'submitted', 'RR Co');

-- The referral fixtures above fire the 1C enqueue triggers (20261014000003); clear
-- that trigger output so these tests exercise only the hand-built outbox rows.
delete from portal_email_outbox;

insert into portal_email_outbox (id, org_id, kind, referral_id, portal_user_id, recipient_user_id, payload, dedupe_key, attempts, sent_at) values
  ('a046e000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001046', 'partner_received',      'a046f000-0000-0000-0000-000000000001', 'a046b000-0000-0000-0000-000000000001', null, '{"label":"Received"}', 't46:e1', 0, null),
  ('a046e000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001046', 'partner_accepted',      'a046f000-0000-0000-0000-000000000002', 'a046b000-0000-0000-0000-000000000002', null, '{"label":"Accepted"}', 't46:e2', 0, null),
  ('a046e000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001046', 'internal_new_referral', null, null, 'a0460000-0000-0000-0000-000000000002', '{"count":1}', 't46:e3', 0, null),
  ('a046e000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001046', 'internal_nudge',        null, null, 'a0460000-0000-0000-0000-000000000003', '{"count":1}', 't46:e4', 0, null),
  ('a046e000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001046', 'partner_update',        'a046f000-0000-0000-0000-000000000001', 'a046b000-0000-0000-0000-000000000001', null, '{"label":"Accepted"}', 't46:e5', 5, null),
  ('a046e000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001046', 'partner_closed_won',    'a046f000-0000-0000-0000-000000000001', 'a046b000-0000-0000-0000-000000000001', null, '{"label":"Closed Won"}', 't46:e6', 1, now());

insert into portal_email_outbox (id, org_id, kind, referral_id, portal_user_id, recipient_user_id, payload, dedupe_key) values
  ('a046e000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000001046', 'partner_received', 'a046f000-0000-0000-0000-0000000000e1', 'a046b000-0000-0000-0000-0000000000e1', null, '{}', 't46:rej_invited'),
  ('a046e000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000001046', 'partner_received', 'a046f000-0000-0000-0000-0000000000e2', 'a046b000-0000-0000-0000-0000000000e2', null, '{}', 't46:rej_revoked'),
  ('a046e000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000003046', 'partner_received', 'a046f000-0000-0000-0000-0000000000c1', 'a046b000-0000-0000-0000-0000000000c1', null, '{}', 't46:rej_portal_off'),
  ('a046e000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000004046', 'partner_received', 'a046f000-0000-0000-0000-0000000000d1', 'a046b000-0000-0000-0000-0000000000d1', null, '{}', 't46:rej_org_disabled'),
  ('a046e000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000001046', 'partner_received', 'a046f000-0000-0000-0000-000000000001', 'a046b000-0000-0000-0000-0000000000b1', null, '{}', 't46:rej_pu_other_org'),
  ('a046e000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000001046', 'partner_received', 'a046f000-0000-0000-0000-000000000002', 'a046b000-0000-0000-0000-000000000001', null, '{}', 't46:rej_wrong_partner'),
  ('a046e000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000001046', 'internal_nudge', null, null, 'a0460000-0000-0000-0000-0000000000b1', '{}', 't46:rej_rep_moved'),
  ('a046e000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000001046', 'internal_nudge', null, null, 'a0460000-0000-0000-0000-0000000000b2', '{}', 't46:rej_rep_no_email'),
  ('a046e000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000004046', 'internal_nudge', null, null, 'a0460000-0000-0000-0000-0000000000b3', '{}', 't46:rej_org_disabled_rep');

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

-- Privileges.
do $$ declare f text; begin
  if has_table_privilege('authenticated', 'public.portal_email_outbox', 'SELECT')
     or has_table_privilege('anon', 'public.portal_email_outbox', 'SELECT')
     or has_table_privilege('authenticated', 'public.portal_email_outbox', 'INSERT') then
    raise exception 'portal_email_outbox must be invisible to anon and authenticated';
  end if;
  foreach f in array array[
    'public.claim_portal_emails(integer)',
    'public.mark_portal_email(uuid, text, text)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must not execute %', f; end if;
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'service_role should execute %', f; end if;
  end loop;
end $$;

-- Shape rules.
do $$ begin
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, portal_user_id, dedupe_key)
    values ('00000000-0000-0000-0000-000000001046', 'bogus', 'a046b000-0000-0000-0000-000000000001', 't46:bad1')$q$, 'portal_email_outbox_kind_check');
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, recipient_user_id, dedupe_key)
    values ('00000000-0000-0000-0000-000000001046', 'partner_received', 'a0460000-0000-0000-0000-000000000002', 't46:bad2')$q$, 'portal_email_outbox_recipient_check');
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, dedupe_key)
    values ('00000000-0000-0000-0000-000000001046', 'partner_received', 'a046f000-0000-0000-0000-000000000001', 'a046b000-0000-0000-0000-000000000001', 't46:e1')$q$, 'portal_email_outbox_dedupe_key_key');
  perform _t_raises($q$insert into portal_email_outbox (org_id, kind, portal_user_id, dedupe_key)
    values ('00000000-0000-0000-0000-000000001046', 'partner_received', 'a046b000-0000-0000-0000-000000000001', 't46:bad3')$q$, 'portal_email_outbox_recipient_check');
end $$;

-- Claim: E1 and E3 come back with their current address; E2 and E4 are dropped.
do $$ declare got text[]; n int; r record; begin
  select array_agg(c.id::text || '=' || c.recipient || '#' || c.attempts order by c.id) into got
    from public.claim_portal_emails(50) c;
  if got <> array[
    'a046e000-0000-0000-0000-000000000001=jane@outbox.example#1',
    'a046e000-0000-0000-0000-000000000003=rita@outbox.example#1'] then
    raise exception 'first claim should return E1 and E3 with attempts 1, got %', got;
  end if;
  select * into r from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000002';
  if r.dropped_at is null or r.last_error is distinct from 'recipient_inactive' or r.attempts <> 0 then
    raise exception 'a suspended partner''s row should be dropped untouched: %', row_to_json(r);
  end if;
  select * into r from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000004';
  if r.dropped_at is null or r.last_error is distinct from 'recipient_inactive' then
    raise exception 'a deactivated rep''s row should be dropped: %', row_to_json(r);
  end if;
  if (select last_attempt_at from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000001') is null then
    raise exception 'a claimed row should record last_attempt_at';
  end if;

  -- Every other rejection: dropped as recipient_inactive and never returned (the
  -- exact-equality check above already proves none of them came back).
  if (select count(*) from portal_email_outbox
       where dedupe_key like 't46:rej\_%' and dropped_at is not null
         and last_error = 'recipient_inactive' and sent_at is null and attempts = 0) <> 9 then
    raise exception 'all 9 unreachable-recipient rows should be dropped as recipient_inactive: %',
      (select json_agg(json_build_object('k', dedupe_key, 'd', dropped_at, 'e', last_error)) from portal_email_outbox where dedupe_key like 't46:rej\_%');
  end if;

  -- Immediately again: everything claimable is inside its backoff.
  select count(*) into n from public.claim_portal_emails(50);
  if n <> 0 then raise exception 'an immediate second claim must return nothing, got %', n; end if;
end $$;

-- Backoff passes: E1 comes back with attempts 2. E5 (attempts 5) and E6 (sent) never do.
do $$ declare got text[]; begin
  update portal_email_outbox set last_attempt_at = now() - interval '10 minutes'
   where id in ('a046e000-0000-0000-0000-000000000001', 'a046e000-0000-0000-0000-000000000005');
  update portal_email_outbox set last_attempt_at = now() - interval '10 minutes'
   where id = 'a046e000-0000-0000-0000-000000000003';
  perform public.mark_portal_email('a046e000-0000-0000-0000-000000000003', 'sent', null);
  select array_agg(c.id::text || '#' || c.attempts order by c.id) into got from public.claim_portal_emails(50) c;
  if got <> array['a046e000-0000-0000-0000-000000000001#2'] then
    raise exception 'after the backoff only E1 should come back, got %', got;
  end if;
  if (select sent_at from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000003') is null then
    raise exception 'mark sent should stamp sent_at';
  end if;
end $$;

-- Failures: last_error always; failed_at only from the fifth attempt.
do $$ declare r record; begin
  perform public.mark_portal_email('a046e000-0000-0000-0000-000000000001', 'failed', 'boom');
  select * into r from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000001';
  if r.last_error is distinct from 'boom' or r.failed_at is not null then
    raise exception 'a failure before attempt 5 keeps the row retryable: %', row_to_json(r);
  end if;
  update portal_email_outbox set attempts = 5 where id = 'a046e000-0000-0000-0000-000000000001';
  perform public.mark_portal_email('a046e000-0000-0000-0000-000000000001', 'failed', '   ');
  select * into r from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000001';
  if r.failed_at is null or r.last_error is distinct from 'send_failed' then
    raise exception 'the fifth failure should give up with the default error: %', row_to_json(r);
  end if;
  -- A settled row does not change again.
  perform public.mark_portal_email('a046e000-0000-0000-0000-000000000001', 'sent', null);
  if (select sent_at from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000001') is not null then
    raise exception 'a failed row must not flip to sent';
  end if;
  perform _t_raises($q$select public.mark_portal_email('a046e000-0000-0000-0000-000000000001', 'maybe', null)$q$, 'invalid_outcome');
end $$;

-- Dropped by the drain (email guard), and the batch limit.
do $$ declare n int; r record; begin
  insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
  select '00000000-0000-0000-0000-000000001046', 'internal_nudge', 'a0460000-0000-0000-0000-000000000002', '{"count":1}', 't46:batch' || g
    from generate_series(1, 3) g;
  select count(*) into n from public.claim_portal_emails(2);
  if n <> 2 then raise exception 'p_limit should cap the batch, got %', n; end if;
  select count(*) into n from public.claim_portal_emails(0);
  if n <> 1 then raise exception 'a limit below 1 is clamped to 1, got %', n; end if;

  perform public.mark_portal_email((select id from portal_email_outbox where dedupe_key = 't46:batch1'), 'dropped', 'email_guard');
  select * into r from portal_email_outbox where dedupe_key = 't46:batch1';
  if r.dropped_at is null or r.last_error is distinct from 'email_guard' then
    raise exception 'mark dropped should stamp dropped_at with the reason: %', row_to_json(r);
  end if;
end $$;

-- C3: an unsettled row older than 48 hours is dropped as stale, never sent.
-- C4: an unsettled row that already used all 5 attempts is failed by the sweep.
do $$ declare got uuid[]; r record; begin
  insert into portal_email_outbox (id, org_id, kind, recipient_user_id, payload, dedupe_key, created_at) values
    ('a046e000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000001046', 'internal_nudge', 'a0460000-0000-0000-0000-000000000002', '{"count":1}', 't46:stale49', now() - interval '49 hours'),
    ('a046e000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000001046', 'internal_nudge', 'a0460000-0000-0000-0000-000000000002', '{"count":1}', 't46:stale47', now() - interval '47 hours');
  insert into portal_email_outbox (id, org_id, kind, recipient_user_id, payload, dedupe_key, attempts) values
    ('a046e000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000001046', 'internal_nudge', 'a0460000-0000-0000-0000-000000000002', '{"count":1}', 't46:maxed', 5),
    ('a046e000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000001046', 'internal_nudge', 'a0460000-0000-0000-0000-000000000002', '{"count":1}', 't46:inflight', 5),
    ('a046e000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000001046', 'internal_nudge', 'a0460000-0000-0000-0000-000000000002', '{"count":1}', 't46:leaseover', 5);
  update portal_email_outbox set last_attempt_at = now() where id = 'a046e000-0000-0000-0000-0000000000a4';
  update portal_email_outbox set last_attempt_at = now() - interval '11 minutes' where id = 'a046e000-0000-0000-0000-0000000000a5';
  select array_agg(c.id) into got from public.claim_portal_emails(50) c;
  if not ('a046e000-0000-0000-0000-0000000000a2'::uuid = any(coalesce(got, '{}'))) then
    raise exception 'a 47 hour old row should still be claimed, got %', got;
  end if;
  if 'a046e000-0000-0000-0000-0000000000a1'::uuid = any(coalesce(got, '{}'))
     or 'a046e000-0000-0000-0000-0000000000a3'::uuid = any(coalesce(got, '{}'))
     or 'a046e000-0000-0000-0000-000000000005'::uuid = any(coalesce(got, '{}')) then
    raise exception 'stale or exhausted rows must not be claimed, got %', got;
  end if;
  select * into r from portal_email_outbox where id = 'a046e000-0000-0000-0000-0000000000a1';
  if r.dropped_at is null or r.last_error is distinct from 'stale' or r.sent_at is not null or r.attempts <> 0 then
    raise exception 'a 49 hour old row should be dropped as stale: %', row_to_json(r);
  end if;
  select * into r from portal_email_outbox where id = 'a046e000-0000-0000-0000-0000000000a3';
  if r.failed_at is null or r.dropped_at is not null then
    raise exception 'an exhausted row should be failed by the sweep: %', row_to_json(r);
  end if;
  if (select failed_at from portal_email_outbox where id = 'a046e000-0000-0000-0000-0000000000a4') is not null then
    raise exception 'a fifth attempt still inside its 10 minute lease must not be failed under it';
  end if;
  if (select failed_at from portal_email_outbox where id = 'a046e000-0000-0000-0000-0000000000a5') is null then
    raise exception 'a fifth attempt past its lease should be failed by the sweep';
  end if;
  select * into r from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000005';
  if r.failed_at is null then
    raise exception 'the fixture row at 5 attempts should be failed by the sweep: %', row_to_json(r);
  end if;
  if (select sent_at from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000006') is null
     or (select failed_at from portal_email_outbox where id = 'a046e000-0000-0000-0000-000000000006') is not null then
    raise exception 'a sent row must be left alone by the sweep';
  end if;
end $$;

-- C1: the batch size is capped server side at 50.
do $$ declare n int; begin
  insert into portal_email_outbox (org_id, kind, recipient_user_id, payload, dedupe_key)
  select '00000000-0000-0000-0000-000000001046', 'internal_nudge', 'a0460000-0000-0000-0000-000000000002', '{"count":1}', 't46:cap' || g
    from generate_series(1, 60) g;
  select count(*) into n from public.claim_portal_emails(1000);
  if n <> 50 then raise exception 'a huge p_limit should be capped at 50, got %', n; end if;
end $$;

rollback;
