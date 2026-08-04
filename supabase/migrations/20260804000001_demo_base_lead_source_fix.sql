-- Fix: the demo base fixture (reset_demo_data_base) still inserted the OLD
-- free-text lead sources ('Referral','Cold','Website','Partner','Event'), which
-- the LS-1 canonical constraint deals_lead_source_check (added 20260730000001)
-- now rejects. The full Reset button runs the base first, so the insert threw
-- "new row for relation deals violates check constraint deals_lead_source_check"
-- and rolled the whole reset back. Re-create reset_demo_data_base with the 18
-- fixture lead sources mapped to canonical values. (_seed_demo_extra still
-- re-randomizes these afterward; this only makes the base insert itself valid.)
-- Generated from the deployed 20260722 body with the 5 literals remapped.

create or replace function reset_demo_data_base()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id  uuid;
  v_role    user_role;
  v_owner   uuid := auth.uid();
begin
  -- Gate
  if v_owner is null then
    raise exception 'not_authenticated';
  end if;
  select p.org_id, p.role into v_org_id, v_role from profiles p where p.id = v_owner;
  if v_role <> 'admin' then
    raise exception 'not_authorized';
  end if;
  if not exists (
    select 1 from org_features
    where org_id = v_org_id and feature_key = 'demo_reset' and enabled
  ) then
    raise exception 'demo_reset_not_enabled';
  end if;

  -- Triggers off for this txn: we set every column (incl. Activity-to-Win
  -- snapshot cols + stage history) explicitly in the reseed (later task), and
  -- we delete child tables by hand. SET LOCAL auto-reverts at commit.
  -- NOTE: in replica mode ON DELETE CASCADE does NOT fire, so deletes MUST be
  -- child-first and explicit.
  set local session_replication_role = replica;

  -- Wipe (child-first; only this org)
  -- coverage_signal references deals(id) on delete cascade; that cascade
  -- does not fire in replica mode, so it must be cleared before deals.
  delete from coverage_signal        where org_id = v_org_id;
  delete from activities              where org_id = v_org_id;
  delete from deal_stage_history      where org_id = v_org_id;
  delete from partner_deals           where org_id = v_org_id;
  delete from scheduled_appointments  where org_id = v_org_id;
  delete from deal_notes              where org_id = v_org_id;
  delete from deal_files              where org_id = v_org_id;
  delete from deal_contacts           where org_id = v_org_id;
  delete from partner_activities      where org_id = v_org_id;
  delete from partner_notes           where org_id = v_org_id;
  delete from path_stops              where path_id in (select id from paths where user_id = v_owner);
  delete from deals                   where org_id = v_org_id;
  delete from partners                where org_id = v_org_id;
  delete from paths                   where user_id = v_owner;
  -- NOTE: `prospects` intentionally NOT wiped here — it is a platform-shared
  -- geospatial cache (see 20260531000001_path_prospect_store.sql), not
  -- org-scoped data. It has no org_id column and is shared read-only across
  -- every tenant, so it is out of scope for a single-org demo reset.

  -- Reseed: curated demo fixture (18 deals across the funnel, matching
  -- activities, stage history, partners + attributions, and two upcoming
  -- appointments). Every column is set explicitly below because triggers
  -- are OFF for this transaction (session_replication_role = replica) --
  -- nothing else will backfill denormalized/snapshot columns.
  --
  -- Deal ids a0000000-...-000000000001 .. 18 map 1:1 to the company list
  -- below (3 new, 3 contacted, 2 qualified, 1 proposal, 6 won, 3 lost).
  -- Partner ids b0000000-...-000000000001..3.

  -- ── 1. Deals ──
  insert into deals (
    id, org_id, owner_id, company_name, address, industry, employee_count_range,
    contact_name, contact_title, contact_email, contact_phone,
    value_cents, stage, probability, expected_close, lead_source, notes,
    last_activity_at, next_followup_at, created_at, updated_at,
    closed_won_at, first_activity_at, first_call_at, first_email_at, first_dropin_at, first_appointment_at,
    activity_count_total, activity_count_call, activity_count_email, activity_count_dropin, activity_count_appointment,
    time_to_win_business_days, time_to_win_calendar_days,
    closed_lost_at, time_to_lost_business_days, time_to_lost_calendar_days,
    lost_reason_category, lost_reason_notes
  ) values
  -- Deal 1: new
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000001')::uuid, v_org_id, v_owner, 'Riverside Diner', '214 Elm St, Fairhaven', 'Restaurant', '11-50',
    'Marco Diaz', 'Owner', 'marco@riversidediner.example.com', '+14155550101',
    15_000_00, 'new', 20, current_date + 45, 'customer_referral', null,
    now() - interval '3 days', now() + interval '2 days', now() - interval '5 days', now() - interval '3 days',
    null, now() - interval '3 days', now() - interval '3 days', null, null, null,
    null, null, null, null, null,
    null, null,
    null, null, null,
    null, null),
  -- Deal 2: new
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000002')::uuid, v_org_id, v_owner, 'Bloom & Petal Florist', '88 Blossom Ave, Fairhaven', 'Retail/Floral', '1-10',
    'Carla Nguyen', 'Owner', 'carla@bloomandpetal.example.com', '+14155550102',
    8_500_00, 'new', 20, current_date + 40, 'self_sourced_canvass', null,
    now() - interval '6 days', now() + interval '4 days', now() - interval '8 days', now() - interval '6 days',
    null, now() - interval '6 days', null, now() - interval '6 days', null, null,
    null, null, null, null, null,
    null, null,
    null, null, null,
    null, null),
  -- Deal 3: new
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000003')::uuid, v_org_id, v_owner, 'Ace Hardware Downtown', '500 Main St, Fairhaven', 'Retail/Hardware', '11-50',
    'Tom Reilly', 'Store Manager', 'tom.reilly@acehardwaredt.example.com', '+14155550103',
    32_000_00, 'new', 20, current_date + 35, 'inbound', null,
    now() - interval '4 days', now() + interval '7 days', now() - interval '12 days', now() - interval '4 days',
    null, now() - interval '10 days', now() - interval '10 days', null, now() - interval '4 days', null,
    null, null, null, null, null,
    null, null,
    null, null, null,
    null, null),
  -- Deal 4: contacted
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000004')::uuid, v_org_id, v_owner, 'Sunrise Yoga Studio', '12 Sunrise Blvd, Cedar Ridge', 'Health & Wellness', '1-10',
    'Priya Shah', 'Owner', 'priya@sunriseyoga.example.com', '+14155550104',
    22_000_00, 'contacted', 40, current_date + 30, 'partner_referral', null,
    now() - interval '5 days', now() + interval '1 day', now() - interval '14 days', now() - interval '5 days',
    null, now() - interval '12 days', now() - interval '12 days', now() - interval '5 days', null, null,
    null, null, null, null, null,
    null, null,
    null, null, null,
    null, null),
  -- Deal 5: contacted
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000005')::uuid, v_org_id, v_owner, 'Metro Auto Repair', '900 Industrial Pkwy, Cedar Ridge', 'Automotive', '11-50',
    'Dave Kowalski', 'Owner', 'dave@metroautorepair.example.com', '+14155550105',
    48_000_00, 'contacted', 40, current_date + 25, 'event_association', null,
    now() - interval '4 days', now() + interval '3 days', now() - interval '22 days', now() - interval '4 days',
    null, now() - interval '20 days', now() - interval '20 days', now() - interval '12 days', now() - interval '4 days', null,
    null, null, null, null, null,
    null, null,
    null, null, null,
    null, null),
  -- Deal 6: contacted
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000006')::uuid, v_org_id, v_owner, 'The Corner Bakery', '45 Baker St, Fairhaven', 'Food & Beverage', '1-10',
    'Lena Ortiz', 'Owner', 'lena@thecornerbakery.example.com', '+14155550106',
    12_000_00, 'contacted', 40, current_date + 35, 'customer_referral', null,
    now() - interval '6 days', now() + interval '10 days', now() - interval '17 days', now() - interval '6 days',
    null, now() - interval '15 days', now() - interval '6 days', now() - interval '15 days', null, null,
    null, null, null, null, null,
    null, null,
    null, null, null,
    null, null),
  -- Deal 7: qualified
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000007')::uuid, v_org_id, v_owner, 'Lakeside Dental Group', '300 Lakeside Dr, Cedar Ridge', 'Healthcare/Dental', '11-50',
    'Dr. Susan Whitfield', 'Practice Manager', 'susan@lakesidedental.example.com', '+14155550107',
    95_000_00, 'qualified', 60, current_date + 18, 'self_sourced_canvass', null,
    now() - interval '5 days', now() + interval '2 days', now() - interval '27 days', now() - interval '5 days',
    null, now() - interval '25 days', now() - interval '25 days', now() - interval '5 days', null, now() - interval '14 days',
    null, null, null, null, null,
    null, null,
    null, null, null,
    null, null),
  -- Deal 8: qualified
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000008')::uuid, v_org_id, v_owner, 'Pinnacle Fitness Center', '77 Summit Rd, Cedar Ridge', 'Health & Wellness', '51-200',
    'Marcus Bell', 'General Manager', 'marcus@pinnaclefitness.example.com', '+14155550108',
    61_000_00, 'qualified', 60, current_date + 14, 'inbound', null,
    now() - interval '3 days', now() + interval '5 days', now() - interval '32 days', now() - interval '3 days',
    null, now() - interval '30 days', now() - interval '30 days', now() - interval '20 days', now() - interval '10 days', null,
    null, null, null, null, null,
    null, null,
    null, null, null,
    null, null),
  -- Deal 9: proposal
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000009')::uuid, v_org_id, v_owner, 'Harbor View Realty', '150 Harbor View Way, Fairhaven', 'Real Estate', '11-50',
    'Angela Kim', 'Managing Broker', 'angela@harborviewrealty.example.com', '+14155550109',
    140_000_00, 'proposal', 80, current_date + 7, 'partner_referral', null,
    now() - interval '2 days', now() + interval '1 day', now() - interval '37 days', now() - interval '2 days',
    null, now() - interval '35 days', now() - interval '35 days', now() - interval '22 days', null, now() - interval '12 days',
    null, null, null, null, null,
    null, null,
    null, null, null,
    null, null),
  -- Deal 10: won (closed 5 days ago)
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000010')::uuid, v_org_id, v_owner, 'Golden Gate Cafe', '22 Bay St, Fairhaven', 'Food & Beverage', '1-10',
    'Nina Alvarez', 'Owner', 'nina@goldengatecafe.example.com', '+14155550110',
    27_500_00, 'won', 100, (now() - interval '5 days')::date, 'event_association', null,
    now() - interval '6 days', null, now() - interval '26 days', now() - interval '5 days',
    now() - interval '5 days', now() - interval '23 days', now() - interval '23 days', now() - interval '18 days', now() - interval '9 days', null,
    5, 2, 2, 1, 0,
    13, 18,
    null, null, null,
    null, null),
  -- Deal 11: won (closed 12 days ago)
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, v_org_id, v_owner, 'Summit Legal Services', '400 Court St, Cedar Ridge', 'Professional Services/Legal', '11-50',
    'Robert Hayes', 'Managing Partner', 'robert@summitlegal.example.com', '+14155550111',
    88_000_00, 'won', 100, (now() - interval '12 days')::date, 'customer_referral', null,
    now() - interval '13 days', null, now() - interval '36 days', now() - interval '12 days',
    now() - interval '12 days', now() - interval '33 days', now() - interval '33 days', now() - interval '28 days', now() - interval '18 days', now() - interval '15 days',
    6, 2, 2, 1, 1,
    15, 21,
    null, null, null,
    null, null),
  -- Deal 12: won (closed 22 days ago)
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000012')::uuid, v_org_id, v_owner, 'Cascade Coffee Roasters', '60 Roaster Ln, Fairhaven', 'Food & Beverage', '1-10',
    'Ingrid Larsen', 'Owner', 'ingrid@cascadecoffee.example.com', '+14155550112',
    19_000_00, 'won', 100, (now() - interval '22 days')::date, 'self_sourced_canvass', null,
    now() - interval '23 days', null, now() - interval '49 days', now() - interval '22 days',
    now() - interval '22 days', now() - interval '46 days', now() - interval '46 days', now() - interval '36 days', now() - interval '28 days', null,
    4, 1, 2, 1, 0,
    17, 24,
    null, null, null,
    null, null),
  -- Deal 13: won (closed 40 days ago)
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, v_org_id, v_owner, 'Maple Street Barbershop', '18 Maple St, Fairhaven', 'Personal Services', '1-10',
    'Jamal Carter', 'Owner', 'jamal@maplestreetbarber.example.com', '+14155550113',
    155_000_00, 'won', 100, (now() - interval '40 days')::date, 'inbound', null,
    now() - interval '42 days', null, now() - interval '71 days', now() - interval '40 days',
    now() - interval '40 days', now() - interval '68 days', now() - interval '68 days', now() - interval '61 days', now() - interval '49 days', now() - interval '45 days',
    8, 3, 3, 1, 1,
    20, 28,
    null, null, null,
    null, null),
  -- Deal 14: won (closed 60 days ago)
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000014')::uuid, v_org_id, v_owner, 'Northside Veterinary Clinic', '210 North Ave, Cedar Ridge', 'Healthcare/Veterinary', '11-50',
    'Dr. Emily Chan', 'Practice Owner', 'emily@northsidevet.example.com', '+14155550114',
    42_000_00, 'won', 100, (now() - interval '60 days')::date, 'partner_referral', null,
    now() - interval '62 days', null, now() - interval '82 days', now() - interval '60 days',
    now() - interval '60 days', now() - interval '79 days', now() - interval '79 days', now() - interval '75 days', now() - interval '71 days', now() - interval '66 days',
    5, 2, 1, 1, 1,
    14, 19,
    null, null, null,
    null, null),
  -- Deal 15: won (closed 85 days ago)
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, v_org_id, v_owner, 'Union Square Dry Cleaners', '5 Union Sq, Fairhaven', 'Retail Services', '1-10',
    'Grace Park', 'Owner', 'grace@unionsquaredc.example.com', '+14155550115',
    9_800_00, 'won', 100, (now() - interval '85 days')::date, 'event_association', null,
    now() - interval '87 days', null, now() - interval '113 days', now() - interval '85 days',
    now() - interval '85 days', now() - interval '110 days', now() - interval '110 days', now() - interval '106 days', now() - interval '98 days', null,
    7, 2, 3, 2, 0,
    18, 25,
    null, null, null,
    null, null),
  -- Deal 16: lost (closed 10 days ago, price)
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000016')::uuid, v_org_id, v_owner, 'Redwood Landscaping Co', '800 Timber Rd, Cedar Ridge', 'Landscaping', '11-50',
    'Sam Torres', 'Owner', 'sam@redwoodlandscaping.example.com', '+14155550116',
    36_000_00, 'lost', 0, (now() - interval '10 days')::date, 'customer_referral', null,
    now() - interval '12 days', null, now() - interval '27 days', now() - interval '10 days',
    null, now() - interval '24 days', now() - interval '24 days', now() - interval '17 days', now() - interval '12 days', null,
    3, 1, 1, 1, 0,
    null, null,
    now() - interval '10 days', 10, 14,
    'price', 'Owner said the price was too high compared to their current processor.'),
  -- Deal 17: lost (closed 30 days ago, competitor)
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000017')::uuid, v_org_id, v_owner, 'Ivy Lane Boutique', '33 Ivy Ln, Fairhaven', 'Retail/Apparel', '1-10',
    'Michelle Wu', 'Owner', 'michelle@ivylaneboutique.example.com', '+14155550117',
    21_000_00, 'lost', 0, (now() - interval '30 days')::date, 'self_sourced_canvass', null,
    now() - interval '32 days', null, now() - interval '54 days', now() - interval '30 days',
    null, now() - interval '51 days', now() - interval '51 days', now() - interval '37 days', null, now() - interval '44 days',
    4, 2, 1, 0, 1,
    null, null,
    now() - interval '30 days', 15, 21,
    'competitor', 'Owner signed with a competing processor.'),
  -- Deal 18: lost (closed 55 days ago, timing)
  (md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000018')::uuid, v_org_id, v_owner, 'Cobblestone Pizzeria', '99 Cobblestone Ct, Fairhaven', 'Food & Beverage', '11-50',
    'Vincent Russo', 'Owner', 'vincent@cobblestonepizzeria.example.com', '+14155550118',
    210_000_00, 'lost', 0, (now() - interval '55 days')::date, 'inbound', null,
    now() - interval '58 days', null, now() - interval '68 days', now() - interval '55 days',
    null, now() - interval '65 days', now() - interval '65 days', now() - interval '58 days', null, null,
    2, 1, 1, 0, 0,
    null, null,
    now() - interval '55 days', 7, 10,
    'timing', 'Owner wanted to revisit after their fiscal year budget freeze lifts.');

  -- ── 2. Activities (occurred_at back-dated; created_at defaults to now(),
  -- reflecting that the demo reset writes the row today). ──
  insert into activities (
    org_id, deal_id, logged_by, type, disposition, duration_minutes, outcome_notes, occurred_at, follow_up_date
  ) values
  -- Deal 1
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000001')::uuid, v_owner, 'call', 'connected_with_dm', 12, 'Initial call; contact was open to learning more about processing rates.', now() - interval '3 days', (current_date + 2)),
  -- Deal 2
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000002')::uuid, v_owner, 'email', 'future_potential', null, 'Sent intro email with navigatr overview.', now() - interval '6 days', (current_date + 4)),
  -- Deal 3
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000003')::uuid, v_owner, 'call', 'dm_unavailable', 8, 'Called; decision-maker was out, left a message.', now() - interval '10 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000003')::uuid, v_owner, 'drop_in', 'connected_with_dm', null, 'Stopped by in person; spoke briefly with the manager.', now() - interval '4 days', (current_date + 7)),
  -- Deal 4
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000004')::uuid, v_owner, 'call', 'connected_with_dm', 15, 'Introductory call; walked through the current processing setup.', now() - interval '12 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000004')::uuid, v_owner, 'email', 'followup_requested', null, 'Sent recap email with next steps.', now() - interval '5 days', (current_date + 1)),
  -- Deal 5
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000005')::uuid, v_owner, 'call', 'connected_with_dm', 18, 'Discussed pain points with current processor.', now() - interval '20 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000005')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent comparison sheet; contact responded positively.', now() - interval '12 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000005')::uuid, v_owner, 'drop_in', 'followup_requested', null, 'Stopped by; owner asked for a formal quote.', now() - interval '4 days', (current_date + 3)),
  -- Deal 6
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000006')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent intro email; got a reply expressing interest.', now() - interval '15 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000006')::uuid, v_owner, 'call', 'connected_with_dm', 14, 'Follow-up call to schedule a walkthrough.', now() - interval '6 days', (current_date + 10)),
  -- Deal 7
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000007')::uuid, v_owner, 'call', 'connected_with_dm', 20, 'Deep-dive call on fee structure.', now() - interval '25 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000007')::uuid, v_owner, 'appointment', 'positive_engagement', 45, 'On-site meeting with the practice manager; reviewed statement.', now() - interval '14 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000007')::uuid, v_owner, 'email', 'followup_requested', null, 'Sent updated rate proposal.', now() - interval '5 days', (current_date + 2)),
  -- Deal 8
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000008')::uuid, v_owner, 'call', 'connected_with_dm', 16, 'Initial qualifying call.', now() - interval '30 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000008')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent a case study for a similar gym client.', now() - interval '20 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000008')::uuid, v_owner, 'drop_in', 'connected_with_dm', null, 'Stopped by; met the GM in person.', now() - interval '10 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000008')::uuid, v_owner, 'call', 'followup_requested', 22, 'Discussed rollout timeline.', now() - interval '3 days', (current_date + 5)),
  -- Deal 9
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000009')::uuid, v_owner, 'call', 'connected_with_dm', 19, 'First call with the managing broker.', now() - interval '35 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000009')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent formal proposal draft.', now() - interval '22 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000009')::uuid, v_owner, 'appointment', 'positive_engagement', 40, 'In-office meeting to review the proposal terms.', now() - interval '12 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000009')::uuid, v_owner, 'call', 'followup_requested', 15, 'Final questions before signing.', now() - interval '2 days', (current_date + 1)),
  -- Deal 10 (won)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000010')::uuid, v_owner, 'call', 'connected_with_dm', 14, 'Intro call about processing needs.', now() - interval '23 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000010')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent pricing overview.', now() - interval '18 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000010')::uuid, v_owner, 'call', 'followup_requested', 17, 'Reviewed proposal details.', now() - interval '13 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000010')::uuid, v_owner, 'drop_in', 'positive_engagement', null, 'Stopped by to finalize paperwork.', now() - interval '9 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000010')::uuid, v_owner, 'email', 'statement_secured', null, 'Signed agreement; statement secured, deal won.', now() - interval '6 days', null),
  -- Deal 11 (won)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, v_owner, 'call', 'connected_with_dm', 20, 'Initial call with the managing partner.', now() - interval '33 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent proposal and case studies.', now() - interval '28 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, v_owner, 'call', 'followup_requested', 18, 'Answered questions on fees.', now() - interval '23 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, v_owner, 'drop_in', 'connected_with_dm', null, 'Stopped by the office.', now() - interval '18 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, v_owner, 'appointment', 'positive_engagement', 45, 'On-site review of the current statement.', now() - interval '15 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, v_owner, 'email', 'statement_secured', null, 'Contract signed; statement secured.', now() - interval '13 days', null),
  -- Deal 12 (won)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000012')::uuid, v_owner, 'call', 'connected_with_dm', 12, 'Intro call with the owner.', now() - interval '46 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000012')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent pricing comparison.', now() - interval '36 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000012')::uuid, v_owner, 'drop_in', 'followup_requested', null, 'Stopped by; owner wanted to think it over.', now() - interval '28 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000012')::uuid, v_owner, 'email', 'statement_secured', null, 'Owner signed on; statement secured.', now() - interval '23 days', null),
  -- Deal 13 (won)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, v_owner, 'call', 'connected_with_dm', 15, 'First outreach call.', now() - interval '68 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, v_owner, 'call', 'dm_unavailable', 5, 'Owner was busy with clients; called back later.', now() - interval '65 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent intro materials.', now() - interval '61 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent rate comparison.', now() - interval '57 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, v_owner, 'email', 'followup_requested', null, 'Sent updated proposal.', now() - interval '53 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, v_owner, 'drop_in', 'connected_with_dm', null, 'Stopped by the shop in person.', now() - interval '49 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, v_owner, 'appointment', 'positive_engagement', 30, 'Met to review the agreement.', now() - interval '45 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, v_owner, 'call', 'statement_secured', 10, 'Final signature call; statement secured.', now() - interval '42 days', null),
  -- Deal 14 (won)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000014')::uuid, v_owner, 'call', 'connected_with_dm', 17, 'Intro call with the clinic owner.', now() - interval '79 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000014')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent processing overview.', now() - interval '75 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000014')::uuid, v_owner, 'drop_in', 'followup_requested', null, 'Stopped by the clinic.', now() - interval '71 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000014')::uuid, v_owner, 'appointment', 'positive_engagement', 35, 'On-site review of the statement.', now() - interval '66 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000014')::uuid, v_owner, 'call', 'statement_secured', 12, 'Closing call; statement secured.', now() - interval '62 days', null),
  -- Deal 15 (won)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, v_owner, 'call', 'connected_with_dm', 10, 'First call with the owner.', now() - interval '110 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent intro info.', now() - interval '106 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, v_owner, 'email', 'followup_requested', null, 'Sent proposal.', now() - interval '102 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, v_owner, 'drop_in', 'connected_with_dm', null, 'Stopped by the store.', now() - interval '98 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent updated pricing.', now() - interval '94 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, v_owner, 'drop_in', 'followup_requested', null, 'Stopped by to finalize details.', now() - interval '90 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, v_owner, 'call', 'statement_secured', 14, 'Signed on; statement secured.', now() - interval '87 days', null),
  -- Deal 16 (lost, price)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000016')::uuid, v_owner, 'call', 'connected_with_dm', 14, 'Intro call about processing rates.', now() - interval '24 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000016')::uuid, v_owner, 'email', 'positive_engagement', null, 'Sent proposal.', now() - interval '17 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000016')::uuid, v_owner, 'drop_in', 'closed_lost', null, 'Owner said the price was too high compared to their current processor.', now() - interval '12 days', null),
  -- Deal 17 (lost, competitor)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000017')::uuid, v_owner, 'call', 'connected_with_dm', 16, 'Intro call with the boutique owner.', now() - interval '51 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000017')::uuid, v_owner, 'appointment', 'positive_engagement', 30, 'On-site meeting to review options.', now() - interval '44 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000017')::uuid, v_owner, 'email', 'followup_requested', null, 'Sent follow-up proposal.', now() - interval '37 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000017')::uuid, v_owner, 'call', 'closed_lost', 8, 'Owner signed with a competing processor.', now() - interval '32 days', null),
  -- Deal 18 (lost, timing)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000018')::uuid, v_owner, 'call', 'connected_with_dm', 11, 'Intro call about processing needs.', now() - interval '65 days', null),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000018')::uuid, v_owner, 'email', 'closed_lost', null, 'Owner said timing was bad; revisiting after their fiscal year.', now() - interval '58 days', null);

  -- ── 3. Deal stage history (ascending transitioned_at; last row lands on
  -- the deal's current stage; from_stage null only for the creation row). ──
  insert into deal_stage_history (org_id, deal_id, from_stage, to_stage, transitioned_at, transitioned_by) values
  -- Deal 1 (new)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000001')::uuid, null, 'new', now() - interval '5 days', v_owner),
  -- Deal 2 (new)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000002')::uuid, null, 'new', now() - interval '8 days', v_owner),
  -- Deal 3 (new)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000003')::uuid, null, 'new', now() - interval '12 days', v_owner),
  -- Deal 4 (contacted)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000004')::uuid, null, 'new', now() - interval '14 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000004')::uuid, 'new', 'contacted', now() - interval '11 days', v_owner),
  -- Deal 5 (contacted)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000005')::uuid, null, 'new', now() - interval '22 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000005')::uuid, 'new', 'contacted', now() - interval '19 days', v_owner),
  -- Deal 6 (contacted)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000006')::uuid, null, 'new', now() - interval '17 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000006')::uuid, 'new', 'contacted', now() - interval '13 days', v_owner),
  -- Deal 7 (qualified)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000007')::uuid, null, 'new', now() - interval '27 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000007')::uuid, 'new', 'contacted', now() - interval '22 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000007')::uuid, 'contacted', 'qualified', now() - interval '16 days', v_owner),
  -- Deal 8 (qualified)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000008')::uuid, null, 'new', now() - interval '32 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000008')::uuid, 'new', 'contacted', now() - interval '25 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000008')::uuid, 'contacted', 'qualified', now() - interval '18 days', v_owner),
  -- Deal 9 (proposal)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000009')::uuid, null, 'new', now() - interval '37 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000009')::uuid, 'new', 'contacted', now() - interval '30 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000009')::uuid, 'contacted', 'qualified', now() - interval '22 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000009')::uuid, 'qualified', 'proposal', now() - interval '14 days', v_owner),
  -- Deal 10 (won)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000010')::uuid, null, 'new', now() - interval '26 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000010')::uuid, 'new', 'contacted', now() - interval '21 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000010')::uuid, 'contacted', 'qualified', now() - interval '16 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000010')::uuid, 'qualified', 'proposal', now() - interval '10 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000010')::uuid, 'proposal', 'won', now() - interval '5 days', v_owner),
  -- Deal 11 (won)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, null, 'new', now() - interval '36 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, 'new', 'contacted', now() - interval '30 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, 'contacted', 'qualified', now() - interval '24 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, 'qualified', 'proposal', now() - interval '18 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, 'proposal', 'won', now() - interval '12 days', v_owner),
  -- Deal 12 (won)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000012')::uuid, null, 'new', now() - interval '49 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000012')::uuid, 'new', 'contacted', now() - interval '43 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000012')::uuid, 'contacted', 'qualified', now() - interval '37 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000012')::uuid, 'qualified', 'proposal', now() - interval '29 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000012')::uuid, 'proposal', 'won', now() - interval '22 days', v_owner),
  -- Deal 13 (won)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, null, 'new', now() - interval '71 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, 'new', 'contacted', now() - interval '63 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, 'contacted', 'qualified', now() - interval '55 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, 'qualified', 'proposal', now() - interval '47 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, 'proposal', 'won', now() - interval '40 days', v_owner),
  -- Deal 14 (won)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000014')::uuid, null, 'new', now() - interval '82 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000014')::uuid, 'new', 'contacted', now() - interval '76 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000014')::uuid, 'contacted', 'qualified', now() - interval '70 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000014')::uuid, 'qualified', 'proposal', now() - interval '64 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000014')::uuid, 'proposal', 'won', now() - interval '60 days', v_owner),
  -- Deal 15 (won)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, null, 'new', now() - interval '113 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, 'new', 'contacted', now() - interval '105 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, 'contacted', 'qualified', now() - interval '97 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, 'qualified', 'proposal', now() - interval '91 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000015')::uuid, 'proposal', 'won', now() - interval '85 days', v_owner),
  -- Deal 16 (lost; skipped proposal)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000016')::uuid, null, 'new', now() - interval '27 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000016')::uuid, 'new', 'contacted', now() - interval '21 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000016')::uuid, 'contacted', 'qualified', now() - interval '15 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000016')::uuid, 'qualified', 'lost', now() - interval '10 days', v_owner),
  -- Deal 17 (lost; full funnel)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000017')::uuid, null, 'new', now() - interval '54 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000017')::uuid, 'new', 'contacted', now() - interval '47 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000017')::uuid, 'contacted', 'qualified', now() - interval '40 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000017')::uuid, 'qualified', 'proposal', now() - interval '35 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000017')::uuid, 'proposal', 'lost', now() - interval '30 days', v_owner),
  -- Deal 18 (lost; quick fail)
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000018')::uuid, null, 'new', now() - interval '68 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000018')::uuid, 'new', 'contacted', now() - interval '60 days', v_owner),
  (v_org_id, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000018')::uuid, 'contacted', 'lost', now() - interval '55 days', v_owner);

  -- ── 4. Partners ──
  insert into partners (id, org_id, created_by, name, company, type, status, phone, email, city, last_touch_at) values
  (md5(v_org_id::text || 'b0000000-0000-0000-0000-000000000001')::uuid, v_org_id, v_owner, 'Jane Whitfield', 'Whitfield & Associates CPA', 'cpa_bookkeeper', 'active', '+14155550201', 'jane@whitfieldcpa.example.com', 'Cedar Ridge', now() - interval '9 days'),
  (md5(v_org_id::text || 'b0000000-0000-0000-0000-000000000002')::uuid, v_org_id, v_owner, 'Derek Osei', 'First Cedar Bank', 'business_banker_commercial_lender', 'active', '+14155550202', 'derek@firstcedarbank.example.com', 'Fairhaven', now() - interval '11 days'),
  (md5(v_org_id::text || 'b0000000-0000-0000-0000-000000000003')::uuid, v_org_id, v_owner, 'Monica Ferreira', 'Ferreira Law Group', 'small_business_attorney', 'active', '+14155550203', 'monica@ferreiralaw.example.com', 'Cedar Ridge', now() - interval '60 days');

  -- ── 5. Partner deals (attribution on won/proposal deals) ──
  insert into partner_deals (partner_id, deal_id, org_id, attributed_by) values
  (md5(v_org_id::text || 'b0000000-0000-0000-0000-000000000001')::uuid, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000009')::uuid, v_org_id, v_owner), -- Harbor View Realty (proposal)
  (md5(v_org_id::text || 'b0000000-0000-0000-0000-000000000001')::uuid, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000010')::uuid, v_org_id, v_owner), -- Golden Gate Cafe (won)
  (md5(v_org_id::text || 'b0000000-0000-0000-0000-000000000002')::uuid, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000011')::uuid, v_org_id, v_owner), -- Summit Legal Services (won)
  (md5(v_org_id::text || 'b0000000-0000-0000-0000-000000000002')::uuid, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000013')::uuid, v_org_id, v_owner), -- Maple Street Barbershop (won)
  (md5(v_org_id::text || 'b0000000-0000-0000-0000-000000000003')::uuid, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000014')::uuid, v_org_id, v_owner); -- Northside Veterinary Clinic (won)

  -- ── 6. Scheduled appointments (two upcoming, on open deals) ──
  insert into scheduled_appointments (
    org_id, owner_id, deal_id, title, start_at, end_at, location_address, status, calendar_event_id, calendar_sync_status
  ) values
  (v_org_id, v_owner, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000007')::uuid, 'Onboarding walkthrough - Lakeside Dental Group',
    now() + interval '1 day', now() + interval '1 day' + interval '30 minutes', '300 Lakeside Dr, Cedar Ridge', 'scheduled', 'gcal_demo_0001', 'synced'),
  (v_org_id, v_owner, md5(v_org_id::text || 'a0000000-0000-0000-0000-000000000009')::uuid, 'Proposal review - Harbor View Realty',
    now() + interval '2 days', now() + interval '2 days' + interval '30 minutes', '150 Harbor View Way, Fairhaven', 'scheduled', 'gcal_demo_0002', 'synced');

end $$;

grant execute on function reset_demo_data_base() to authenticated;
