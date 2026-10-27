-- Tests for 20261028000001_portal_stats_close_date (FR-PORT-70, Q7).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/069_portal_stats_close_date.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only function).
--
-- Closed Won and its value count by the day the deal closed; Submitted and
-- the rest still count by the day the referral was sent.
--   W1 sent 13 months ago, deal closed 20 days ago, $7,000
--   W2 sent 10 days ago,   deal closed 5 days ago,  $3,000
--   W3 sent 10 days ago, deal closed 5 days ago, then reopened (status
--      working, closed_won_at left set), must never count as won
--   S1 sent 2 days ago, still submitted

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, partner_value_visibility) values
  ('00000000-0000-0000-0000-000000001069', 'Close Org', 'portal-close', 'portal-close-a1', true, true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0690000-0000-0000-0000-000000000001', 'rita@close.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('a0690000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001069', 'admin', 'administrator', 'Rita', 'rita@close.example', 'cl'::ltree);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a069a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001069', 'a0690000-0000-0000-0000-000000000001', 'a0690000-0000-0000-0000-000000000001', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@close.example');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a069d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001069', 'a0690000-0000-0000-0000-000000000001', 'Old Won Co',  '1 A St', 'W', 'w1@close.example', '5550690001', 700000, 'won', 'partner_referral'),
  ('a069d000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001069', 'a0690000-0000-0000-0000-000000000001', 'New Won Co',  '2 A St', 'W', 'w2@close.example', '5550690002', 300000, 'won', 'partner_referral'),
  ('a069d000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001069', 'a0690000-0000-0000-0000-000000000001', 'Reopened Co', '3 A St', 'W', 'w3@close.example', '5550690003', 900000, 'won', 'partner_referral');

-- The trigger stamps closed_won_at on insert; set the fixture dates directly.
update deals set closed_won_at = now() - interval '20 days' where id = 'a069d000-0000-0000-0000-000000000001';
update deals set closed_won_at = now() - interval '5 days'  where id = 'a069d000-0000-0000-0000-000000000002';
update deals set closed_won_at = now() - interval '5 days'  where id = 'a069d000-0000-0000-0000-000000000003';

insert into referrals (
  id, org_id, partner_id, direction, source, status, company_name, deal_id, assigned_user_id, submitted_at
) values
  ('a069f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001069', 'a069a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'won',       'Old Won Co',  'a069d000-0000-0000-0000-000000000001', 'a0690000-0000-0000-0000-000000000001', now() - interval '13 months'),
  ('a069f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001069', 'a069a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'won',       'New Won Co',  'a069d000-0000-0000-0000-000000000002', 'a0690000-0000-0000-0000-000000000001', now() - interval '10 days'),
  ('a069f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001069', 'a069a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'working',   'Reopened Co', 'a069d000-0000-0000-0000-000000000003', 'a0690000-0000-0000-0000-000000000001', now() - interval '10 days'),
  ('a069f000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001069', 'a069a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered', 'submitted', 'Fresh Co',    null,                                   'a0690000-0000-0000-0000-000000000001', now() - interval '2 days');

do $$ declare s record; begin
  -- 12 months: the 13-month-old referral closed 20 days ago, so it counts.
  select * into s from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001069', 'a069a000-0000-0000-0000-000000000001', now() - interval '12 months');
  if s.closed_won <> 2 or s.won_value_cents <> 1000000 then
    raise exception 'closed won must count by close date: %', row_to_json(s);
  end if;
  if s.won_sent <> 1 then raise exception 'won_sent counts by sent date: %', row_to_json(s); end if;
  if s.submitted <> 3 then raise exception 'submitted still counts by sent date: %', row_to_json(s); end if;

  -- 30 days: both closes are inside, only W2 was also sent inside.
  select * into s from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001069', 'a069a000-0000-0000-0000-000000000001', now() - interval '30 days');
  if s.closed_won <> 2 or s.won_value_cents <> 1000000 or s.won_sent <> 1 then
    raise exception '30-day stats wrong: %', row_to_json(s);
  end if;

  -- 10 days: W1 closed 20 days ago, so it drops out.
  select * into s from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001069', 'a069a000-0000-0000-0000-000000000001', now() - interval '10 days');
  if s.closed_won <> 1 or s.won_value_cents <> 300000 then
    raise exception 'a close outside the window must not count: %', row_to_json(s);
  end if;

  -- All time: every won referral counts, the reopened one still does not.
  select * into s from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001069', 'a069a000-0000-0000-0000-000000000001', null);
  if s.closed_won <> 2 or s.won_sent <> 2 or s.won_value_cents <> 1000000 then
    raise exception 'all-time stats wrong: %', row_to_json(s);
  end if;
end $$;

rollback;
