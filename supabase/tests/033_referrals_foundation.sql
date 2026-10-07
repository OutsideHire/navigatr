-- Tests for 20261007000001_referrals_foundation (Partner Portal Phase 0).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/033_referrals_foundation.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org RF):
--   boss  administrator  role_path boss
--   mgr   sales_manager  boss.mgr
--   rep1  sales_pro      boss.mgr.rep1   owns partner P1
--   rep2  sales_pro      boss.mgr.rep2   owns partner P2
--   rep3  sales_pro      boss.rep3       owns partner P3 (sibling of mgr's team)
--   gone  sales_pro      boss.mgr.gone   DEACTIVATED, manager = mgr, owns P4
--   loner sales_pro      NULL path, no manager, owns P5
-- Second org RX exists only to prove org_id is taken from the partner.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000e1', 'Referral Foundation', 'ref-found', 'ref-found-a1'),
  ('00000000-0000-0000-0000-0000000000e2', 'Other Org',           'ref-other', 'ref-other-a1');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('e1000000-0000-0000-0000-000000000001', 'boss@rf.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('e1000000-0000-0000-0000-000000000002', 'mgr@rf.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('e1000000-0000-0000-0000-000000000003', 'rep1@rf.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('e1000000-0000-0000-0000-000000000004', 'rep2@rf.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('e1000000-0000-0000-0000-000000000005', 'rep3@rf.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('e1000000-0000-0000-0000-000000000006', 'gone@rf.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('e1000000-0000-0000-0000-000000000007', 'loner@rf.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('e1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'admin',   'administrator',      'Boss',  'boss@rf.example',  'boss'::ltree,          null, null),
  ('e1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e1', 'manager', 'sales_manager',      'Mgr',   'mgr@rf.example',   'boss.mgr'::ltree,      'e1000000-0000-0000-0000-000000000001', null),
  ('e1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e1', 'rep',     'sales_professional', 'Rep1',  'rep1@rf.example',  'boss.mgr.rep1'::ltree, 'e1000000-0000-0000-0000-000000000002', null),
  ('e1000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000e1', 'rep',     'sales_professional', 'Rep2',  'rep2@rf.example',  'boss.mgr.rep2'::ltree, 'e1000000-0000-0000-0000-000000000002', null),
  ('e1000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000e1', 'rep',     'sales_professional', 'Rep3',  'rep3@rf.example',  'boss.rep3'::ltree,     'e1000000-0000-0000-0000-000000000001', null),
  ('e1000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000e1', 'rep',     'sales_professional', 'Gone',  'gone@rf.example',  'boss.mgr.gone'::ltree, 'e1000000-0000-0000-0000-000000000002', now()),
  ('e1000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000e1', 'rep',     'sales_professional', 'Loner', 'loner@rf.example', null,                   null, null);

insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('e1a00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'e1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003', 'P1', 'P1 CPA', 'cpa'),
  ('e1a00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e1', 'e1000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000004', 'P2', 'P2 CPA', 'cpa'),
  ('e1a00000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e1', 'e1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000005', 'P3', 'P3 CPA', 'cpa'),
  ('e1a00000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000e1', 'e1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000006', 'P4', 'P4 CPA', 'cpa'),
  ('e1a00000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000e1', 'e1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000007', 'P5', 'P5 CPA', 'cpa');

-- R1: P1's, assigned rep1. R2: P2's but assigned rep1 (assignee path).
-- R3: P3's, admin queue (assignee NULL). R4: org_id deliberately WRONG (RX);
-- the trigger must correct it to RF from the partner.
insert into referrals (id, org_id, partner_id, company_name, assigned_user_id) values
  ('e1b00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'e1a00000-0000-0000-0000-000000000001', 'Acme Bakery',  'e1000000-0000-0000-0000-000000000003'),
  ('e1b00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e1', 'e1a00000-0000-0000-0000-000000000002', 'Bolt Gym',     'e1000000-0000-0000-0000-000000000003'),
  ('e1b00000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e1', 'e1a00000-0000-0000-0000-000000000003', 'Cove Dental',  null),
  ('e1b00000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000e2', 'e1a00000-0000-0000-0000-000000000001', 'Dune Florist', 'e1000000-0000-0000-0000-000000000003');

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function _t_sees(p_user uuid, p_ref uuid) returns boolean language plpgsql as $$
declare n int;
begin
  perform _t_act(p_user);
  select count(*) into n from referrals where id = p_ref;
  return n = 1;
end $$;

-- Pure helpers first (no role switch needed, but harmless after).
do $$ begin
  if public.referral_status_for_stage('new') <> 'accepted' then raise exception 'stage new should map to accepted'; end if;
  if public.referral_status_for_stage('contacted') <> 'working' then raise exception 'contacted should map to working'; end if;
  if public.referral_status_for_stage('submitted') <> 'working' then raise exception 'submitted stage should map to working'; end if;
  if public.referral_status_for_stage('won') <> 'won' then raise exception 'won should map to won'; end if;
  if public.referral_status_for_stage('lost') <> 'lost' then raise exception 'lost should map to lost'; end if;
end $$;

do $$ begin
  if not public.profile_can_see_owner('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003') then raise exception 'mgr should see rep1'; end if;
  if public.profile_can_see_owner('e1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000004') then raise exception 'rep1 must not see rep2'; end if;
  if not public.profile_can_see_owner('e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000005') then raise exception 'admin should see rep3'; end if;
  if public.profile_can_see_owner('e1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000006') then raise exception 'deactivated viewer must see nothing'; end if;
end $$;

do $$ begin
  if public.referral_route_assignee('e1a00000-0000-0000-0000-000000000001') <> 'e1000000-0000-0000-0000-000000000003' then raise exception 'P1 should route to its owner rep1'; end if;
  if public.referral_route_assignee('e1a00000-0000-0000-0000-000000000004') <> 'e1000000-0000-0000-0000-000000000002' then raise exception 'P4 (deactivated owner) should route to mgr'; end if;
  if public.referral_route_assignee('e1a00000-0000-0000-0000-000000000005') is not null then raise exception 'P5 (unplaced, no manager) should route to the admin queue (null)'; end if;
end $$;

do $$ begin
  -- 2026-07-17 is a Friday; 2026-07-20 the Monday after.
  if public.next_business_day('2026-07-17', '00000000-0000-0000-0000-0000000000e1') <> '2026-07-20' then raise exception 'Friday should roll to Monday'; end if;
  insert into business_holidays (holiday_date, label, org_id) values ('2026-07-20', 'Test holiday', '00000000-0000-0000-0000-0000000000e1');
  if public.next_business_day('2026-07-17', '00000000-0000-0000-0000-0000000000e1') <> '2026-07-21' then raise exception 'org holiday should be skipped'; end if;
  if public.next_business_day('2026-07-17', '00000000-0000-0000-0000-0000000000e2') <> '2026-07-20' then raise exception 'another org holiday must not apply'; end if;
end $$;

-- org_id is taken from the partner.
do $$ declare v uuid; begin
  select org_id into v from referrals where id = 'e1b00000-0000-0000-0000-000000000004';
  if v <> '00000000-0000-0000-0000-0000000000e1' then raise exception 'org_id should be corrected from the partner, got %', v; end if;
end $$;

-- History row written on insert, actor system (no auth.uid during seed).
do $$ declare n int; t text; a text; begin
  select count(*), max(to_status::text), max(actor_type::text) into n, t, a
    from referral_status_history where referral_id = 'e1b00000-0000-0000-0000-000000000001';
  if n <> 1 or t <> 'submitted' or a <> 'system' then raise exception 'expected 1 system history row to submitted, got % % %', n, t, a; end if;
end $$;

-- Visibility (role switches from here on).
do $$ begin
  if not _t_sees('e1000000-0000-0000-0000-000000000003', 'e1b00000-0000-0000-0000-000000000001') then raise exception 'rep1 should see own partner referral R1'; end if;
  if not _t_sees('e1000000-0000-0000-0000-000000000003', 'e1b00000-0000-0000-0000-000000000002') then raise exception 'rep1 should see R2 as its assignee'; end if;
  if _t_sees('e1000000-0000-0000-0000-000000000004', 'e1b00000-0000-0000-0000-000000000001') then raise exception 'rep2 must not see R1'; end if;
  if not _t_sees('e1000000-0000-0000-0000-000000000002', 'e1b00000-0000-0000-0000-000000000001') then raise exception 'mgr should see R1 (subtree)'; end if;
  if _t_sees('e1000000-0000-0000-0000-000000000002', 'e1b00000-0000-0000-0000-000000000003') then raise exception 'mgr must not see R3 (sibling partner, admin queue)'; end if;
  if not _t_sees('e1000000-0000-0000-0000-000000000001', 'e1b00000-0000-0000-0000-000000000003') then raise exception 'admin should see the admin-queue R3'; end if;
end $$;

-- History visibility follows the referral.
do $$ declare n int; begin
  perform _t_act('e1000000-0000-0000-0000-000000000004');
  select count(*) into n from referral_status_history where referral_id = 'e1b00000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'rep2 must not see R1 history'; end if;
end $$;

-- No direct writes from the app role.
do $$ begin
  perform _t_act('e1000000-0000-0000-0000-000000000003');
  begin
    insert into referrals (org_id, partner_id, company_name) values ('00000000-0000-0000-0000-0000000000e1', 'e1a00000-0000-0000-0000-000000000001', 'Sneaky');
    raise exception 'rep1 direct insert into referrals should be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    update referral_status_history set note = 'x';
    raise exception 'rep1 update of history should be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from referral_status_history;
    raise exception 'rep1 delete of history should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
