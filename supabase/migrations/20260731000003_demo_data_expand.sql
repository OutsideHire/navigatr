-- Demo data expansion: more reps + a large randomized deal batch that exercises
-- the newer features (lead-source taxonomy leaning Path, Negotiation stage,
-- $1,000-$3,000 deal values, team roll-ups).
--
-- Additive + re-runnable: adds a thin `_seed_demo_extra(org, owner)` helper that
-- the reset wrapper calls AFTER the base fixture + hierarchy. On each reset the
-- base wipe clears all org deals/activities first, so this only ever INSERTs.
-- Runs inside the reset transaction (replica mode → triggers off), so we set the
-- denormalized activity columns ourselves via a recompute UPDATE.
--
-- Deferred to a follow-up (touch a prospects FK / extra enums): Path routes with
-- drop-in notes, appointment outcomes, coverage snapshots.

create or replace function _seed_demo_extra(p_org uuid, p_owner uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  -- Seven extra reps, split under the two demo managers (mgr1/mgr2), plus the
  -- four the hierarchy already seeds → eleven leaf reps to spread deals across.
  v_xkeys  text[] := array['xrep1','xrep2','xrep3','xrep4','xrep5','xrep6','xrep7'];
  v_xids   uuid[];
  v_reps   uuid[];
  v_batch  int := 90;   -- randomized deals to generate
begin
  set local session_replication_role = replica;

  select array_agg(md5(p_org::text || k)::uuid) into v_xids from unnest(v_xkeys) k;

  -- Re-runnable: drop any prior extra reps (their deals were already wiped by the
  -- base reset). profiles before auth.users.
  delete from profiles   where org_id = p_org and id = any(v_xids);
  delete from auth.users where id = any(v_xids);

  -- Synthetic non-login rep accounts.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    '00000000-0000-0000-0000-000000000000',
    md5(p_org::text || r.k)::uuid, 'authenticated', 'authenticated',
    'demo-' || r.k || '-' || p_org::text || '@navigatr-demo.local', null,
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', r.nm),
    '', '', '', ''
  from (values
    ('xrep1','Nina Ortiz'),   ('xrep2','Owen Brooks'), ('xrep3','Priya Nair'),
    ('xrep4','Quinn Adams'),  ('xrep5','Ravi Menon'),  ('xrep6','Sofia Reyes'),
    ('xrep7','Theo Walsh')
  ) as r(k, nm);

  -- Their profiles: reps under mgr1 (first 4) and mgr2 (last 3).
  insert into profiles (id, org_id, role, role_level, manager_id, full_name, email)
  select
    md5(p_org::text || r.k)::uuid, p_org, 'rep'::user_role, 'sales_professional'::role_level,
    md5(p_org::text || r.mgr)::uuid, r.nm,
    'demo-' || r.k || '-' || p_org::text || '@navigatr-demo.local'
  from (values
    ('xrep1','mgr1','Nina Ortiz'),  ('xrep2','mgr1','Owen Brooks'),
    ('xrep3','mgr1','Priya Nair'),  ('xrep4','mgr1','Quinn Adams'),
    ('xrep5','mgr2','Ravi Menon'),  ('xrep6','mgr2','Sofia Reyes'),
    ('xrep7','mgr2','Theo Walsh')
  ) as r(k, mgr, nm);

  -- Rebuild role_path so the new reps slot into the org-chart tree + roll-ups.
  perform public.rebuild_role_path_subtree(md5(p_org::text || 'mgr1')::uuid);
  perform public.rebuild_role_path_subtree(md5(p_org::text || 'mgr2')::uuid);

  -- Every leaf rep to distribute deals across (hierarchy's rep1-4 + the new 7).
  v_reps := array[
    md5(p_org::text || 'rep1')::uuid, md5(p_org::text || 'rep2')::uuid,
    md5(p_org::text || 'rep3')::uuid, md5(p_org::text || 'rep4')::uuid
  ] || v_xids;

  -- ── Rescale + modernize the base 18 fixture deals ──
  -- Bring them into the $1,000-$3,000 range and onto the canonical lead-source
  -- taxonomy (leaning Path), so the whole dataset is one coherent story.
  update deals d set
    value_cents = (100000 + floor(random() * 200001))::int,
    lead_source = (case
      when random() < 0.45 then 'path'
      when random() < 0.65 then 'partner_referral'
      when random() < 0.77 then 'self_sourced_canvass'
      when random() < 0.87 then 'customer_referral'
      when random() < 0.95 then 'inbound'
      else 'event_association' end)
  where d.org_id = p_org
    and d.id in (
      select md5(p_org::text || 'a0000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid
      from generate_series(1, 18) i
    );

  -- ── Randomized deal batch ──
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
  )
  select
    md5(p_org::text || 'ext-' || s.g)::uuid, p_org, s.owner,
    'Demo Merchant ' || s.g,
    (s.g || ' Market St, Fairhaven'), 'Retail', '1-10',
    'Contact ' || s.g, 'Owner', 'contact' || s.g || '@demo.example.com', '+1415555' || lpad(s.g::text, 4, '0'),
    s.value_cents, s.stage,
    (case s.stage when 'new' then 20 when 'contacted' then 40 when 'qualified' then 60
      when 'proposal' then 80 when 'submitted' then 85 when 'won' then 100 else 0 end),
    (case
      when s.stage = 'won'  then (s.created + interval '20 days')::date
      when s.stage = 'lost' then (s.created + interval '15 days')::date
      else current_date + (7 + floor(random() * 40))::int end),
    s.lead_source, null,
    s.created + interval '2 days',
    (case when s.stage in ('won','lost') then null else now() + ((1 + floor(random() * 10))::int || ' days')::interval end),
    s.created, now(),
    (case when s.stage = 'won' then s.created + interval '20 days' else null end),
    null, null, null, null, null,          -- first_*_at recomputed below
    null, null, null, null, null,          -- activity_count_* recomputed below
    (case when s.stage = 'won' then 14 else null end),
    (case when s.stage = 'won' then 20 else null end),
    (case when s.stage = 'lost' then s.created + interval '15 days' else null end),
    (case when s.stage = 'lost' then 11 else null end),
    (case when s.stage = 'lost' then 15 else null end),
    (case when s.stage = 'lost'
      then (array['price','competitor','timing'])[1 + floor(random() * 3)::int]::lost_reason_category else null end),
    (case when s.stage = 'lost' then 'Demo lost-reason note.' else null end)
  from (
    select
      g,
      v_reps[1 + floor(random() * array_length(v_reps, 1))::int] as owner,
      (100000 + floor(random() * 200001))::int as value_cents,
      (now() - ((25 + floor(random() * 120))::int || ' days')::interval) as created,
      (case
        when random() < 0.20 then 'new'
        when random() < 0.38 then 'contacted'
        when random() < 0.53 then 'qualified'
        when random() < 0.63 then 'proposal'
        when random() < 0.73 then 'submitted'
        when random() < 0.88 then 'won'
        else 'lost' end)::deal_stage as stage,
      (case
        when random() < 0.45 then 'path'
        when random() < 0.65 then 'partner_referral'
        when random() < 0.77 then 'self_sourced_canvass'
        when random() < 0.87 then 'customer_referral'
        when random() < 0.95 then 'inbound'
        else 'event_association' end) as lead_source
    from generate_series(1, v_batch) g
  ) s;

  -- ── Two activities per batch deal (occurred within the deal's life) ──
  insert into activities (
    org_id, deal_id, logged_by, type, disposition, duration_minutes, outcome_notes, occurred_at, follow_up_date
  )
  select
    p_org, d.id, d.owner_id,
    (array['call','email','drop_in','appointment'])[1 + floor(random() * 4)::int]::activity_type,
    (array['connected_with_dm','positive_engagement','dm_unavailable','followup_requested'])[1 + floor(random() * 4)::int]::disposition,
    null, 'Demo activity.', d.created_at + (n || ' days')::interval, null
  from deals d, generate_series(1, 2) n
  where d.org_id = p_org
    and d.id in (select md5(p_org::text || 'ext-' || g)::uuid from generate_series(1, v_batch) g);

  -- Recompute the denormalized activity columns for the batch deals from their
  -- activities (triggers are off in replica mode, so we do it by hand).
  update deals d set
    first_activity_at = a.first_at, last_activity_at = a.last_at,
    activity_count_total = a.total,
    activity_count_call = a.calls, activity_count_email = a.emails,
    activity_count_dropin = a.dropins, activity_count_appointment = a.appts,
    first_call_at = a.first_call, first_email_at = a.first_email,
    first_dropin_at = a.first_dropin, first_appointment_at = a.first_appt
  from (
    select deal_id,
      min(occurred_at) first_at, max(occurred_at) last_at, count(*) total,
      count(*) filter (where type = 'call') calls,
      count(*) filter (where type = 'email') emails,
      count(*) filter (where type = 'drop_in') dropins,
      count(*) filter (where type = 'appointment') appts,
      min(occurred_at) filter (where type = 'call') first_call,
      min(occurred_at) filter (where type = 'email') first_email,
      min(occurred_at) filter (where type = 'drop_in') first_dropin,
      min(occurred_at) filter (where type = 'appointment') first_appt
    from activities where org_id = p_org group by deal_id
  ) a
  where d.id = a.deal_id and d.org_id = p_org
    and d.id in (select md5(p_org::text || 'ext-' || g)::uuid from generate_series(1, v_batch) g);

  -- ── Stage history for the batch: creation row + a jump to the current stage
  -- (enough for the conversion funnel to have data). ──
  insert into deal_stage_history (org_id, deal_id, from_stage, to_stage, transitioned_at, transitioned_by)
  select p_org, d.id, null, 'new'::deal_stage, d.created_at, d.owner_id
  from deals d
  where d.org_id = p_org
    and d.id in (select md5(p_org::text || 'ext-' || g)::uuid from generate_series(1, v_batch) g)
  union all
  select p_org, d.id, 'new'::deal_stage, d.stage, d.created_at + interval '5 days', d.owner_id
  from deals d
  where d.org_id = p_org and d.stage <> 'new'
    and d.id in (select md5(p_org::text || 'ext-' || g)::uuid from generate_series(1, v_batch) g);
end $$;

revoke all on function _seed_demo_extra(uuid, uuid) from public;

-- Re-wrap reset_demo_data so it also runs the extra seed (base → hierarchy → extra).
create or replace function reset_demo_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org_id uuid;
  v_role   user_role;
  v_owner  uuid := auth.uid();
begin
  if v_owner is null then raise exception 'not_authenticated'; end if;
  select p.org_id, p.role into v_org_id, v_role from profiles p where p.id = v_owner;
  if v_role <> 'admin' then raise exception 'not_authorized'; end if;
  if not exists (
    select 1 from org_features
    where org_id = v_org_id and feature_key = 'demo_reset' and enabled
  ) then
    raise exception 'demo_reset_not_enabled';
  end if;

  perform reset_demo_data_base();                    -- wipe + 18-deal fixture
  perform _seed_demo_hierarchy(v_org_id, v_owner);   -- 7-layer synthetic org + branch deals
  perform _seed_demo_extra(v_org_id, v_owner);       -- +7 reps, rescaled fixture, randomized batch
end $$;
grant execute on function reset_demo_data() to authenticated;
