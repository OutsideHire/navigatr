-- Tests for 20261012000005_accept_referral_override (Partner Portal Phase 1B).
--   psql "$SUPABASE_DB_URL" -f supabase/tests/044_accept_referral_override.sql
-- Self-cleans via ROLLBACK.
--
-- Fixture (org accept-override): boss administrator; rep1 boss.rep1 owns partner P1
-- and deal DX. Referrals assigned to rep1: F flagged against DX, N unflagged,
-- G flagged against N.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-000000001044', 'Accept Override Org', 'accept-override', 'accept-override-a1');

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

rollback;
