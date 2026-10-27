-- Tests for 20261012000005_accept_referral_override (Partner Portal Phase 1B)
-- and 20261027000003_merge_referral_override (merging a flagged referral needs
-- a reason; the first partner keeps credit).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/044_accept_referral_override.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org accept-override): boss administrator; rep1 boss.rep1 owns partner P1
-- and deal DX. Referrals assigned to rep1: F flagged against DX, N unflagged,
-- G flagged against N.
-- Merge fixture: partner P2 (portal user active) and deals DA (credited to P1)
-- and DN (no partner). P2's referrals: M flagged (plain merge refused), H flagged
-- against DA, K flagged against DN, L flagged (long reason). P1's referral S is
-- flagged against DA (same partner).

begin;

insert into organizations (id, name, slug, invite_code, portal_enabled) values
  ('00000000-0000-0000-0000-000000001044', 'Accept Override Org', 'accept-override', 'accept-override-a1', true);

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('a0440000-0000-0000-0000-000000000001', 'boss@ao.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('a0440000-0000-0000-0000-000000000002', 'rep1@ao.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, role_level, full_name, email, role_path, manager_id) values
  ('a0440000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001044', 'admin', 'administrator',      'Boss', 'boss@ao.example', 'aoboss'::ltree,      null),
  ('a0440000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001044', 'rep',   'sales_professional', 'Rep1', 'rep1@ao.example', 'aoboss.rep1'::ltree, 'a0440000-0000-0000-0000-000000000001');

insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('a044a000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001044', 'a0440000-0000-0000-0000-000000000002', 'a0440000-0000-0000-0000-000000000002', 'Jane CPA', 'Jane & Co', 'cpa');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source) values
  ('a044d000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001044', 'a0440000-0000-0000-0000-000000000002', 'Existing Spot', '1 First St', 'C', 'x@ao.example', '5550440001', 100, 'contacted', 'path');

insert into referrals (id, org_id, partner_id, source, company_name, address, contact_name, assigned_user_id, duplicate_of_deal_id, duplicate_of_referral_id) values
  ('a044f000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000001', 'portal_signed_in', 'Second Spot', '77 New Rd',   'Ann', 'a0440000-0000-0000-0000-000000000002', 'a044d000-0000-0000-0000-000000000001', null),
  ('a044f000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000001', 'portal_signed_in', 'Plain Co',    '88 Plain Rd', 'Bob', 'a0440000-0000-0000-0000-000000000002', null, null),
  ('a044f000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000001', 'portal_signed_in', 'Third Spot',  '99 Third Rd', 'Cy',  'a0440000-0000-0000-0000-000000000002', null, 'a044f000-0000-0000-0000-000000000002'),
  ('a044f000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000001', 'portal_signed_in', 'Existing Spot', '1 First St', 'Di', 'a0440000-0000-0000-0000-000000000002', 'a044d000-0000-0000-0000-000000000001', null);

insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('a044a000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001044', 'a0440000-0000-0000-0000-000000000002', 'a0440000-0000-0000-0000-000000000002', 'Bob Broker', 'Bob LLC', 'other');

insert into portal_users (id, org_id, partner_id, email, status) values
  ('a044b000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000002', 'bob@ao.example', 'active');

insert into deals (id, org_id, owner_id, company_name, address, contact_name, contact_email, contact_phone, value_cents, stage, lead_source, source_partner_id) values
  ('a044d000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000001044', 'a0440000-0000-0000-0000-000000000002', 'Credit Spot', '2 Credit St', 'C', 'c@ao.example', '5550440002', 100, 'contacted', 'partner_referral', 'a044a000-0000-0000-0000-000000000001'),
  ('a044d000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000001044', 'a0440000-0000-0000-0000-000000000002', 'Open Spot',   '3 Open St',   'C', 'o@ao.example', '5550440003', 100, 'contacted', 'path',             null);

