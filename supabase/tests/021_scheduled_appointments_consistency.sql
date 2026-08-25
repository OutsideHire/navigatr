-- Tests for migration 20260825000003_scheduled_appointments_consistency.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/021_scheduled_appointments_consistency.sql
--
-- Self-cleans via ROLLBACK. Verifies a rep can only book (or re-point) an
-- appointment against a deal they can SEE, that org_id is forced from the deal,
-- AND that a status/outcome-only update on an OWNED appointment still works
-- after its deal is reassigned out of the rep's subtree (the regression the
-- over-broad first cut would have caused).
--
-- Org A hierarchy: ceo(admin) > vp(manager) > rep1(rep); vp2(manager) sibling.
-- Org B: repB owns dealB1.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000cb', 'Appt Consistency A', 'appt-cons-a', 'appt-cons-a-aa'),
  ('00000000-0000-0000-0000-0000000000cc', 'Appt Consistency B', 'appt-cons-b', 'appt-cons-b-bb');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('cb000000-0000-0000-0000-000000000001', 'ceo@ac.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('cb000000-0000-0000-0000-000000000002', 'vp@ac.example',   'authenticated', 'authenticated', now(), now(), now()),
  ('cb000000-0000-0000-0000-000000000003', 'rep1@ac.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('cb000000-0000-0000-0000-000000000004', 'vp2@ac.example',  'authenticated', 'authenticated', now(), now(), now()),
  ('cc000000-0000-0000-0000-000000000001', 'repB@ac.example', 'authenticated', 'authenticated', now(), now(), now());

insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('cb000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000cb', 'admin',   'CEO',  'ceo@ac.example',  'ceo'::ltree),
  ('cb000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000cb', 'manager', 'VP',   'vp@ac.example',   'ceo.vp'::ltree),
  ('cb000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000cb', 'rep',     'Rep1', 'rep1@ac.example', 'ceo.vp.rep1'::ltree),
  ('cb000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000cb', 'manager', 'VP2',  'vp2@ac.example',  'ceo.vp2'::ltree),
  ('cc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000cc', 'admin',   'RepB', 'repB@ac.example', 'top'::ltree);

insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('cbd00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000cb', 'cb000000-0000-0000-0000-000000000003', 'Rep1 Deal',  'C', 'r1@ac.example', '+15550001001', 1000),  -- rep1 owns
  ('cbd00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000cb', 'cb000000-0000-0000-0000-000000000004', 'VP2 Deal',   'C', 'v2@ac.example', '+15550001002', 2000),  -- vp2 owns (out of rep1 subtree)
  ('cbd00000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000cb', 'cb000000-0000-0000-0000-000000000003', 'Rep1 Deal2', 'C', 'r3@ac.example', '+15550001004', 4000),  -- rep1 owns (will be reassigned)
  ('ccd00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000cc', 'cc000000-0000-0000-0000-000000000001', 'OrgB Deal',  'C', 'b1@ac.example', '+15550001003', 3000);  -- org B

-- Superuser seed (before any role switch, RLS bypassed): rep1 already booked an
-- appointment on Deal3, THEN Deal3 gets reassigned to vp2 (out of rep1's
-- subtree). rep1 must still be able to close out this owned appointment.
insert into scheduled_appointments (id, org_id, owner_id, deal_id, title, start_at, end_at) values
  ('cba30000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000cb', 'cb000000-0000-0000-0000-000000000003',
   'cbd00000-0000-0000-0000-000000000003', 'Owned appt', '2026-09-02T15:00:00Z', '2026-09-02T16:00:00Z');
update deals set owner_id = 'cb000000-0000-0000-0000-000000000004' where id = 'cbd00000-0000-0000-0000-000000000003';

-- Book as rep1; returns 'ok' or 'blocked'.
create or replace function _appt_try(p_deal uuid, p_org uuid)
returns text language plpgsql as $$
begin
  insert into scheduled_appointments (org_id, owner_id, deal_id, title, start_at, end_at)
  values (p_org, 'cb000000-0000-0000-0000-000000000003', p_deal, 'Test appt',
          '2026-09-01T15:00:00Z', '2026-09-01T16:00:00Z');
  return 'ok';
exception when others then
  return 'blocked';
end $$;

-- ── Positive: rep1 books on their OWN deal; org_id ends up the deal's org ──
do $$
declare r text; v_org uuid;
begin
  perform set_config('request.jwt.claim.sub', 'cb000000-0000-0000-0000-000000000003', true);
  perform set_config('role', 'authenticated', true);
  r := _appt_try('cbd00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000cc'); -- wrong org_id on purpose
  if r <> 'ok' then raise exception 'positive: rep1 should book on own deal, got %', r; end if;
  select org_id into v_org from scheduled_appointments where deal_id = 'cbd00000-0000-0000-0000-000000000001';
  if v_org <> '00000000-0000-0000-0000-0000000000cb' then
    raise exception 'trigger: org_id should be forced to the deal''s org (cb), got %', v_org;
  end if;
end $$;

-- ── Cross-hierarchy INSERT: rep1 cannot book on vp2's deal (same org) ──
do $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', 'cb000000-0000-0000-0000-000000000003', true);
  perform set_config('role', 'authenticated', true);
  r := _appt_try('cbd00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000cb');
  if r <> 'blocked' then raise exception 'cross-hierarchy: rep1 must NOT book on vp2 deal, got %', r; end if;
end $$;

-- ── Cross-org INSERT: rep1 cannot book on an org B deal ──
do $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', 'cb000000-0000-0000-0000-000000000003', true);
  perform set_config('role', 'authenticated', true);
  r := _appt_try('ccd00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000cc');
  if r <> 'blocked' then raise exception 'cross-org: rep1 must NOT book on an org B deal, got %', r; end if;
end $$;

-- ── UPDATE re-point: rep1 cannot re-point their appt to an unseen deal ──
do $$
declare blocked boolean := false;
begin
  perform set_config('request.jwt.claim.sub', 'cb000000-0000-0000-0000-000000000003', true);
  perform set_config('role', 'authenticated', true);
  begin
    update scheduled_appointments set deal_id = 'cbd00000-0000-0000-0000-000000000002'
      where deal_id = 'cbd00000-0000-0000-0000-000000000001';
  exception when others then blocked := true;
  end;
  if not blocked then raise exception 're-point: rep1 must NOT move an appt onto vp2''s out-of-subtree deal'; end if;
end $$;

-- ── Regression: status-only update on an OWNED appt still works after the
--    deal was reassigned out of rep1's subtree (deal_id unchanged -> trigger
--    does not re-fire, so the now-unseen deal isn't re-validated). ──
do $$
begin
  perform set_config('request.jwt.claim.sub', 'cb000000-0000-0000-0000-000000000003', true);
  perform set_config('role', 'authenticated', true);
  update scheduled_appointments set status = 'cancelled'
    where id = 'cba30000-0000-0000-0000-000000000003';
  if not found then
    raise exception 'regression: rep1 must still cancel their own appt after its deal was reassigned';
  end if;
end $$;

rollback;
