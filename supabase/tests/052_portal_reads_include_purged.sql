-- Tests for 20261016000003_portal_reads_include_purged (Partner Portal Phase 2A).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/052_portal_reads_include_purged.sql
-- Self-cleans via ROLLBACK. Runs as postgres (service-role-only functions).
--
-- Fixture, org A portal-keep (closed-won value shown): rita rep owns P1 and P2.
--   K1 P1 portal declined  Purged Co     120 days ago, purged 5 days ago
--   K2 P1 rep    won       Won Co         40 days ago, deal DW worth $5,000
--   K3 P1 portal submitted Fresh Bakery    2 days ago
--   K4 P1 portal accepted  Ghost Co        3 days ago, purged (artificially, to
--                                          prove duplicate matching skips it)
--   K5 P2 portal submitted Other Partner Co
-- Org B portal-keep-b: PB with KB.

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled, partner_value_visibility) values
  ('00000000-0000-0000-0000-000000001052', 'Keep Org',   'portal-keep',   'portal-keep-a1',   true, true),
  ('00000000-0000-0000-0000-000000001152', 'Keep Org B', 'portal-keep-b', 'portal-keep-b-a1', true, false);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0520000-0000-0000-0000-000000000001', 'boss@keep.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0520000-0000-0000-0000-000000000002', 'rita@keep.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0520000-0000-0000-0000-000000000003', 'bob@keepb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0520000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001052', 'admin', 'administrator',      'Boss',     'boss@keep.example', 'kpboss'::ltree,      null),
  ('a0520000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001052', 'rep',   'sales_professional', 'Rita Rep', 'rita@keep.example', 'kpboss.rita'::ltree, 'a0520000-0000-0000-0000-000000000001'),
  ('a0520000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001152', 'admin', 'administrator',      'Bob',      'bob@keepb.example', 'kpbob'::ltree,       null);

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('a052a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001052', 'a0520000-0000-0000-0000-000000000002', 'a0520000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa', 'jane@keep.example'),
  ('a052a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001052', 'a0520000-0000-0000-0000-000000000002', 'a0520000-0000-0000-0000-000000000002', 'Kim CPA',  'Kim & Co',  'cpa', 'kim@keep.example'),
  ('a052a000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001152', 'a0520000-0000-0000-0000-000000000003', 'a0520000-0000-0000-0000-000000000003', 'Bea CPA',  'Bea & Co',  'cpa', 'bea@keepb.example');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a052b000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'jane@keep.example', 'active'),
  ('a052b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000002', 'kim@keep.example',  'active'),
  ('a052b000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001152', 'a052a000-0000-0000-0000-000000000003', 'bea@keepb.example', 'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a052d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001052', 'a0520000-0000-0000-0000-000000000002', 'Won Co', '9 Gold St', 'Wes', 'wes@won.example', '5550520002', 500000, 'won', 'partner_referral');

