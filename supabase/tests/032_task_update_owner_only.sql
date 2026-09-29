-- Tests for 20260928000002: task_update is owner-only, and the one legitimate
-- cross-owner write goes through cancel_contact_tasks_for_deal.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/032_task_update_owner_only.sql
--
-- Self-cleans via ROLLBACK. The history this pins: task_update used to be
-- `using (org_id = user_org_id())` with no owner predicate and no WITH CHECK,
-- so ANY member of an org could complete, snooze or cancel ANY task in it, and
-- could rewrite owner_id. A production sweep on 2026-09-28 found 11 tasks
-- closed by someone other than their owner, four of them belonging to one rep
-- at the beta ISO and all due the next day.
--
-- Fixture, one org (cross-org scoping is covered elsewhere; the hole here was
-- WITHIN a tenant):
--   boss  (administrator)  -- must get no exception: Robert's spec allows none
--   rep1  (sales rep)      -- owns deal D and tasks T_CALL, T_DROPIN
--   rep2  (sales rep)      -- owns nothing; the would-be intruder

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000f2', 'Task Owner Scope', 'task-owner-scope', 'task-owner-a1');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('f2000000-0000-0000-0000-000000000001', 'boss@to.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('f2000000-0000-0000-0000-000000000002', 'rep1@to.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('f2000000-0000-0000-0000-000000000003', 'rep2@to.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('f2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 'admin', 'administrator',      'Boss', 'boss@to.example', 'boss'::ltree),
  ('f2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f2', 'rep',   'sales_professional', 'Rep1', 'rep1@to.example', 'boss.rep1'::ltree),
  ('f2000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000f2', 'rep',   'sales_professional', 'Rep2', 'rep2@to.example', 'boss.rep2'::ltree);

insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('f2d00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 'f2000000-0000-0000-0000-000000000002', 'Bluefrog Plumbing', 'C', 'c@to.example', '+15550009001', 12345);

-- rep1's tasks. Both open, both on rep1's own deal.
insert into task (id, org_id, owner_id, type, title, deal_id, status, earliest_at, target_at, latest_at, original_target_at) values
  ('f2700000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 'f2000000-0000-0000-0000-000000000002', 'call',    'Bluefrog Plumbing', 'f2d00000-0000-0000-0000-000000000001', 'open', current_date, current_date, current_date, current_date),
  ('f2700000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f2', 'f2000000-0000-0000-0000-000000000002', 'drop_in', 'Bluefrog Plumbing', 'f2d00000-0000-0000-0000-000000000001', 'open', current_date, current_date, current_date, current_date);

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- 1. A COLLEAGUE cannot complete rep1's task. The update must affect 0 rows
--    (RLS filters it out rather than raising).
do $$
declare n int;
begin
  perform _t_act('f2000000-0000-0000-0000-000000000003');  -- rep2
  update task set status = 'completed', completed_at = now()
   where id = 'f2700000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'rep2 completed rep1 task (% rows)', n; end if;
end $$;

-- 2. NOR CAN AN ADMINISTRATOR. The spec allows no role exceptions here, and the
--    admin short-circuit inside user_can_see_owner must not leak into writes.
do $$
declare n int;
begin
  perform _t_act('f2000000-0000-0000-0000-000000000001');  -- boss
  update task set status = 'cancelled', cancelled_at = now()
   where id = 'f2700000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'administrator cancelled a rep task (% rows)', n; end if;
end $$;

-- 3. A colleague cannot SNOOZE one either (the other write the UI offers).
do $$
declare n int;
begin
  perform _t_act('f2000000-0000-0000-0000-000000000003');
  update task set target_at = current_date + 7 where id = 'f2700000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'rep2 snoozed rep1 task (% rows)', n; end if;
end $$;

-- 4. Nobody can hand a task to someone else. This is the WITH CHECK half: rep1
--    passes the USING clause on their own row, but the post-image must still be
--    owned by them, so the reassignment is refused.
do $$
declare blocked boolean := false; n int;
begin
  perform _t_act('f2000000-0000-0000-0000-000000000002');  -- rep1, the owner
  begin
    update task set owner_id = 'f2000000-0000-0000-0000-000000000003'
     where id = 'f2700000-0000-0000-0000-000000000001';
    get diagnostics n = row_count;
    if n > 0 then raise exception 'rep1 handed their task to rep2'; end if;
    blocked := true;  -- 0 rows is also an acceptable refusal
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'owner_id rewrite was not refused'; end if;
end $$;

-- 5. Positive control. If the gate wrongly blocked the OWNER, everything above
--    would pass for the wrong reason.
do $$
declare n int;
begin
  perform _t_act('f2000000-0000-0000-0000-000000000002');  -- rep1
  update task set status = 'completed', completed_at = now()
   where id = 'f2700000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'rep1 could not complete their OWN task (% rows)', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- The named exception: cancel_contact_tasks_for_deal
-- ---------------------------------------------------------------------------

-- 6. It REFUSES while the deal is not flagged. This is what stops it being a
--    general "cancel anyone's task" capability handed back to the client.
do $$
declare blocked boolean := false;
begin
  perform _t_act('f2000000-0000-0000-0000-000000000003');  -- rep2
  begin
    perform public.cancel_contact_tasks_for_deal('f2d00000-0000-0000-0000-000000000001', 'call');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'RPC cancelled tasks on an unflagged deal'; end if;
end $$;

-- 7. Once the merchant IS marked do-not-call, a colleague's open call task goes,
--    whoever owns it. Leaving it open would have someone ring a merchant who
--    just asked not to be rung.
do $$
declare n int; remaining int;
begin
  -- Re-open rep1's call task (step 5 completed it) as the owner.
  perform _t_act('f2000000-0000-0000-0000-000000000002');
  update task set status = 'open', completed_at = null
   where id = 'f2700000-0000-0000-0000-000000000001';

  -- The ADMIN flags the merchant, then cancels through the RPC. Deliberately
  -- the admin and not rep2: deals_update needs ownership or a manager/admin
  -- role, so a plain colleague could not have reached this deal at all. It also
  -- mirrors the real 2026-09-21 incident, where an administrator was the one
  -- working a rep's accounts.
  perform _t_act('f2000000-0000-0000-0000-000000000001');
  update deals set do_not_call = true where id = 'f2d00000-0000-0000-0000-000000000001';
  select public.cancel_contact_tasks_for_deal('f2d00000-0000-0000-0000-000000000001', 'call') into n;
  if n <> 1 then raise exception 'RPC should have cancelled rep1 open call task, cancelled %', n; end if;

  -- And ONLY the call channel: rep1's drop-in is untouched.
  select count(*) into remaining from task
   where id = 'f2700000-0000-0000-0000-000000000002' and status = 'open';
  if remaining <> 1 then raise exception 'RPC cancelled a drop_in task it should not have'; end if;
end $$;

-- 8. It rejects a channel it does not understand rather than doing something
--    surprising.
do $$
declare blocked boolean := false;
begin
  perform _t_act('f2000000-0000-0000-0000-000000000003');
  begin
    perform public.cancel_contact_tasks_for_deal('f2d00000-0000-0000-0000-000000000001', 'drop_in');
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 'RPC accepted an unsupported channel'; end if;
end $$;

rollback;