insert into referrals (id, org_id, partner_id, source, company_name, address, contact_name, assigned_user_id, duplicate_of_deal_id) values
  ('a044f000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000002', 'portal_signed_in', 'Credit Spot', '2 Credit St', 'Mo', 'a0440000-0000-0000-0000-000000000002', 'a044d000-0000-0000-0000-00000000000a'),
  ('a044f000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000002', 'portal_signed_in', 'Credit Spot', '2 Credit St', 'Hu', 'a0440000-0000-0000-0000-000000000002', 'a044d000-0000-0000-0000-00000000000a'),
  ('a044f000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000002', 'portal_signed_in', 'Open Spot',   '3 Open St',   'Ky', 'a0440000-0000-0000-0000-000000000002', 'a044d000-0000-0000-0000-00000000000b'),
  ('a044f000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000002', 'portal_signed_in', 'Long Spot',   '4 Long St',   'Lu', 'a0440000-0000-0000-0000-000000000002', 'a044d000-0000-0000-0000-00000000000b'),
  ('a044f000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000001044', 'a044a000-0000-0000-0000-000000000001', 'portal_signed_in', 'Credit Spot', '2 Credit St', 'Su', 'a0440000-0000-0000-0000-000000000002', 'a044d000-0000-0000-0000-00000000000a');

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

