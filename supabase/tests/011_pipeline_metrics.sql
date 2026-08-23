-- Tests for migration 20260820000005_hier_bundle1_pipeline_metrics
-- (PRD 6.12.A Bundle 1, FR-HIER-03: server-side pipeline metrics).
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/011_pipeline_metrics.sql
--
-- Self-cleans via the wrapping transaction's ROLLBACK. Verifies that
-- public.pipeline_metrics():
--   * sums ONLY the deals the caller can see (SECURITY INVOKER -> deals RLS),
--     so a rep, their manager, and an admin each get different totals;
--   * counts a deal as "won this month" using its WON-transition timestamp
--     from deal_stage_history (a deal that reached won LAST month but was
--     edited this month is NOT counted), and falls back to updated_at when the
--     deal has no won-history row;
--   * matches the client's per-deal round-then-sum weighting.
--
-- Hierarchy:  top (admin)  ->  mgr (manager)  ->  rep

begin;

-- ─── Seed: org + admin/manager/rep (role_path set explicitly, as in 004) ──
insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000c2', 'Metrics Test', 'metrics-test', 'metrics-test-aa');

insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('70000000-0000-0000-0000-000000000001', 'top@m.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('70000000-0000-0000-0000-000000000002', 'mgr@m.example', 'authenticated', 'authenticated', now(), now(), now()),
  ('70000000-0000-0000-0000-000000000003', 'rep@m.example', 'authenticated', 'authenticated', now(), now(), now());

-- role_level is backfilled from role by the profiles_fill_role_level trigger;
-- admin -> 'administrator' (drives caller_is_admin exemption).
insert into profiles (id, org_id, role, full_name, email, role_path) values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', 'admin',   'Top', 'top@m.example', 'top'::ltree),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c2', 'manager', 'Mgr', 'mgr@m.example', 'top.mgr'::ltree),
  ('70000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c2', 'rep',     'Rep', 'rep@m.example', 'top.mgr.rep'::ltree);

-- Deals. value_cents / probability chosen so each caller's totals are distinct.
--   A open  rep   qualified 100000 @40   -> weighted 40000
--   B open  rep   new            0 @10   -> weighted 0, no-value
--   I open  rep   contacted  12345 @33   -> weighted round(4073.85)=4074 (rounding edge)
--   C won   rep             50000        -> won THIS month
--   D won   rep             70000        -> won LAST month (history backdated) -> excluded
--   E lost  rep            999999        -> excluded entirely
--   G won   rep             30000        -> history deleted -> falls back to updated_at (this month)
--   F open  mgr   qualified 200000 @50   -> weighted 100000 (visible to mgr + admin, not rep)
--   H open  top   proposal  400000 @25   -> weighted 100000 (visible to admin only)
insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, stage, probability, value_cents) values
  ('71000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', '70000000-0000-0000-0000-000000000003', 'A Co', 'C', 'a@m.example', '+15550010001', 'qualified', 40, 100000),
  ('71000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c2', '70000000-0000-0000-0000-000000000003', 'B Co', 'C', 'b@m.example', '+15550010002', 'new',       10, 0),
  ('71000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000c2', '70000000-0000-0000-0000-000000000003', 'I Co', 'C', 'i@m.example', '+15550010009', 'contacted', 33, 12345),
  ('71000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c2', '70000000-0000-0000-0000-000000000003', 'C Co', 'C', 'c@m.example', '+15550010003', 'won',      100, 50000),
  ('71000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c2', '70000000-0000-0000-0000-000000000003', 'D Co', 'C', 'd@m.example', '+15550010004', 'won',      100, 70000),
  ('71000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000c2', '70000000-0000-0000-0000-000000000003', 'E Co', 'C', 'e@m.example', '+15550010005', 'lost',       0, 999999),
  ('71000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000c2', '70000000-0000-0000-0000-000000000003', 'G Co', 'C', 'g@m.example', '+15550010007', 'won',      100, 30000),
  ('71000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000c2', '70000000-0000-0000-0000-000000000002', 'F Co', 'C', 'f@m.example', '+15550010006', 'qualified', 50, 200000),
  ('71000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000c2', '70000000-0000-0000-0000-000000000001', 'H Co', 'C', 'h@m.example', '+15550010008', 'proposal',  25, 400000);

-- Deal D reached "won" LAST month: backdate its (single) won-transition row.
-- Its updated_at stays this month, so this proves the history gate beats
-- updated_at (the deal was merely edited this month, not won this month).
update deal_stage_history
  set transitioned_at = date_trunc('month', now()) - interval '3 days'
  where deal_id = '71000000-0000-0000-0000-0000000000a4' and to_stage = 'won';

-- Deal G has NO won-history row (legacy / history not written): delete its
-- auto-created rows so the metric falls back to deals.updated_at (this month).
delete from deal_stage_history where deal_id = '71000000-0000-0000-0000-0000000000a7';

-- ─── Rep: own deals only ──────────────────────────────────────────────
do $$
declare r record; ms timestamptz := date_trunc('month', now());
begin
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000003', true);
  perform set_config('role', 'authenticated', true);
  select * into r from public.pipeline_metrics(ms);
  if r.total_pipeline_cents  <> 112345 then raise exception 'rep total: expected 112345, got %', r.total_pipeline_cents; end if;
  if r.weighted_cents        <> 44074  then raise exception 'rep weighted: expected 44074, got %', r.weighted_cents; end if;
  if r.active_deals          <> 3      then raise exception 'rep active: expected 3, got %', r.active_deals; end if;
  if r.won_this_month_cents  <> 80000  then raise exception 'rep won$: expected 80000 (C+G, not D), got %', r.won_this_month_cents; end if;
  if r.won_deals_this_month  <> 2      then raise exception 'rep won#: expected 2, got %', r.won_deals_this_month; end if;
  if r.no_value_active_deals <> 1      then raise exception 'rep no-value: expected 1, got %', r.no_value_active_deals; end if;
end $$;

-- ─── Manager: own + rep subtree (adds F, not H) ───────────────────────
do $$
declare r record; ms timestamptz := date_trunc('month', now());
begin
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', true);
  perform set_config('role', 'authenticated', true);
  select * into r from public.pipeline_metrics(ms);
  if r.total_pipeline_cents  <> 312345 then raise exception 'mgr total: expected 312345, got %', r.total_pipeline_cents; end if;
  if r.weighted_cents        <> 144074 then raise exception 'mgr weighted: expected 144074, got %', r.weighted_cents; end if;
  if r.active_deals          <> 4      then raise exception 'mgr active: expected 4, got %', r.active_deals; end if;
  if r.won_this_month_cents  <> 80000  then raise exception 'mgr won$: expected 80000, got %', r.won_this_month_cents; end if;
  if r.won_deals_this_month  <> 2      then raise exception 'mgr won#: expected 2, got %', r.won_deals_this_month; end if;
end $$;

-- ─── Admin: whole org (adds H) ────────────────────────────────────────
do $$
declare r record; ms timestamptz := date_trunc('month', now());
begin
  perform set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  select * into r from public.pipeline_metrics(ms);
  if r.total_pipeline_cents  <> 712345 then raise exception 'admin total: expected 712345, got %', r.total_pipeline_cents; end if;
  if r.weighted_cents        <> 244074 then raise exception 'admin weighted: expected 244074, got %', r.weighted_cents; end if;
  if r.active_deals          <> 5      then raise exception 'admin active: expected 5, got %', r.active_deals; end if;
  if r.won_this_month_cents  <> 80000  then raise exception 'admin won$: expected 80000, got %', r.won_this_month_cents; end if;
end $$;

rollback;
