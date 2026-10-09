-- Tests for 20261007000003 referral RPCs. Self-cleans via ROLLBACK.
--
-- Fixture (org RP): boss admin; mgr sales_manager boss.mgr; rep1 boss.mgr.rep1
-- owns partner P1 and deal DX (an existing open deal); rep2 boss.mgr.rep2 owns
-- partner P2 and deal D2. DUP is an active deal owned by rep2 whose name and
-- address collide with a referral rep1 will try to accept.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000e4', 'Referral RPCs', 'ref-rpc', 'ref-rpc-a1');
insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('e4000000-0000-0000-0000-000000000001', 'boss@rp.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('e4000000-0000-0000-0000-000000000002', 'mgr@rp.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('e4000000-0000-0000-0000-000000000003', 'rep1@rp.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('e4000000-0000-0000-0000-000000000004', 'rep2@rp.example', 'authenticated', 'authenticated', now(), now(), now());
insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('e4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e4', 'admin',   'administrator',      'Boss', 'boss@rp.example', 'boss'::ltree,          null),
  ('e4000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e4', 'manager', 'sales_manager',      'Mgr',  'mgr@rp.example',  'boss.mgr'::ltree,      'e4000000-0000-0000-0000-000000000001'),
  ('e4000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e4', 'rep',     'sales_professional', 'Rep1', 'rep1@rp.example', 'boss.mgr.rep1'::ltree, 'e4000000-0000-0000-0000-000000000002'),
  ('e4000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000e4', 'rep',     'sales_professional', 'Rep2', 'rep2@rp.example', 'boss.mgr.rep2'::ltree, 'e4000000-0000-0000-0000-000000000002');
insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('e4a00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e4', 'e4000000-0000-0000-0000-000000000003', 'e4000000-0000-0000-0000-000000000003', 'Jane CPA', 'Jane & Co', 'cpa'),
  ('e4a00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e4', 'e4000000-0000-0000-0000-000000000004', 'e4000000-0000-0000-0000-000000000004', 'Rep2 CPA', 'R2 & Co',   'cpa');
insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('e4d00000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e4', 'e4000000-0000-0000-0000-000000000003', 'Existing Co', '1 Main St', 'C', 'x@rp.example', '+15550004001', 100, 'contacted', 'path'),
  ('e4d00000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e4', 'e4000000-0000-0000-0000-000000000004', 'Rep2 Co',     '2 Main St', 'C', 'y@rp.example', '+15550004002', 100, 'new',       'path'),
  ('e4d00000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e4', 'e4000000-0000-0000-0000-000000000004', 'Twin Cafe',   '9 Elm St',  'C', 'z@rp.example', '+15550004003', 100, 'new',       'path');


-- Extra fixtures (seeded as postgres, before any role switch):
--  rep3: a DEACTIVATED report of mgr, assignee of referral 'deact'.
--  OTH: another org with its own partner and a submitted referral 'foreign'.
--  'mgrlog': referral logged on P1 but assigned to mgr (rep1 sees it through
--  partner visibility yet cannot triage it).
insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('e4000000-0000-0000-0000-000000000005', 'rep3@rp.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('e4000000-0000-0000-0000-000000000006', 'oth@rp.example',  'authenticated', 'authenticated', now(), now(), now());
insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000e5', 'Other Org', 'ref-rpc-other', 'ref-rpc-b1');
insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id, deactivated_at) values
  ('e4000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000e4', 'rep', 'sales_professional', 'Rep3', 'rep3@rp.example', 'boss.mgr.rep3'::ltree, 'e4000000-0000-0000-0000-000000000002', now());
insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('e4000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000e5', 'admin', 'administrator', 'Oth', 'oth@rp.example', 'oth'::ltree, null);
insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('e5a00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e5', 'e4000000-0000-0000-0000-000000000006', 'e4000000-0000-0000-0000-000000000006', 'Other CPA', 'Other & Co', 'cpa');
insert into referrals (id, org_id, partner_id, company_name, assigned_user_id) values
  ('e4f00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e5', 'e5a00000-0000-0000-0000-000000000001', 'Foreign Co', 'e4000000-0000-0000-0000-000000000006'),
  ('e4f00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e4', 'e4a00000-0000-0000-0000-000000000001', 'Deact Co', 'e4000000-0000-0000-0000-000000000005'),
  ('e4f00000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e4', 'e4a00000-0000-0000-0000-000000000001', 'Mgr Owned Co', 'e4000000-0000-0000-0000-000000000002');

create temp table _exp (exp_d date);
insert into _exp select public.next_business_day(current_date, '00000000-0000-0000-0000-0000000000e4');
grant select on _exp to authenticated;

create or replace function _t_act(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Scratch table to carry ids between DO blocks (created before any role switch).
create temp table _ids (k text primary key, v uuid);
grant all on _ids to authenticated;

-- 1. log_referral: rep1 logs a referral from own partner -> submitted, assigned to rep1.
do $$ declare r uuid; s text; a uuid; snap text; begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  r := public.log_referral('e4a00000-0000-0000-0000-000000000001', 'Fresh Bakery', 'Ann', 'ann@fresh.example', '+15550004100', '5 Oak St');
  insert into _ids values ('fresh', r);
  select status::text, assigned_user_id, partner_company_snapshot into s, a, snap from referrals where id = r;
  if s <> 'submitted' or a <> 'e4000000-0000-0000-0000-000000000003' or snap <> 'Jane & Co' then
    raise exception 'log_referral wrong state: % % %', s, a, snap;
  end if;
end $$;

-- 2. log_referral on a partner rep1 cannot see is refused.
do $$ begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  begin
    perform public.log_referral('e4a00000-0000-0000-0000-000000000002', 'Nope Co');
    raise exception 'logging against an invisible partner should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. accept_referral: creates a NEW deal with lead_source partner_referral, links it,
--    status accepted, one open call task due next business day owned by rep1.
do $$ declare res jsonb; d uuid; ls text; st text; t int; due date; src uuid; begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  res := public.accept_referral((select v from _ids where k = 'fresh'));
  if res->>'result' <> 'accepted' then raise exception 'accept result %', res; end if;
  d := (res->>'deal_id')::uuid;
  select lead_source, stage::text, source_partner_id into ls, st, src from deals where id = d;
  if ls <> 'partner_referral' or st <> 'new' or src <> 'e4a00000-0000-0000-0000-000000000001' then
    raise exception 'accepted deal wrong: % % %', ls, st, src;
  end if;
  if (select status::text from referrals where id = (select v from _ids where k = 'fresh')) <> 'accepted' then
    raise exception 'referral should be accepted';
  end if;
  select count(*), max(target_at) into t, due from task where deal_id = d and type = 'call' and status = 'open'
    and owner_id = 'e4000000-0000-0000-0000-000000000003';
  if t <> 1 or due <> (select exp_d from _exp) then
    raise exception 'expected one call task due next business day, got % %', t, due;
  end if;
end $$;

-- 4. Accepting twice is refused.
do $$ begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  begin
    perform public.accept_referral((select v from _ids where k = 'fresh'));
    raise exception 'second accept should fail';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- 5. Accept that collides with an active deal returns duplicate. rep1 cannot see
--    rep2's Twin Cafe, so deal_id comes back null; nothing is created.
do $$ declare r uuid; res jsonb; n int; begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  r := public.log_referral('e4a00000-0000-0000-0000-000000000001', 'Twin Cafe', null, null, null, '9 Elm St');
  insert into _ids values ('twin', r);
  res := public.accept_referral(r);
  if res->>'result' <> 'duplicate' then raise exception 'expected duplicate, got %', res; end if;
  if res->>'deal_id' is not null then raise exception 'invisible duplicate must not be disclosed: %', res; end if;
  perform set_config('role', 'postgres', true);
  select count(*) into n from deals where company_name = 'Twin Cafe';
  if n <> 1 then raise exception 'duplicate accept must not create a deal'; end if;
  if (select status::text from referrals where id = r) <> 'submitted' then raise exception 'duplicate accept must leave status submitted'; end if;
end $$;

-- 6. decline_referral needs a reason; records it and the note in history.
do $$ declare st text; reason text; note text; begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  perform public.decline_referral((select v from _ids where k = 'twin'), 'duplicate', 'Rep2 already has it');
  select status::text, decline_reason::text into st, reason from referrals where id = (select v from _ids where k = 'twin');
  if st <> 'declined' or reason <> 'duplicate' then raise exception 'decline wrong: % %', st, reason; end if;
  select h.note into note from referral_status_history h
   where h.referral_id = (select v from _ids where k = 'twin') and h.to_status = 'declined';
  if note <> 'Rep2 already has it' then raise exception 'decline note not in history: %', note; end if;
end $$;

-- 7. merge_referral into a deal already past New lands in working with two history
--    rows (accepted, then working) and leaves lead_source alone.
do $$ declare r uuid; st text; ls text; n int; begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  r := public.log_referral('e4a00000-0000-0000-0000-000000000001', 'Existing Co');
  perform public.merge_referral(r, 'e4d00000-0000-0000-0000-0000000000a1');
  select status::text into st from referrals where id = r;
  select lead_source into ls from deals where id = 'e4d00000-0000-0000-0000-0000000000a1';
  select count(*) into n from referral_status_history where referral_id = r and to_status in ('accepted','working');
  if st <> 'working' or ls <> 'path' or n <> 2 then raise exception 'merge wrong: % % %', st, ls, n; end if;
end $$;

-- 8. merge into a deal rep1 cannot see is refused.
do $$ declare r uuid; begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  r := public.log_referral('e4a00000-0000-0000-0000-000000000001', 'Peek Co');
  insert into _ids values ('peek', r);
  begin
    perform public.merge_referral(r, 'e4d00000-0000-0000-0000-0000000000a2');
    raise exception 'merge into invisible deal should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 9. withdraw_referral works on a non-terminal referral, refuses a terminal one.
do $$ begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  perform public.withdraw_referral((select v from _ids where k = 'peek'), 'Partner asked');
  if (select status::text from referrals where id = (select v from _ids where k = 'peek')) <> 'withdrawn' then
    raise exception 'withdraw failed';
  end if;
  begin
    perform public.withdraw_referral((select v from _ids where k = 'peek'));
    raise exception 'withdrawing a withdrawn referral should fail';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- 10. rep2 cannot triage rep1's referral.
do $$ declare r uuid; begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  r := public.log_referral('e4a00000-0000-0000-0000-000000000001', 'Guarded Co');
  insert into _ids values ('guarded', r);
  perform _t_act('e4000000-0000-0000-0000-000000000004');
  begin
    perform public.decline_referral(r, 'outside_icp');
    raise exception 'rep2 declining rep1 referral should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 11. reassign: mgr moves rep1's referral to rep2; returns false because rep2
--     cannot see partner P1. rep1 (not a manager) cannot reassign.
do $$ declare ok boolean; begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  begin
    perform public.reassign_referral((select v from _ids where k = 'guarded'), 'e4000000-0000-0000-0000-000000000004');
    raise exception 'rep reassign should fail';
  exception when insufficient_privilege then null;
  end;
  perform _t_act('e4000000-0000-0000-0000-000000000002');
  ok := public.reassign_referral((select v from _ids where k = 'guarded'), 'e4000000-0000-0000-0000-000000000004');
  if ok then raise exception 'rep2 cannot see P1, so reassign should return false'; end if;
  if (select assigned_user_id from referrals where id = (select v from _ids where k = 'guarded')) <> 'e4000000-0000-0000-0000-000000000004' then
    raise exception 'reassign did not move the referral';
  end if;
end $$;

-- 12. attribute / refer / remove keep the old partner page working.
do $$ declare a uuid; o uuid; st text; n int; begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  a := public.attribute_deal_to_partner('e4a00000-0000-0000-0000-000000000001', 'e4d00000-0000-0000-0000-0000000000a1', 'met at chamber');
  -- 'Existing Co' already has a live inbound link from step 7, so a fresh
  -- attribution of the same pair is refused.
  raise exception 'duplicate attribution should have failed';
exception when unique_violation then null;
end $$;

do $$ declare o uuid; st text; n int; begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  o := public.refer_deal_to_partner('e4a00000-0000-0000-0000-000000000001', 'e4d00000-0000-0000-0000-0000000000a1');
  select status::text into st from referrals where id = o;
  if st <> 'working' then raise exception 'outbound referral should mirror the contacted deal as working, got %', st; end if;
  perform public.remove_referral_link('e4a00000-0000-0000-0000-000000000001', 'e4d00000-0000-0000-0000-0000000000a1', 'outbound');
  select status::text into st from referrals where id = o;
  if st <> 'withdrawn' then raise exception 'outbound link should be withdrawn, got %', st; end if;
  select count(*) into n from referral_status_history
   where referral_id = o and to_status = 'withdrawn' and note = 'Link removed';
  if n <> 1 then raise exception 'expected one Link removed history row, got %', n; end if;
  select count(*) into n from referrals where partner_id = 'e4a00000-0000-0000-0000-000000000001'
    and deal_id = 'e4d00000-0000-0000-0000-0000000000a1' and direction = 'inbound' and status = 'working';
  if n <> 1 then raise exception 'merged inbound referral must be untouched, found % working', n; end if;
  perform _t_act('e4000000-0000-0000-0000-000000000004');
  begin
    perform public.remove_referral_link('e4a00000-0000-0000-0000-000000000001', 'e4d00000-0000-0000-0000-0000000000a1', 'inbound');
    raise exception 'rep2 removing rep1 link should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 14. can_triage computed field: rep1 sees the mgr-assigned referral (partner P1
--     is theirs) but cannot triage it; mgr can.
do $$ declare t boolean; begin
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  select public.can_triage(r) into t from referrals r where id = 'e4f00000-0000-0000-0000-000000000003';
  if t is null then raise exception 'rep1 should see the mgr-assigned referral via partner visibility'; end if;
  if t then raise exception 'rep1 must not be able to triage a mgr-assigned referral'; end if;
  perform _t_act('e4000000-0000-0000-0000-000000000002');
  select public.can_triage(r) into t from referrals r where id = 'e4f00000-0000-0000-0000-000000000003';
  if t is not true then raise exception 'mgr should be able to triage it'; end if;
end $$;

-- 15. Attributing a deal with a blank company name succeeds as 'Unnamed business'.
do $$ declare o uuid; n text; begin
  perform set_config('role', 'postgres', true);
  insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
    ('e4d00000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000e4', 'e4000000-0000-0000-0000-000000000003', '  ', '4 Blank St', 'C', 'b@rp.example', '+15550004004', 100, 'new', 'path');
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  o := public.attribute_deal_to_partner('e4a00000-0000-0000-0000-000000000001', 'e4d00000-0000-0000-0000-0000000000a4');
  select company_name into n from referrals where id = o;
  if n <> 'Unnamed business' then raise exception 'blank company should become Unnamed business, got %', n; end if;
end $$;

-- 16. accept_referral with a deactivated assignee: the accepter (mgr) owns the deal and task.
do $$ declare res jsonb; d uuid; do_ uuid; to_ uuid; begin
  perform _t_act('e4000000-0000-0000-0000-000000000002');
  res := public.accept_referral('e4f00000-0000-0000-0000-000000000002');
  if res->>'result' <> 'accepted' then raise exception 'accept result %', res; end if;
  d := (res->>'deal_id')::uuid;
  select owner_id into do_ from deals where id = d;
  select owner_id into to_ from task where deal_id = d;
  if do_ <> 'e4000000-0000-0000-0000-000000000002' or to_ <> 'e4000000-0000-0000-0000-000000000002' then
    raise exception 'deactivated assignee must not own the deal/task: % %', do_, to_;
  end if;
end $$;

-- 17. decline_referral on another org's referral is not found (P0002).
do $$ begin
  perform _t_act('e4000000-0000-0000-0000-000000000002');
  begin
    perform public.decline_referral('e4f00000-0000-0000-0000-000000000001', 'outside_icp');
    raise exception 'cross-org decline should fail';
  exception when no_data_found then null;
  end;
end $$;

-- 18. Source attribution is locked against direct client writes, but the
--     referral RPCs (definer) still set it (case 3).
do $$ begin
  perform set_config('role', 'postgres', true);
  insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
    ('e4d00000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000e4', 'e4000000-0000-0000-0000-000000000003', 'Plain Co', '5 Plain St', 'C', 'p@rp.example', '+15550004005', 100, 'new', 'path');
  perform _t_act('e4000000-0000-0000-0000-000000000003');
  begin
    -- a1 already carries P1 (set by the merge in case 7), so clearing it is a change.
    update deals set source_partner_id = null
     where id = 'e4d00000-0000-0000-0000-0000000000a1';
    raise exception 'rewriting source_partner_id should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    update deals set source_partner_id = 'e4a00000-0000-0000-0000-000000000001'
     where id = 'e4d00000-0000-0000-0000-0000000000a5';
    raise exception 'forging source_partner_id should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into deals (org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source, source_partner_id)
    values ('00000000-0000-0000-0000-0000000000e4', 'e4000000-0000-0000-0000-000000000003', 'Forged Co', '8 Forge St', 'C', 'f@rp.example', '+15550004008', 100, 'new', 'path', 'e4a00000-0000-0000-0000-000000000001');
    raise exception 'inserting with source_partner_id should fail';
  exception when insufficient_privilege then null;
  end;
  update deals set company_name = 'Existing Co 2' where id = 'e4d00000-0000-0000-0000-0000000000a1';
end $$;

-- 13. Anonymous callers cannot execute the RPCs. Checked through the privilege
--     catalog rather than by calling: on the local Postgres 17.6 image, any
--     function-level "permission denied" segfaults the server (reproduced with a
--     trivial revoked function), so an actual anon call would crash the test run.
do $$ declare f text; begin
  perform set_config('role', 'postgres', true);
  foreach f in array array[
    'public.log_referral(uuid,text,text,text,text,text,text,text,text)',
    'public.attribute_deal_to_partner(uuid,uuid,text)',
    'public.refer_deal_to_partner(uuid,uuid,text)',
    'public.remove_referral_link(uuid,uuid,text)',
    'public.accept_referral(uuid)',
    'public.decline_referral(uuid,referral_decline_reason,text)',
    'public.merge_referral(uuid,uuid)',
    'public.withdraw_referral(uuid,text)',
    'public.reassign_referral(uuid,uuid)',
    'public.can_triage(referrals)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'anon must not execute %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'authenticated must execute %', f;
    end if;
  end loop;
  foreach f in array array[
    'public._referral_for_update(uuid)',
    'public._referral_set_note(text)',
    'public._link_deal_to_partner(uuid,uuid,text,text)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'internal helper % must not be executable by anon/authenticated', f;
    end if;
  end loop;
end $$;

rollback;