-- Privileges.
do $$ begin
  if not has_function_privilege('authenticated', 'public.accept_referral_override(uuid, text)', 'EXECUTE') then
    raise exception 'authenticated should execute accept_referral_override';
  end if;
  if has_function_privilege('anon', 'public.accept_referral_override(uuid, text)', 'EXECUTE') then
    raise exception 'anon must not execute accept_referral_override';
  end if;
  if not has_function_privilege('authenticated', 'public.accept_referral(uuid)', 'EXECUTE') then
    raise exception 'authenticated should still execute accept_referral';
  end if;
  if has_function_privilege('anon', 'public.accept_referral(uuid)', 'EXECUTE') then
    raise exception 'anon must not execute accept_referral';
  end if;
  if not has_function_privilege('authenticated', 'public.merge_referral_override(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'authenticated should execute merge_referral_override';
  end if;
  if has_function_privilege('anon', 'public.merge_referral_override(uuid, uuid, text)', 'EXECUTE') then
    raise exception 'anon must not execute merge_referral_override';
  end if;
  if not has_function_privilege('authenticated', 'public.merge_referral(uuid, uuid)', 'EXECUTE') then
    raise exception 'authenticated should still execute merge_referral';
  end if;
  if has_function_privilege('anon', 'public.merge_referral(uuid, uuid)', 'EXECUTE') then
    raise exception 'anon must not execute merge_referral';
  end if;
end $$;

-- 1. A flagged referral refuses a plain accept and a blank reason (role switches from here on).
do $$ begin
  perform _t_act('a0440000-0000-0000-0000-000000000002');
  perform _t_raises($q$select public.accept_referral('a044f000-0000-0000-0000-000000000001')$q$, 'override_reason_required');
  perform _t_raises($q$select public.accept_referral('a044f000-0000-0000-0000-000000000003')$q$, 'override_reason_required');
  perform _t_raises($q$select public.accept_referral_override('a044f000-0000-0000-0000-000000000001', '   ')$q$, 'override_reason_required');
  if (select status from referrals where id = 'a044f000-0000-0000-0000-000000000001') <> 'submitted' then
    raise exception 'a refused accept must leave the referral submitted';
  end if;
end $$;

-- 2. With a reason it is accepted and the reason is in the history note.
do $$ declare res jsonb; h record; begin
  perform _t_act('a0440000-0000-0000-0000-000000000002');
  res := public.accept_referral_override('a044f000-0000-0000-0000-000000000001', '  Different location  ');
  if res->>'result' is distinct from 'accepted' or res->>'deal_id' is null then
    raise exception 'override should accept, got %', res;
  end if;
  if (select status from referrals where id = 'a044f000-0000-0000-0000-000000000001') <> 'accepted' then
    raise exception 'F should be accepted';
  end if;
  select * into h from referral_status_history
   where referral_id = 'a044f000-0000-0000-0000-000000000001' and to_status = 'accepted';
  if h.note is distinct from 'Accepted despite possible duplicate: Different location'
     or h.actor_type <> 'user' or h.actor_id is distinct from 'a0440000-0000-0000-0000-000000000002' then
    raise exception 'history should carry the override reason: %', row_to_json(h);
  end if;
  if coalesce(current_setting('navigatr.referral_note', true), '') <> '' then
    raise exception 'the note setting must be cleared after the override';
  end if;
end $$;

-- 3. An unflagged referral accepts exactly as before.
do $$ declare res jsonb; begin
  perform _t_act('a0440000-0000-0000-0000-000000000002');
  res := public.accept_referral('a044f000-0000-0000-0000-000000000002');
  if res->>'result' is distinct from 'accepted' then raise exception 'plain accept should still work, got %', res; end if;
end $$;

-- 4. Override can still hit the org-wide active-deal dedupe: duplicate, nothing created.
do $$ declare res jsonb; n_before int; begin
  perform _t_act('a0440000-0000-0000-0000-000000000002');
  select count(*) into n_before from deals;
  res := public.accept_referral_override('a044f000-0000-0000-0000-000000000004', 'Really different');
  if res->>'result' is distinct from 'duplicate' or res->>'deal_id' is distinct from 'a044d000-0000-0000-0000-000000000001' then
    raise exception 'override colliding with an active deal should return duplicate with that deal, got %', res;
  end if;
  if (select count(*) from deals) <> n_before then raise exception 'no deal may be created on duplicate'; end if;
  if (select status from referrals where id = 'a044f000-0000-0000-0000-000000000004') <> 'submitted' then
    raise exception 'referral must stay submitted on duplicate';
  end if;
end $$;

-- 5. A flagged referral refuses a plain merge and a blank reason; nothing changes.
do $$ begin
  perform _t_act('a0440000-0000-0000-0000-000000000002');
  perform _t_raises($q$select public.merge_referral('a044f000-0000-0000-0000-00000000000d', 'a044d000-0000-0000-0000-00000000000b')$q$, 'override_reason_required');
  perform _t_raises($q$select public.merge_referral_override('a044f000-0000-0000-0000-00000000000d', 'a044d000-0000-0000-0000-00000000000b', '  ')$q$, 'override_reason_required');
  perform _t_raises($q$select public.merge_referral_override('a044f000-0000-0000-0000-00000000000d', 'a044d000-0000-0000-0000-00000000000b', null)$q$, 'override_reason_required');
  if (select status from referrals where id = 'a044f000-0000-0000-0000-00000000000d') <> 'submitted' then
    raise exception 'a refused merge must leave the referral submitted';
  end if;
  if (select source_partner_id from deals where id = 'a044d000-0000-0000-0000-00000000000b') is not null then
    raise exception 'a refused merge must not credit the deal';
  end if;
end $$;

-- 6. First partner keeps credit: P2's flagged referral merged into DA (credited to
--    P1) leaves DA with P1 and ends P2's referral declined (duplicate). P2 gets the
--    not-moving-forward email and never an accepted or won one.
do $$ declare h record; r referrals; begin
  perform _t_act('a0440000-0000-0000-0000-000000000002');
  perform public.merge_referral_override('a044f000-0000-0000-0000-00000000000e', 'a044d000-0000-0000-0000-00000000000a', '  Same owner, second location  ');
  if (select source_partner_id from deals where id = 'a044d000-0000-0000-0000-00000000000a') is distinct from 'a044a000-0000-0000-0000-000000000001' then
    raise exception 'DA must keep P1 as its source partner';
  end if;
  select * into r from referrals where id = 'a044f000-0000-0000-0000-00000000000e';
  if r.status <> 'declined' or r.decline_reason is distinct from 'duplicate' then
    raise exception 'H should be declined (duplicate), got % %', r.status, r.decline_reason;
  end if;
  if r.deal_id is not null then raise exception 'a declined referral must not link the deal'; end if;
  if r.duplicate_of_deal_id is distinct from 'a044d000-0000-0000-0000-00000000000a' then
    raise exception 'H should point at the deal that holds credit';
  end if;
  if r.triaged_by is distinct from 'a0440000-0000-0000-0000-000000000002' or r.triaged_at is null then
    raise exception 'H should record who triaged it';
  end if;
  if exists (select 1 from referral_status_history
              where referral_id = r.id and to_status in ('accepted','working','won')) then
    raise exception 'H must never pass through accepted, working or won';
  end if;
  select * into h from referral_status_history where referral_id = r.id and to_status = 'declined';
  if h.note is distinct from 'Merged despite possible duplicate: Same owner, second location'
     or h.actor_type <> 'user' or h.actor_id is distinct from 'a0440000-0000-0000-0000-000000000002' then
    raise exception 'history should carry the merge reason: %', row_to_json(h);
  end if;
  -- The outbox is not readable by the app role; check it as the owner.
  perform set_config('role', 'postgres', true);
  if (select count(*) from portal_email_outbox
       where referral_id = r.id and kind = 'partner_not_moving_forward') <> 1 then
    raise exception 'P2 should get one not-moving-forward email';
  end if;
  if exists (select 1 from portal_email_outbox
              where referral_id = r.id and kind in ('partner_accepted','partner_closed_won')) then
    raise exception 'P2 must not get an accepted or won email';
  end if;
  if coalesce(current_setting('navigatr.referral_note', true), '') <> '' then
    raise exception 'the note setting must be cleared after the merge override';
  end if;
