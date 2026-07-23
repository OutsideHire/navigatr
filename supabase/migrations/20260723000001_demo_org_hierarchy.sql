-- Demo org: multi-layer synthetic hierarchy (PRD 6.8.A, phase 1B.4). Re-runnable.
--
-- Extends the demo reset so it also seeds a full 7-layer org of synthetic,
-- NON-LOGIN teammates (Administrator = the caller, then CSO -> SVPs -> VPs ->
-- Directors -> Managers -> Reps) and distributes the reseeded demo deals across
-- the leaf reps so roll-ups differ by branch. Lets the org-chart tree and
-- hierarchy roll-ups be tested without real signups.
--
-- Design: rather than reproduce the large reset_demo_data() body, we RENAME the
-- existing function to reset_demo_data_base() and create a thin reset_demo_data()
-- wrapper that calls the base (wipe + 18-deal reseed) and then the new
-- _seed_demo_hierarchy() helper. Synthetic ids/emails are namespaced per org
-- (md5(org||key)) so multiple demo orgs stay independent. Applied via the
-- Supabase SQL editor.

-- ── 1. Helper: seed the synthetic hierarchy + distribute the demo deals ──
-- Runs inside the reset transaction (replica mode already on); sets it again
-- defensively. Deletes any stale synthetic teammates from a prior reset first
-- (deterministic ids), then recreates them and reassigns the freshly-reseeded
-- deals to the leaf reps by branch.
create or replace function _seed_demo_hierarchy(p_org uuid, p_owner uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_ids uuid[] := array[
    md5(p_org::text || 'cso')::uuid,
    md5(p_org::text || 'svp1')::uuid, md5(p_org::text || 'svp2')::uuid,
    md5(p_org::text || 'vp1')::uuid,  md5(p_org::text || 'vp2')::uuid,
    md5(p_org::text || 'dir1')::uuid, md5(p_org::text || 'dir2')::uuid,
    md5(p_org::text || 'mgr1')::uuid, md5(p_org::text || 'mgr2')::uuid,
    md5(p_org::text || 'rep1')::uuid, md5(p_org::text || 'rep2')::uuid,
    md5(p_org::text || 'rep3')::uuid, md5(p_org::text || 'rep4')::uuid
  ];
begin
  set local session_replication_role = replica;

  -- Clear any prior synthetic teammates (their deals/activities were already
  -- removed by the base wipe; delete profiles before auth.users).
  delete from profiles   where org_id = p_org and id = any(v_ids);
  delete from auth.users where id = any(v_ids);

  -- Create the synthetic non-login accounts (auth.users) from a roster.
  with roster(k, nm) as (
    values
      ('cso',  'Dana Cross'),
      ('svp1', 'Sam Vance'),  ('svp2', 'Priya Rao'),
      ('vp1',  'Victor Pratt'),('vp2', 'Vera Powell'),
      ('dir1', 'Derek Iyer'), ('dir2', 'Dina Ruiz'),
      ('mgr1', 'Marco Diaz'), ('mgr2', 'Mona Lee'),
      ('rep1', 'Riley Cole'), ('rep2', 'Rosa Kim'),
      ('rep3', 'Ravi Shah'),  ('rep4', 'Remy Fox')
  )
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
  from roster r;

  -- Create their profiles with role_level + reporting line. mgr_k is the key of
  -- the manager (null => reports to the Administrator/caller).
  with roster(k, lvl, mgr_k, nm) as (
    values
      ('cso',  'cso_cro',          null,   'Dana Cross'),
      ('svp1', 'svp_sales',        'cso',  'Sam Vance'),
      ('svp2', 'svp_sales',        'cso',  'Priya Rao'),
      ('vp1',  'vp_sales',         'svp1', 'Victor Pratt'),
      ('vp2',  'vp_sales',         'svp2', 'Vera Powell'),
      ('dir1', 'director_sales',   'vp1',  'Derek Iyer'),
      ('dir2', 'director_sales',   'vp2',  'Dina Ruiz'),
      ('mgr1', 'sales_manager',    'dir1', 'Marco Diaz'),
      ('mgr2', 'sales_manager',    'dir2', 'Mona Lee'),
      ('rep1', 'sales_professional','mgr1','Riley Cole'),
      ('rep2', 'sales_professional','mgr1','Rosa Kim'),
      ('rep3', 'sales_professional','mgr2','Ravi Shah'),
      ('rep4', 'sales_professional','mgr2','Remy Fox')
  )
  insert into profiles (id, org_id, role, role_level, manager_id, full_name, email)
  select
    md5(p_org::text || r.k)::uuid,
    p_org,
    case r.lvl
      when 'administrator' then 'admin'::user_role
      when 'sales_professional' then 'rep'::user_role
      else 'manager'::user_role
    end,
    r.lvl::role_level,
    case when r.mgr_k is null then p_owner else md5(p_org::text || r.mgr_k)::uuid end,
    r.nm,
    'demo-' || r.k || '-' || p_org::text || '@navigatr-demo.local'
  from roster r;

  -- Root the synthetic subtree under the Administrator (rebuilds role_path for
  -- the CSO and every descendant).
  perform public.rebuild_role_path_subtree(md5(p_org::text || 'cso')::uuid);

  -- Distribute the reseeded demo deals across the four leaf reps, by branch,
  -- so a Manager/Director sees only their own branch's deals.
  update deals set owner_id = md5(p_org::text || 'rep1')::uuid
   where org_id = p_org and id = any(array[
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000001')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000002')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000003')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000004')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000005')::uuid ]);
  update deals set owner_id = md5(p_org::text || 'rep2')::uuid
   where org_id = p_org and id = any(array[
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000006')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000007')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000008')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000009')::uuid ]);
  update deals set owner_id = md5(p_org::text || 'rep3')::uuid
   where org_id = p_org and id = any(array[
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000010')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000011')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000012')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000013')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000014')::uuid ]);
  update deals set owner_id = md5(p_org::text || 'rep4')::uuid
   where org_id = p_org and id = any(array[
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000015')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000016')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000017')::uuid,
     md5(p_org::text || 'a0000000-0000-0000-0000-000000000018')::uuid ]);

  -- Keep activity + appointment ownership aligned with each deal's new owner.
  update activities a set logged_by = d.owner_id
    from deals d where a.deal_id = d.id and a.org_id = p_org;
  update scheduled_appointments s set owner_id = d.owner_id
    from deals d where s.deal_id = d.id and s.org_id = p_org;
end $$;
-- Internal only: called by reset_demo_data() (same owner). NOT callable by
-- app users directly, otherwise any authenticated user could seed synthetic
-- accounts into an arbitrary org via the unguarded p_org argument.
revoke all on function _seed_demo_hierarchy(uuid, uuid) from public;

-- ── 2. Wrap reset_demo_data so it also seeds the hierarchy ──
-- Rename the existing function once (guarded so this migration is re-runnable),
-- then define a thin wrapper that runs the base reset and then the hierarchy.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'reset_demo_data_base' and n.nspname = 'public'
  ) then
    alter function reset_demo_data() rename to reset_demo_data_base;
  end if;
end $$;

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

  perform reset_demo_data_base();                    -- existing wipe + 18-deal reseed
  perform _seed_demo_hierarchy(v_org_id, v_owner);   -- + synthetic 7-layer org, branch-distributed deals
end $$;
grant execute on function reset_demo_data() to authenticated;
