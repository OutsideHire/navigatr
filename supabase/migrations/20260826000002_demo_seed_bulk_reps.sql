-- B2: make a seeded demo org look like a real team (~50 people) so prospect
-- demos and eval aren't a thin 20-person org. Additive: a new bulk-reps step
-- appended to the reset_demo_data chain; it only runs on demo orgs (the wrapper
-- still gates on the demo_reset feature flag), so real orgs are untouched.
--
-- The reps are non-login synthetic accounts (encrypted_password NULL,
-- @navigatr-demo.local), deterministic md5(org||key) ids, round-robin under the
-- two existing demo sales managers, matching _seed_demo_hierarchy /
-- _seed_demo_extra exactly. They render in Team / org chart / roll-ups; they do
-- not carry their own deals (the existing seeder already produces a rich
-- pipeline on the original leaf reps, so the dashboard stays populated while the
-- roster looks realistically large, with ramping reps who have no deals yet).

create or replace function public._seed_demo_bulk_reps(p_org uuid, p_owner uuid, p_count int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids   uuid[];
  v_first text[] := array['Alex','Sam','Jordan','Taylor','Casey','Morgan','Jamie','Devin','Drew','Skyler'];
  v_last  text[] := array['Nguyen','Patel','Garcia','Hughes','Kim','Silva','Owens','Reed','Choi','Blake'];
begin
  if p_count <= 0 then return; end if;
  set local session_replication_role = replica;

  select array_agg(md5(p_org::text || 'brep' || g)::uuid) into v_ids
    from generate_series(1, p_count) g;

  -- Re-runnable: drop any prior bulk reps first (profiles before auth.users).
  delete from profiles   where org_id = p_org and id = any(v_ids);
  delete from auth.users where id = any(v_ids);

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    '00000000-0000-0000-0000-000000000000',
    md5(p_org::text || 'brep' || g)::uuid, 'authenticated', 'authenticated',
    'demo-brep' || g || '-' || p_org::text || '@navigatr-demo.local', null,
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', v_first[1 + ((g - 1) / 10) % 10] || ' ' || v_last[1 + (g - 1) % 10]),
    '', '', '', ''
  from generate_series(1, p_count) g;

  insert into profiles (id, org_id, role, role_level, manager_id, full_name, email)
  select
    md5(p_org::text || 'brep' || g)::uuid, p_org, 'rep'::user_role, 'sales_professional'::role_level,
    -- round-robin under the two existing demo sales managers
    md5(p_org::text || case when g % 2 = 0 then 'mgr2' else 'mgr1' end)::uuid,
    v_first[1 + ((g - 1) / 10) % 10] || ' ' || v_last[1 + (g - 1) % 10],
    'demo-brep' || g || '-' || p_org::text || '@navigatr-demo.local'
  from generate_series(1, p_count) g;

  -- Slot the new reps into the org-chart tree + roll-ups under their managers.
  perform public.rebuild_role_path_subtree(md5(p_org::text || 'mgr1')::uuid);
  perform public.rebuild_role_path_subtree(md5(p_org::text || 'mgr2')::uuid);
end $$;

revoke all on function public._seed_demo_bulk_reps(uuid, uuid, int) from public;

-- Re-wrap: base → hierarchy → extra → extra2 → extra3 → extra4 → bulk reps.
-- Also raise the demo org's seat cap so ~50 seeded members fit and the admin
-- can still invite more without hitting the cap.
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
  perform _seed_demo_extra4(v_org_id, v_owner);
  perform _seed_demo_bulk_reps(v_org_id, v_owner, 30);

  update organizations set seat_limit = 100 where id = v_org_id;
end $$;
grant execute on function reset_demo_data() to authenticated;
