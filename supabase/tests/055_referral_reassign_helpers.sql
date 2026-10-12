-- Tests for 20261016000006_referral_reassign_helpers (Partner Portal Phase 2A, FR-PORT-55).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/055_referral_reassign_helpers.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org ref-assign): boss administrator; Mia Mgr (manager) under boss;
-- Rita Rep under Mia; Rob Rep under boss in another branch; Dee Rep under Mia,
-- deactivated. Partner P1 owned by Rita, P2 owned by Rob. Org ref-assign-b: Bob.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-000000001055', 'Assign Org',   'ref-assign',   'ref-assign-a1'),
  ('00000000-0000-0000-0000-000000001155', 'Assign Org B', 'ref-assign-b', 'ref-assign-b-a1');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0550000-0000-0000-0000-000000000001', 'boss@asg.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0550000-0000-0000-0000-000000000002', 'mia@asg.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0550000-0000-0000-0000-000000000003', 'rita@asg.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0550000-0000-0000-0000-000000000004', 'rob@asg.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0550000-0000-0000-0000-000000000005', 'dee@asg.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('a0550000-0000-0000-0000-000000000006', 'bob@asgb.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('a0550000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001055', 'admin',   'administrator',      'Boss',     'boss@asg.example', 'asgboss'::ltree,          null,                                   null),
  ('a0550000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001055', 'manager', 'sales_manager',      'Mia Mgr',  'mia@asg.example',  'asgboss.mia'::ltree,      'a0550000-0000-0000-0000-000000000001', null),
  ('a0550000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001055', 'rep',     'sales_professional', 'Rita Rep', 'rita@asg.example', 'asgboss.mia.rita'::ltree, 'a0550000-0000-0000-0000-000000000002', null),
  ('a0550000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001055', 'rep',     'sales_professional', 'Rob Rep',  'rob@asg.example',  'asgboss.rob'::ltree,      'a0550000-0000-0000-0000-000000000001', null),
  ('a0550000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000001055', 'rep',     'sales_professional', 'Dee Rep',  'dee@asg.example',  'asgboss.mia.dee'::ltree,  'a0550000-0000-0000-0000-000000000002', now()),
  ('a0550000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000001155', 'admin',   'administrator',      'Bob',      'bob@asgb.example', 'asgbob'::ltree,           null,                                   null);

insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('a055a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001055', 'a0550000-0000-0000-0000-000000000003', 'a0550000-0000-0000-0000-000000000003', 'Jane CPA', 'Jane & Co', 'cpa'),
  ('a055a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001055', 'a0550000-0000-0000-0000-000000000004', 'a0550000-0000-0000-0000-000000000004', 'Pat CPA',  'Pat & Co',  'cpa');

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

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

create or replace function _t_assignees(p_user uuid) returns text[] language plpgsql as $$
declare v text[];
begin
  perform _t_act(p_user);
  select coalesce(array_agg(a.full_name order by a.ord), '{}') into v
    from public.list_referral_assignees() with ordinality as a(user_id, full_name, email, ord);
  return v;
end $$;

-- 1. Privileges (before any role switch).
do $$ begin
  if not has_function_privilege('authenticated', 'public.list_referral_assignees()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.can_user_see_partner(uuid, uuid)', 'EXECUTE') then
    raise exception 'authenticated should execute the reassign helpers';
  end if;
  if has_function_privilege('anon', 'public.list_referral_assignees()', 'EXECUTE')
     or has_function_privilege('anon', 'public.can_user_see_partner(uuid, uuid)', 'EXECUTE') then
    raise exception 'anon must not execute the reassign helpers';
  end if;
end $$;

-- 2. Who can take a referral (role switches from here on).
do $$ declare v text[]; begin
  v := _t_assignees('a0550000-0000-0000-0000-000000000002');
  if v <> array['Mia Mgr', 'Rita Rep'] then raise exception 'a manager sees self and team, active only, got %', v; end if;
  v := _t_assignees('a0550000-0000-0000-0000-000000000001');
  if v <> array['Boss', 'Mia Mgr', 'Rita Rep', 'Rob Rep'] then raise exception 'an admin sees every active member, got %', v; end if;
  v := _t_assignees('a0550000-0000-0000-0000-000000000003');
  if v <> '{}'::text[] then raise exception 'a rep gets nobody, got %', v; end if;
  v := _t_assignees('a0550000-0000-0000-0000-000000000006');
  if v <> array['Bob'] then raise exception 'another org sees only its own, got %', v; end if;
end $$;

-- 3. Can the new owner see the partner?
do $$ begin
  perform _t_act('a0550000-0000-0000-0000-000000000001');
  if public.can_user_see_partner('a0550000-0000-0000-0000-000000000004', 'a055a000-0000-0000-0000-000000000001') then
    raise exception 'Rob cannot see Rita''s partner';
  end if;
  if not public.can_user_see_partner('a0550000-0000-0000-0000-000000000002', 'a055a000-0000-0000-0000-000000000001') then
    raise exception 'Mia can see her rep''s partner';
  end if;
  if not public.can_user_see_partner('a0550000-0000-0000-0000-000000000003', 'a055a000-0000-0000-0000-000000000001') then
    raise exception 'Rita can see her own partner';
  end if;
  if not public.can_user_see_partner('a0550000-0000-0000-0000-000000000001', 'a055a000-0000-0000-0000-000000000002') then
    raise exception 'an admin can see every partner';
  end if;

  perform _t_act('a0550000-0000-0000-0000-000000000002');
  if not public.can_user_see_partner('a0550000-0000-0000-0000-000000000003', 'a055a000-0000-0000-0000-000000000001') then
    raise exception 'Mia asks about Rita and P1';
  end if;
  perform _t_raises($q$select public.can_user_see_partner('a0550000-0000-0000-0000-000000000003', 'a055a000-0000-0000-0000-000000000002')$q$, 'partner_not_visible');
  perform _t_raises($q$select public.can_user_see_partner('a0550000-0000-0000-0000-000000000004', 'a055a000-0000-0000-0000-000000000001')$q$, 'not_authorized');
  perform _t_raises($q$select public.can_user_see_partner('a0550000-0000-0000-0000-000000000006', 'a055a000-0000-0000-0000-000000000001')$q$, 'not_authorized');

  perform _t_act('a0550000-0000-0000-0000-000000000006');
  perform _t_raises($q$select public.can_user_see_partner('a0550000-0000-0000-0000-000000000003', 'a055a000-0000-0000-0000-000000000001')$q$, 'partner_not_visible');
end $$;

rollback;
