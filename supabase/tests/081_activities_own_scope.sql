-- Tests for 20261102000001_activities_own_scope (PRD addendum 6.12.C Bundle 1,
-- FR-ACT-26..32).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/081_activities_own_scope.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture, one org (the 6.12.C acceptance org, trimmed):
--   Ann  administrator
--     Sam  sales manager
--       Rita, Raj  sales professionals
--   Uma  sales professional, not placed in the hierarchy
--
-- Rita owns deal DR and partner PR. Raj owns deal DJ and partner PJ.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-000000000811', 'Own Scope Org', 'own-scope', 'own-scope-a1');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('81100000-0000-0000-0000-00000000000a', 'ann@os.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('81100000-0000-0000-0000-00000000000b', 'sam@os.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('81100000-0000-0000-0000-00000000000c', 'rita@os.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('81100000-0000-0000-0000-00000000000d', 'raj@os.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('81100000-0000-0000-0000-00000000000e', 'uma@os.example',  'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('81100000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000811', 'admin',   'administrator',      'Ann',  'ann@os.example',  'ann'::ltree),
  ('81100000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000811', 'manager', 'sales_manager',      'Sam',  'sam@os.example',  'ann.sam'::ltree),
  ('81100000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000811', 'rep',     'sales_professional', 'Rita', 'rita@os.example', 'ann.sam.rita'::ltree),
  ('81100000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000811', 'rep',     'sales_professional', 'Raj',  'raj@os.example',  'ann.sam.raj'::ltree),
  ('81100000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000811', 'rep',     'sales_professional', 'Uma',  'uma@os.example',  null);

insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('811d0000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000811', '81100000-0000-0000-0000-00000000000c', 'Rita Deal', 'C', 'c@os.example', '+15550008101', 100),
  ('811d0000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000811', '81100000-0000-0000-0000-00000000000d', 'Raj Deal',  'C', 'c@os.example', '+15550008102', 100);

insert into activities (id, org_id, deal_id, logged_by, type, disposition, outcome_notes, occurred_at) values
  ('811a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000811', '811d0000-0000-0000-0000-00000000000c', '81100000-0000-0000-0000-00000000000c', 'call',    'no_answer', 'rita on rita deal', now()),
  ('811a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000811', '811d0000-0000-0000-0000-00000000000c', '81100000-0000-0000-0000-00000000000d', 'drop_in', 'met_dm',    'raj on rita deal',  now()),
  ('811a0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000811', '811d0000-0000-0000-0000-00000000000c', '81100000-0000-0000-0000-00000000000b', 'call',    'no_answer', 'sam on rita deal',  now()),
  ('811a0000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000811', '811d0000-0000-0000-0000-00000000000d', '81100000-0000-0000-0000-00000000000d', 'call',    'no_answer', 'raj on raj deal',   now());

insert into partners (id, org_id, created_by, owner_id, name, company, type, email) values
  ('811b0000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000811', '81100000-0000-0000-0000-00000000000c', '81100000-0000-0000-0000-00000000000c', 'Rita CPA', 'R & Co', 'cpa', 'rcpa@os.example'),
  ('811b0000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000811', '81100000-0000-0000-0000-00000000000d', '81100000-0000-0000-0000-00000000000d', 'Raj CPA',  'J & Co', 'cpa', 'jcpa@os.example');

insert into partner_activities (id, org_id, partner_id, logged_by, type, notes, occurred_at) values
  ('811c0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000811', '811b0000-0000-0000-0000-00000000000d', '81100000-0000-0000-0000-00000000000d', 'call', 'raj touch on raj partner',  now()),
  ('811c0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000811', '811b0000-0000-0000-0000-00000000000c', '81100000-0000-0000-0000-00000000000d', 'call', 'raj touch on rita partner', now()),
  ('811c0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000811', '811b0000-0000-0000-0000-00000000000c', '81100000-0000-0000-0000-00000000000c', 'call', 'rita touch on rita partner', now());

insert into task (id, org_id, owner_id, type, title, deal_id, status, earliest_at, target_at, latest_at, original_target_at) values
  ('81170000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000811', '81100000-0000-0000-0000-00000000000d', 'todo', 'raj personal todo', null, 'open', current_date, current_date, current_date, current_date),
  ('81170000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000811', '81100000-0000-0000-0000-00000000000d', 'call', 'raj deal task', '811d0000-0000-0000-0000-00000000000d', 'open', current_date, current_date, current_date, current_date),
  ('81170000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000811', '81100000-0000-0000-0000-00000000000c', 'call', 'rita deal task', '811d0000-0000-0000-0000-00000000000c', 'open', current_date, current_date, current_date, current_date),
  ('81170000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000811', '81100000-0000-0000-0000-00000000000b', 'todo', 'sam personal todo', null, 'open', current_date, current_date, current_date, current_date);

create or replace function pg_temp.act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.back() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;

-- What a user can read, as one sorted string per table.
create or replace function pg_temp.seen_tasks() returns text language sql as $$
  select coalesce(string_agg(title, ' / ' order by title), '-') from task
   where org_id = '00000000-0000-0000-0000-000000000811'
$$;
create or replace function pg_temp.seen_acts() returns text language sql as $$
  select coalesce(string_agg(outcome_notes, ' / ' order by outcome_notes), '-') from activities
   where org_id = '00000000-0000-0000-0000-000000000811'
$$;
create or replace function pg_temp.seen_touches() returns text language sql as $$
  select coalesce(string_agg(notes, ' / ' order by notes), '-') from partner_activities
   where org_id = '00000000-0000-0000-0000-000000000811'
$$;

-- 1. Tasks are readable by their owner only, at every level (FR-ACT-27, Robert
--    2026-11-02: no manager or administrator exception, personal to-dos included).
do $$ declare v text; begin
  perform pg_temp.act('81100000-0000-0000-0000-00000000000c');  -- Rita
  v := pg_temp.seen_tasks();
  perform pg_temp.back();
  if v <> 'rita deal task' then raise exception 'Rita should read only her own task, read: %', v; end if;

  perform pg_temp.act('81100000-0000-0000-0000-00000000000e');  -- Uma, unplaced
  v := pg_temp.seen_tasks();
  perform pg_temp.back();
  if v <> '-' then raise exception 'Uma owns no task and should read none, read: %', v; end if;

  perform pg_temp.act('81100000-0000-0000-0000-00000000000b');  -- Sam, Rita and Raj's manager
  v := pg_temp.seen_tasks();
  perform pg_temp.back();
  if v <> 'sam personal todo' then raise exception 'Sam should read only his own task, read: %', v; end if;

  perform pg_temp.act('81100000-0000-0000-0000-00000000000a');  -- Ann, administrator
  v := pg_temp.seen_tasks();
  perform pg_temp.back();
  if v <> '-' then raise exception 'Ann owns no task and should read none, read: %', v; end if;

  -- Raj still reads both of his, including the personal to-do with no deal.
  perform pg_temp.act('81100000-0000-0000-0000-00000000000d');
  v := pg_temp.seen_tasks();
  perform pg_temp.back();
  if v <> 'raj deal task / raj personal todo' then raise exception 'Raj should read his two tasks, read: %', v; end if;
end $$;

-- 2. No one but the owner can complete or snooze a task, managers included
--    (Robert 2026-11-02: keep completion locked to the owner).
do $$ declare n int; begin
  perform pg_temp.act('81100000-0000-0000-0000-00000000000c');  -- Rita on Raj's task
  update task set status = 'completed', completed_at = now() where id = '81170000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  perform pg_temp.back();
  if n <> 0 then raise exception 'Rita completed Raj''s task'; end if;

  perform pg_temp.act('81100000-0000-0000-0000-00000000000b');  -- Sam on Raj's to-do
  update task set target_at = current_date + 3 where id = '81170000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  perform pg_temp.back();
  if n <> 0 then raise exception 'Sam snoozed Raj''s to-do'; end if;
end $$;

-- 3. Activities still follow the deal: on her own deal Rita sees every activity,
--    whoever logged it (Robert 2026-11-02 point 4), and nothing on Raj's deal.
--    Uma, unplaced, sees none of it.
do $$ declare v text; begin
  perform pg_temp.act('81100000-0000-0000-0000-00000000000c');
  v := pg_temp.seen_acts();
  perform pg_temp.back();
  if v <> 'raj on rita deal / rita on rita deal / sam on rita deal' then
    raise exception 'Rita should see the full history of her own deal and nothing of Raj''s, saw: %', v;
  end if;

  perform pg_temp.act('81100000-0000-0000-0000-00000000000e');
  v := pg_temp.seen_acts();
  perform pg_temp.back();
  if v <> '-' then raise exception 'Uma should see no activity, saw: %', v; end if;
end $$;

-- 4. Partner touches follow the partner: Rita never sees Raj's touch on Raj's
--    partner (FR-ACT-29); Uma sees none.
do $$ declare v text; begin
  perform pg_temp.act('81100000-0000-0000-0000-00000000000c');
  v := pg_temp.seen_touches();
  perform pg_temp.back();
  if v <> 'raj touch on rita partner / rita touch on rita partner' then
    raise exception 'Rita should see only touches on her own partner, saw: %', v;
  end if;

  perform pg_temp.act('81100000-0000-0000-0000-00000000000e');
  v := pg_temp.seen_touches();
  perform pg_temp.back();
  if v <> '-' then raise exception 'Uma should see no partner touch, saw: %', v; end if;
end $$;

-- 5. A partner touch is edited or deleted only by its author, or a manager/admin
--    over the partner. Rita owns the partner but did not log Raj's touch on it.
do $$ declare n int; begin
  perform pg_temp.act('81100000-0000-0000-0000-00000000000c');
  update partner_activities set notes = 'rewritten' where id = '811c0000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  perform pg_temp.back();
  if n <> 0 then raise exception 'Rita edited Raj''s touch on her partner'; end if;

  perform pg_temp.act('81100000-0000-0000-0000-00000000000c');
  delete from partner_activities where id = '811c0000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  perform pg_temp.back();
  if n <> 0 then raise exception 'Rita deleted Raj''s touch on her partner'; end if;

  -- The author still can, on a partner he can see.
  perform pg_temp.act('81100000-0000-0000-0000-00000000000d');
  update partner_activities set notes = notes where id = '811c0000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  perform pg_temp.back();
  if n <> 1 then raise exception 'Raj could not edit his own touch'; end if;

  -- So can Rita on her own touch, and Sam as their manager on Raj's.
  perform pg_temp.act('81100000-0000-0000-0000-00000000000c');
  update partner_activities set notes = notes where id = '811c0000-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  perform pg_temp.back();
  if n <> 1 then raise exception 'Rita could not edit her own touch'; end if;

  perform pg_temp.act('81100000-0000-0000-0000-00000000000b');
  update partner_activities set notes = notes where id = '811c0000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  perform pg_temp.back();
  if n <> 1 then raise exception 'Sam could not edit a touch under his line'; end if;
end $$;

-- 6. Who logged it cannot be changed by an app user, on an activity or a touch,
--    not even by the author or a manager.
do $$ declare blocked boolean; begin
  blocked := false;
  perform pg_temp.act('81100000-0000-0000-0000-00000000000c');
  begin
    update activities set logged_by = '81100000-0000-0000-0000-00000000000d' where id = '811a0000-0000-0000-0000-000000000001';
  exception when insufficient_privilege then blocked := true;
  end;
  perform pg_temp.back();
  if not blocked then raise exception 'Rita handed her activity to Raj'; end if;

  blocked := false;
  perform pg_temp.act('81100000-0000-0000-0000-00000000000b');
  begin
    update activities set logged_by = '81100000-0000-0000-0000-00000000000b' where id = '811a0000-0000-0000-0000-000000000002';
  exception when insufficient_privilege then blocked := true;
  end;
  perform pg_temp.back();
  if not blocked then raise exception 'Sam took Raj''s activity'; end if;

  blocked := false;
  perform pg_temp.act('81100000-0000-0000-0000-00000000000c');
  begin
    update partner_activities set logged_by = '81100000-0000-0000-0000-00000000000d' where id = '811c0000-0000-0000-0000-000000000003';
  exception when insufficient_privilege then blocked := true;
  end;
  perform pg_temp.back();
  if not blocked then raise exception 'Rita handed her partner touch to Raj'; end if;

  -- Editing anything else on her own activity still works.
  perform pg_temp.act('81100000-0000-0000-0000-00000000000c');
  update activities set outcome_notes = 'rita on rita deal' where id = '811a0000-0000-0000-0000-000000000001';
  perform pg_temp.back();

  if (select logged_by from activities where id = '811a0000-0000-0000-0000-000000000001') <> '81100000-0000-0000-0000-00000000000c' then
    raise exception 'logged_by changed';
  end if;
end $$;

-- 7. Server-side code (security definer, e.g. the demo reset) can still re-home
--    an activity. Here: the migration owner, outside any API role.
do $$ begin
  update activities set logged_by = '81100000-0000-0000-0000-00000000000c' where id = '811a0000-0000-0000-0000-000000000004';
  if (select logged_by from activities where id = '811a0000-0000-0000-0000-000000000004') <> '81100000-0000-0000-0000-00000000000c' then
    raise exception 'server-side code should still be able to change logged_by';
  end if;
end $$;

-- 8. The trigger function is not callable through the API.
do $$ begin
  if has_function_privilege('authenticated', 'public.freeze_logged_by()', 'EXECUTE') then
    raise exception 'authenticated must not execute freeze_logged_by';
  end if;
  if has_function_privilege('anon', 'public.freeze_logged_by()', 'EXECUTE') then
    raise exception 'anon must not execute freeze_logged_by';
  end if;
end $$;

rollback;
