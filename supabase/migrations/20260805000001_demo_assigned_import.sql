-- Demo data: add Assigned + Import deals so the Lead Source report's Scope
-- toggle ("Rep sourced only" vs "All sources") visibly changes the chart and the
-- "Assigned and Import included" banner becomes truthful. The prior demo seed
-- used only rep-sourced channels, so scope had nothing to exclude.
--
-- Additive: adds `_seed_demo_extra3(org, owner)`, called by the reset wrapper
-- after `_seed_demo_extra2`. Re-runnable: the base wipe clears the org's deals
-- each reset. Runs in replica mode (triggers off, so denormalized columns are
-- set by hand and the name+address de-dup trigger does not fire on the seed).
--
-- Deliberately low win rate + lower value than rep-sourced deals, so with
-- "All sources" selected they pull the blended win rate and MRR-per-lead down,
-- exactly as the report's banner describes non-prospecting channels.

create or replace function _seed_demo_extra3(p_org uuid, p_owner uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  set local session_replication_role = replica;

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
    md5(p_org::text || 'ai-' || s.g)::uuid, p_org,
    -- Spread across the leaf reps; fall back to the caller if none exist.
    coalesce(
      (select pr.id from profiles pr
        where pr.org_id = p_org and pr.role_level = 'sales_professional'
        order by random() limit 1),
      p_owner),
    s.src_label || ' Merchant ' || s.g,
    (s.g || ' Commerce Blvd, Fairhaven'), 'Retail', '1-10',
    'Contact ' || s.g, 'Owner', 'aicontact' || s.g || '@demo.example.com',
    '+1415556' || lpad(s.g::text, 4, '0'),
    s.value_cents, s.stage,
    (case s.stage when 'new' then 20 when 'contacted' then 40 when 'qualified' then 60
      when 'proposal' then 80 when 'won' then 100 else 0 end),
    (case when s.stage = 'won' then (s.created + interval '20 days')::date
      else current_date + (7 + floor(random() * 40))::int end),
    s.lead_source, null,
    s.created + interval '2 days',
    (case when s.stage = 'won' then null else now() + ((1 + floor(random() * 10))::int || ' days')::interval end),
    s.created, now(),
    (case when s.stage = 'won' then s.created + interval '20 days' else null end),
    null, null, null, null, null,          -- first_*_at (no activities seeded for these)
    null, null, null, null, null,          -- activity_count_*
    (case when s.stage = 'won' then 18 else null end),
    (case when s.stage = 'won' then 26 else null end),
    null, null, null, null, null           -- no lost deals in this batch
  from (
    select
      g,
      -- First 8 = Assigned, last 4 = Import.
      (case when g <= 8 then 'assigned' else 'import' end) as lead_source,
      (case when g <= 8 then 'Assigned' else 'Import' end) as src_label,
      -- Lower value than rep-sourced ($600-$2,000) so yield-per-lead drops.
      (60000 + floor(random() * 140001))::int as value_cents,
      (now() - ((20 + floor(random() * 120))::int || ' days')::interval) as created,
      -- Low win rate: force one Won in each of Assigned (g=1) and Import (g=9)
      -- so both show some won revenue, everything else early-stage.
      (case
        when g in (1, 9) then 'won'
        when random() < 0.35 then 'new'
        when random() < 0.65 then 'contacted'
        when random() < 0.88 then 'qualified'
        else 'proposal' end)::deal_stage as stage
    from generate_series(1, 12) g
  ) s;
end $$;

revoke all on function _seed_demo_extra3(uuid, uuid) from public;

-- Re-wrap: base → hierarchy → extra → extra2 → extra3.
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

  perform reset_demo_data_base();
  perform _seed_demo_hierarchy(v_org_id, v_owner);
  perform _seed_demo_extra(v_org_id, v_owner);
  perform _seed_demo_extra2(v_org_id, v_owner);
  perform _seed_demo_extra3(v_org_id, v_owner);
end $$;
grant execute on function reset_demo_data() to authenticated;