insert into referrals (
  id, org_id, partner_id, direction, source, status, company_name, contact_name, contact_phone,
  address, industry, urgency, notes, decline_reason, deal_id, assigned_user_id,
  submitted_by_portal_user_id, submitted_at, purged_at
) values
  ('a052f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'declined',  'Purged Co',        null,  null,         null,       'retail', 'no_rush', '', 'outside_icp', null,                                   'a0520000-0000-0000-0000-000000000002', 'a052b000-0000-0000-0000-000000000001', now() - interval '120 days', now() - interval '5 days'),
  ('a052f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'inbound', 'rep_entered',      'won',       'Won Co',           'Wes', '5550520002', '9 Gold St', null,     null,      '', null,          'a052d000-0000-0000-0000-000000000001', 'a0520000-0000-0000-0000-000000000002', null,                                   now() - interval '40 days',  null),
  ('a052f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'submitted', 'Fresh Bakery',     'Ann', '5550520003', '5 Oak St',  null,     null,      '', null,          null,                                   'a0520000-0000-0000-0000-000000000002', 'a052b000-0000-0000-0000-000000000001', now() - interval '2 days',   null),
  ('a052f000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'inbound', 'portal_signed_in', 'accepted',  'Ghost Co',         'Gil', '5550520004', null,        null,     null,      '', null,          null,                                   'a0520000-0000-0000-0000-000000000002', 'a052b000-0000-0000-0000-000000000001', now() - interval '3 days',   now()),
  ('a052f000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000002', 'inbound', 'portal_signed_in', 'submitted', 'Other Partner Co', 'Oz',  '5550520005', null,        null,     null,      '', null,          null,                                   'a0520000-0000-0000-0000-000000000002', 'a052b000-0000-0000-0000-000000000002', now() - interval '1 day',    null),
  ('a052f000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001152', 'a052a000-0000-0000-0000-000000000003', 'inbound', 'portal_signed_in', 'submitted', 'Tenant B Co',      'Bo',  '5550520006', null,        null,     null,      '', null,          null,                                   'a0520000-0000-0000-0000-000000000003', 'a052b000-0000-0000-0000-000000000003', now() - interval '1 day',    null);

update referral_status_history h
   set created_at = r.submitted_at
  from referrals r
 where r.id = h.referral_id
   and r.org_id in ('00000000-0000-0000-0000-000000001052', '00000000-0000-0000-0000-000000001152');

-- 1. Privileges.
do $$ begin
  if has_function_privilege('authenticated', 'public.portal_export_referrals(uuid, uuid, timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_export_referrals(uuid, uuid, timestamptz)', 'EXECUTE') then
    raise exception 'portal_export_referrals must be service role only';
  end if;
  if not has_function_privilege('service_role', 'public.portal_export_referrals(uuid, uuid, timestamptz)', 'EXECUTE') then
    raise exception 'service_role should execute portal_export_referrals';
  end if;
  if has_function_privilege('authenticated', 'public.portal_get_referral(uuid, uuid, uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.portal_get_referral(uuid, uuid, uuid, uuid, text)', 'EXECUTE') then
    raise exception 'the recreated portal_get_referral must stay service role only';
  end if;
  if not has_function_privilege('service_role', 'public.portal_get_referral(uuid, uuid, uuid, uuid, text)', 'EXECUTE') then
    raise exception 'service_role should execute portal_get_referral';
  end if;
end $$;

-- 2. The list, history and tiles include the purged referral.
do $$ declare n int; s record; begin
  select count(*) into n from public.portal_list_referrals('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', null);
  if n <> 4 then raise exception 'P1 list should have 4 rows (purged included), got %', n; end if;
  if not exists (select 1 from public.portal_list_referrals('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', null) l
                  where l.id = 'a052f000-0000-0000-0000-000000000001') then
    raise exception 'the purged referral must stay in the list';
  end if;
  select count(*) into n from public.portal_referral_history('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'a052f000-0000-0000-0000-000000000001');
  if n <> 1 then raise exception 'the purged referral keeps its history, got % rows', n; end if;

  select * into s from public.portal_dashboard_stats('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', null);
  if s.submitted <> 4 or s.active <> 2 or s.closed_won <> 1 or s.not_moving_forward <> 1
     or s.won_value_cents <> 500000 or not s.value_visible then
    raise exception 'tiles should count the purged referral: %', row_to_json(s);
  end if;
end $$;

-- 3. Detail of a purged referral: no personal details, and it says so.
do $$ declare d record; begin
  select * into d from public.portal_get_referral('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'a052b000-0000-0000-0000-000000000001', 'a052f000-0000-0000-0000-000000000001', null);
  if d.id is null then raise exception 'the purged referral detail must be returned'; end if;
  if not d.details_removed or d.contact_name is not null or d.contact_phone is not null
     or d.address is not null or d.notes is not null or d.can_withdraw then
    raise exception 'purged detail wrong: %', row_to_json(d);
  end if;
  if d.company_name <> 'Purged Co' or d.industry <> 'retail' or d.urgency <> 'no_rush' then
    raise exception 'purged detail keeps company, industry and urgency: %', row_to_json(d);
  end if;

  -- K4 is marked purged but its row still holds personal details, so the
  -- gating is on purged_at, not on the columns already being empty.
  if not exists (select 1 from referrals where id = 'a052f000-0000-0000-0000-000000000004'
                  and contact_name = 'Gil' and contact_phone = '5550520004') then
    raise exception 'fixture: K4 must still hold personal details';
  end if;
  select * into d from public.portal_get_referral('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'a052b000-0000-0000-0000-000000000001', 'a052f000-0000-0000-0000-000000000004', null);
  if d.id is null then raise exception 'K4 detail must be returned'; end if;
  if d.details_removed is not true then
    raise exception 'a purged portal referral must say its details were removed: %', row_to_json(d);
  end if;
  if d.contact_name is not null or d.contact_phone is not null or d.address is not null
     or d.notes is not null or d.can_withdraw then
    raise exception 'a purged referral must return no personal details even if the row still has them: %', row_to_json(d);
  end if;
  if d.company_name <> 'Ghost Co' then raise exception 'K4 keeps its company name: %', row_to_json(d); end if;

  select * into d from public.portal_get_referral('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'a052b000-0000-0000-0000-000000000001', 'a052f000-0000-0000-0000-000000000003', null);
  if d.details_removed or d.contact_name is distinct from 'Ann' or not d.can_withdraw then
    raise exception 'a live referral detail is unchanged: %', row_to_json(d);
  end if;

  select * into d from public.portal_get_referral('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000002', 'a052b000-0000-0000-0000-000000000002', 'a052f000-0000-0000-0000-000000000001', null);
  if d.id is not null then raise exception 'another partner must not get the purged referral'; end if;
end $$;

-- 4. Duplicate matching skips purged referrals.
do $$ declare v uuid; begin
  select f.dup_referral_id into v
    from public._portal_find_duplicates('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'Ghost Co', '5550520004', null, null) f;
  if v is not null then raise exception 'a purged referral must never take credit, got %', v; end if;
  select f.dup_referral_id into v
    from public._portal_find_duplicates('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', 'Fresh Bakery', '5550520003', null, null) f;
  if v is distinct from 'a052f000-0000-0000-0000-000000000003' then raise exception 'live matching must still work, got %', v; end if;
end $$;

-- 5. Export rows: newest first, value only on won rows while the ISO shows values.
do $$ declare names text[]; vals bigint[]; vis boolean[]; anyvis boolean; n int; begin
  select array_agg(e.company_name order by e.ord), array_agg(coalesce(e.won_value_cents, -1) order by e.ord), array_agg(e.value_visible order by e.ord)
    into names, vals, vis
    from public.portal_export_referrals('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', null)
         with ordinality as e(ref, company_name, status, submitted_at, last_activity_at, won_value_cents, value_visible, ord);
  if names <> array['Fresh Bakery', 'Ghost Co', 'Won Co', 'Purged Co'] then raise exception 'export order wrong: %', names; end if;
  if vals <> array[-1, -1, 500000, -1]::bigint[] then raise exception 'export value wrong: %', vals; end if;
  if vis <> array[true, true, true, true] then raise exception 'value_visible should be on: %', vis; end if;

  update organizations set partner_value_visibility = false where id = '00000000-0000-0000-0000-000000001052';
  select array_agg(coalesce(e.won_value_cents, -1)), bool_or(e.value_visible) into vals, anyvis
    from public.portal_export_referrals('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', null) e;
  if vals <> array[-1, -1, -1, -1]::bigint[] or anyvis then raise exception 'no value when the ISO hides it: %', vals; end if;

  select count(*) into n from public.portal_export_referrals('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', now() - interval '30 days');
  if n <> 2 then raise exception 'the window applies to the export, got %', n; end if;
  select count(*) into n from public.portal_export_referrals('00000000-0000-0000-0000-000000001152', 'a052a000-0000-0000-0000-000000000001', null);
  if n <> 0 then raise exception 'another org scope must export nothing'; end if;
  update organizations set portal_enabled = false where id = '00000000-0000-0000-0000-000000001052';
  select count(*) into n from public.portal_export_referrals('00000000-0000-0000-0000-000000001052', 'a052a000-0000-0000-0000-000000000001', null);
  if n <> 0 then raise exception 'a disabled portal exports nothing'; end if;
  update organizations set portal_enabled = true where id = '00000000-0000-0000-0000-000000001052';
end $$;

-- 6. The email claim drops a partner email about a purged referral.
do $$ declare o record; begin
  insert into portal_email_outbox (org_id, kind, referral_id, portal_user_id, payload, dedupe_key) values
    ('00000000-0000-0000-0000-000000001052', 'partner_accepted', 'a052f000-0000-0000-0000-000000000001', 'a052b000-0000-0000-0000-000000000001', '{}', 't52:purged'),
    ('00000000-0000-0000-0000-000000001052', 'partner_accepted', 'a052f000-0000-0000-0000-000000000003', 'a052b000-0000-0000-0000-000000000001', '{}', 't52:live');
  perform * from public.claim_portal_emails(50);
  select * into o from portal_email_outbox where dedupe_key = 't52:purged';
  if o.dropped_at is null or o.last_error is distinct from 'recipient_inactive' then
    raise exception 'a purged referral email must be dropped: %', row_to_json(o);
  end if;
  select * into o from portal_email_outbox where dedupe_key = 't52:live';
  if o.dropped_at is not null or o.attempts <> 1 then
    raise exception 'a live referral email must be claimed: %', row_to_json(o);
  end if;
end $$;

rollback;