end $$;

-- 7. A deal with no partner: the override merges as today (credit goes to P2),
--    and the reason is on the accepted history row.
do $$ declare h record; r referrals; begin
  perform _t_act('a0440000-0000-0000-0000-000000000002');
  perform public.merge_referral_override('a044f000-0000-0000-0000-00000000000f', 'a044d000-0000-0000-0000-00000000000b', 'Different owner');
  select * into r from referrals where id = 'a044f000-0000-0000-0000-00000000000f';
  if r.status <> 'working' or r.deal_id is distinct from 'a044d000-0000-0000-0000-00000000000b' then
    raise exception 'K should be merged into DN and working, got % %', r.status, r.deal_id;
  end if;
  if (select source_partner_id from deals where id = 'a044d000-0000-0000-0000-00000000000b') is distinct from 'a044a000-0000-0000-0000-000000000002' then
    raise exception 'DN should now credit P2';
  end if;
  select * into h from referral_status_history where referral_id = r.id and to_status = 'accepted';
  if h.note is distinct from 'Merged despite possible duplicate: Different owner' then
    raise exception 'accepted history should carry the merge reason: %', row_to_json(h);
  end if;
end $$;

-- 8. The same partner as the deal's: merges as today, credit unchanged.
do $$ declare r referrals; begin
  perform _t_act('a0440000-0000-0000-0000-000000000002');
  perform public.merge_referral_override('a044f000-0000-0000-0000-000000000011', 'a044d000-0000-0000-0000-00000000000a', 'Partner sent it twice');
  select * into r from referrals where id = 'a044f000-0000-0000-0000-000000000011';
  if r.status <> 'working' or r.deal_id is distinct from 'a044d000-0000-0000-0000-00000000000a' then
    raise exception 'S should be merged into DA, got % %', r.status, r.deal_id;
  end if;
  if (select source_partner_id from deals where id = 'a044d000-0000-0000-0000-00000000000a') is distinct from 'a044a000-0000-0000-0000-000000000001' then
    raise exception 'DA must still credit P1';
  end if;
end $$;

-- 9. The reason is capped at 500 characters (L merged into DX, which has no partner).
do $$ declare h record; begin
  perform _t_act('a0440000-0000-0000-0000-000000000002');
  perform public.merge_referral_override('a044f000-0000-0000-0000-000000000010', 'a044d000-0000-0000-0000-000000000001', repeat('x', 600));
  select * into h from referral_status_history
   where referral_id = 'a044f000-0000-0000-0000-000000000010' and to_status = 'accepted';
  if h.note is distinct from 'Merged despite possible duplicate: ' || repeat('x', 500) then
    raise exception 'the merge reason should be capped at 500 characters, got % chars', length(h.note);
  end if;
end $$;

rollback;
