-- Demo data expansion, layer 2 (fast-follow): seed the feature surfaces the core
-- batch skipped — a Path route with dictated drop-in notes, appointment outcomes
-- (completed + awaiting), and per-rep coverage snapshots.
--
-- Additive: adds `_seed_demo_extra2(org, owner)`, called by the reset wrapper
-- after `_seed_demo_extra`. Re-runnable: the base wipe clears the caller's paths
-- and the org's scheduled_appointments each reset; coverage_snapshot is not wiped
-- by the base, so we clear the org's rows here first. Runs in replica mode.

create or replace function _seed_demo_extra2(p_org uuid, p_owner uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_path uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;

  -- ── 1. A Path with drop-in stops + dictated-style notes (owned by the caller;
  -- the base wipe clears the caller's paths each reset). prospect_id is
  -- fabricated — FK triggers are off in replica mode and stops render from their
  -- own snapshot columns, not a prospects join. ──
  insert into paths (id, user_id, path_date, origin_label, origin_lat, origin_lng, status, created_at)
  values (v_path, p_owner, current_date, 'Downtown Fairhaven', 40.00, -74.00, 'completed', now());

  insert into path_stops (
    path_id, prospect_id, name, address, lat, lng, category, primary_type,
    position, status, disposition, notes, deal_created, added_at
  ) values
    (v_path, md5(p_org::text || 'ps1')::uuid, 'Riverside Diner', '214 Elm St, Fairhaven', 40.01, -74.01,
      'restaurants_bars_entertainment', 'restaurant', 0, 'visited', 'statement_secured',
      'Owner ready to switch off Square. Signed the statement authorization on the spot.', true, now()),
    (v_path, md5(p_org::text || 'ps2')::uuid, 'Bloom & Petal Florist', '88 Blossom Ave, Fairhaven', 40.02, -74.02,
      'retail', 'florist', 1, 'visited', 'followup_requested',
      'Wants a formal proposal. Busy through the weekend, follow up Monday morning.', true, now()),
    (v_path, md5(p_org::text || 'ps3')::uuid, 'The Corner Bakery', '45 Baker St, Fairhaven', 40.03, -74.03,
      'restaurants_bars_entertainment', 'bakery', 2, 'visited', 'not_interested',
      'Locked into a two-year contract with their current processor. Revisit next year.', false, now()),
    (v_path, md5(p_org::text || 'ps4')::uuid, 'Ace Hardware Downtown', '500 Main St, Fairhaven', 40.04, -74.04,
      'retail', 'hardware_store', 3, 'visited', 'dm_unavailable',
      'Manager was out. Left collateral with the clerk, try again next week.', false, now()),
    (v_path, md5(p_org::text || 'ps5')::uuid, 'Metro Auto Repair', '900 Industrial Pkwy, Cedar Ridge', 40.05, -74.05,
      'automotive', 'auto_repair', 4, 'pending', null, null, false, now()),
    (v_path, md5(p_org::text || 'ps6')::uuid, 'Union Square Dry Cleaners', '5 Union Sq, Fairhaven', 40.06, -74.06,
      'personal_services', 'dry_cleaner', 5, 'pending', null, null, false, now());

  -- ── 2a. Past appointments WITH an outcome (completed) on some batch deals ──
  insert into scheduled_appointments (
    org_id, owner_id, deal_id, title, start_at, end_at, location_address, status,
    calendar_event_id, calendar_sync_status, outcome, outcome_notes, outcome_at
  )
  select
    p_org, d.owner_id, d.id, 'Onsite review · ' || d.company_name,
    d.created_at + interval '10 days', d.created_at + interval '10 days' + interval '30 minutes',
    d.address, 'completed', 'gcal_demo_ext_' || d.id::text, 'synced',
    (array['appt_application_signed','appt_verbal_commitment','appt_statements_collected'])[1 + floor(random() * 3)::int],
    'Productive meeting — collected statements and walked through pricing.',
    d.created_at + interval '10 days' + interval '1 hour'
  from deals d
  where d.org_id = p_org and d.stage in ('won','proposal')
    and d.id in (select md5(p_org::text || 'ext-' || g)::uuid from generate_series(1, 90) g)
  limit 6;

  -- ── 2b. Past appointments WITHOUT an outcome (drives the "awaiting outcome" nudge) ──
  insert into scheduled_appointments (
    org_id, owner_id, deal_id, title, start_at, end_at, location_address, status,
    calendar_event_id, calendar_sync_status
  )
  select
    p_org, d.owner_id, d.id, 'Follow-up · ' || d.company_name,
    now() - interval '2 days', now() - interval '2 days' + interval '30 minutes',
    d.address, 'scheduled', 'gcal_demo_await_' || d.id::text, 'synced'
  from deals d
  where d.org_id = p_org and d.stage in ('contacted','qualified')
    and d.id not in (
      select deal_id from scheduled_appointments where org_id = p_org and deal_id is not null
    )
    and d.id in (select md5(p_org::text || 'ext-' || g)::uuid from generate_series(1, 90) g)
  limit 3;

  -- ── 3. Per-rep coverage snapshot for today (coverage_snapshot is not cleared
  -- by the base wipe, so clear the org's rows first for re-runnability). ──
  delete from coverage_snapshot where org_id = p_org;
  insert into coverage_snapshot (
    org_id, user_id, snapshot_date, composite_coverage, confidence_level,
    call_coverage, call_event_count, active_channels, window_start_date, window_end_date
  )
  select
    p_org, pr.id, current_date,
    round((0.45 + random() * 0.5)::numeric, 2),
    (array['high','medium'])[1 + floor(random() * 2)::int],
    round((0.45 + random() * 0.5)::numeric, 2),
    (5 + floor(random() * 35))::int,
    '{call}', current_date - 30, current_date
  from profiles pr
  where pr.org_id = p_org and pr.role_level = 'sales_professional';
end $$;

revoke all on function _seed_demo_extra2(uuid, uuid) from public;

-- Re-wrap: base → hierarchy → extra → extra2.
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
end $$;
grant execute on function reset_demo_data() to authenticated;
