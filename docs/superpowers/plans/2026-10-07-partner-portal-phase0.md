# Partner Portal Phase 0 (Referral foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare `partner_deals` link with a real Referral object (status, immutable history, hierarchy visibility) and give reps in-app triage (Accept / Decline / Merge), a "Log a referral" action, and a "Referred by" line on deals.

**Architecture:** Two new tables (`referrals`, `referral_status_history`) with SELECT-only RLS; every write goes through SECURITY DEFINER RPCs that re-check visibility. A trigger on `deals.stage` keeps referral status in step with the deal. `partner_deals` is backfilled into `referrals`, frozen for app writes, and mirrored by trigger so the demo reseed keeps working until a later migration drops it. The frontend swaps its three `partner_deals` mutations for RPC calls and adds a review queue, a review sheet, and a log sheet.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, ltree hierarchy helpers), React 19 + TypeScript, TanStack Query, Radix Dialog, vitest + Testing Library, plain-psql DB tests run by `tools/run-db-tests.sh`.

**Spec:** `docs/superpowers/specs/2026-10-07-partner-portal-design.md` (Section 4 is this plan; Sections 2, 3 give the decisions and verified current state).

## Global Constraints

- Migrations go in `supabase/migrations/` named `20261007000001_...` onward, applied in filename order. Never hand-apply SQL to staging or production; CI and `promote-production` apply them.
- Every new RPC: `security definer set search_path = public`, then `revoke execute ... from public, anon;` and `grant execute ... to authenticated;`. Internal-only helpers revoke from `public, anon` and are not granted.
- New tables inherit default privileges that GRANT `authenticated` SELECT/INSERT/UPDATE/DELETE (migration 20260813000002). Referral tables must explicitly `revoke insert, update, delete ... from authenticated` and `revoke all ... from anon`.
- Admin signal in SQL is `public.caller_is_admin()` (role_level = 'administrator'). Hierarchy check is `public.user_can_see_owner(owner uuid)`. Partner check is `public.can_see_partner(partner uuid)`. Org is `public.user_org_id()`.
- Lead source is locked once set (trigger `deals_lead_source_lock`). Accept writes `'partner_referral'` on the NEW deal. Merge never changes `lead_source`.
- DB tests: plain psql scripts in `supabase/tests/NNN_name.sql`, wrapped in `begin; ... rollback;`, assertions via `do $$ ... raise exception ... $$`. Seed every fixture BEFORE the first role switch (the `authenticated` role stays sticky for the transaction).
- Run DB tests locally: `supabase start`, then `supabase db reset`, then `./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`.
- Frontend tests: `pnpm --filter app test` (vitest). Tests live next to source.
- Before any push: `pnpm --filter app build` must pass (it runs `tsc -b && vite build`; `tsc --noEmit` alone is not enough).
- No em dashes or en dashes in any user-facing copy, comments you add, or commit messages.
- Rep-facing copy uses the internal status names (Submitted, Accepted, Working, Won, Lost, Declined, Withdrawn).

## File map

**Create**
- `supabase/migrations/20261007000001_referrals_foundation.sql`: enums, `referrals`, `referral_status_history`, `deals.source_referral_id/source_partner_id`, RLS, helper functions.
- `supabase/migrations/20261007000002_referrals_follow_deal_stage.sql`: deal-stage sync trigger.
- `supabase/migrations/20261007000003_referral_rpcs.sql`: all write RPCs.
- `supabase/migrations/20261007000004_referrals_backfill_and_freeze.sql`: backfill, mirror trigger, freeze `partner_deals`.
- `supabase/tests/033_referrals_foundation.sql`, `034_referrals_follow_deal_stage.sql`, `035_referral_rpcs.sql`, `036_referrals_partner_deals_mirror.sql`.
- `apps/app/src/features/partners/lib/referrals.ts` (+ `.test.ts`): status/reason types, labels, badge kinds, error mapping.
- `apps/app/src/features/partners/hooks/useReferralQueue.ts` (+ test): submitted referrals the user can see.
- `apps/app/src/features/partners/hooks/useReferralMutations.ts` (+ test): log / accept / decline / merge.
- `apps/app/src/features/partners/hooks/useDealReferral.ts` (+ test): the inbound referral behind a deal.
- `apps/app/src/features/partners/components/ReviewReferralSheet.tsx` (+ test).
- `apps/app/src/features/partners/components/ReferralQueueCard.tsx` (+ test).
- `apps/app/src/features/partners/components/LogReferralSheet.tsx` (+ test).

**Modify**
- `apps/app/src/features/partners/hooks/usePartners.ts` (+ test): embed `referrals` instead of `partner_deals`.
- `apps/app/src/features/partners/hooks/useAttributeDeal.ts` (+ test), `useReferDeal.ts` (+ test): call RPCs.
- `apps/app/src/features/partners/pages/PartnersPage.tsx`: queue card under the header.
- `apps/app/src/features/partners/pages/PartnerDetailPage.tsx`: queue card for this partner + "Log a referral" button.
- `apps/app/src/features/pipeline/pages/DealDetailPage.tsx`: "Referred by" line in `SourceCard`.
- `apps/app/src/features/pipeline/components/SendReferralSheet.tsx`: doc comment only (no longer "inserts a partner_deals row").

**Deviation from spec, recorded here:** the spec's "Log a referral" sheet reused the Add Deal Google place search. That search is inline inside the 700-line `AddDealSheet`, not a reusable component. Phase 0 uses plain fields; the place search is extracted in Phase 1, where the portal submission form needs it anyway. Duplicate checks still run on name + address + phone at review and at Accept.

**Second deviation:** the spec said the demo reset/seed functions are rewritten in this phase. `reset_demo_data_base()` is a 465-line SECURITY DEFINER function; instead of copying it, Task 4 adds a mirror trigger so its existing `partner_deals` inserts produce referrals. The rewrite moves to the follow-up migration that drops `partner_deals`. Reassignment ships as an RPC only (no UI) in Phase 0; the spec's in-app UI list (4.8) does not include it.

**Third deviation:** Deferred from spec 4.8 to Phase 1: status chips on Partner Detail referral rows and hero KPIs counted from referrals (the deal stage badge already conveys status).

---

### Task 1: Referral tables, history, visibility, helpers

**Files:**
- Create: `supabase/migrations/20261007000001_referrals_foundation.sql`
- Test: `supabase/tests/033_referrals_foundation.sql`

**Interfaces:**
- Produces (SQL): types `referral_status`, `referral_source`, `referral_decline_reason`, `referral_actor_type`; tables `referrals`, `referral_status_history`; columns `deals.source_referral_id`, `deals.source_partner_id`; functions `referral_status_for_stage(deal_stage) returns referral_status`, `profile_can_see_owner(p_viewer uuid, p_owner uuid) returns boolean`, `referral_route_assignee(p_partner uuid) returns uuid`, `next_business_day(p_from date, p_org uuid) returns date`, `can_triage_referral(p_assignee uuid) returns boolean`. Session settings read by the history trigger: `navigatr.referral_actor` (`'system'` or empty) and `navigatr.referral_note`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/033_referrals_foundation.sql`:

```sql
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `033_referrals_foundation.sql FAIL` (relation "referrals" does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261007000001_referrals_foundation.sql`:

```sql
-- 20261007000001_referrals_foundation.sql
--
-- Partner Portal Phase 0 (spec docs/superpowers/specs/2026-10-07-partner-portal-design.md,
-- sections 4.1 and 4.2). A referral becomes a first-class record with a status and
-- an append-only history, replacing the bare partner_deals link (migrated in
-- 20261007000004).
--
-- Writes: none from the app role. Every change goes through SECURITY DEFINER RPCs
-- (20261007000003) so status and history can never disagree.
-- Reads: you see a referral when you can see its partner, its assignee, or its deal
-- (the assignee always sees their own item, FR-PORT-55).

create type referral_status as enum ('submitted','accepted','working','won','lost','declined','withdrawn');
create type referral_source as enum ('rep_entered','portal_signed_in');
create type referral_decline_reason as enum (
  'duplicate','outside_footprint','outside_icp','insufficient_contact','existing_customer','withdrawn_by_partner'
);
create type referral_actor_type as enum ('user','partner','system');

create table referrals (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references organizations(id) on delete cascade,
  partner_id                  uuid not null references partners(id) on delete cascade,
  direction                   text not null default 'inbound' check (direction in ('inbound','outbound')),
  source                      referral_source not null default 'rep_entered',
  status                      referral_status not null default 'submitted',

  -- What was referred. Lives here because there is no Leads table: a referral
  -- exists before any deal does.
  company_name                text not null check (length(btrim(company_name)) > 0),
  contact_name                text,
  contact_email               text,
  contact_phone               text,
  address                     text,
  place_id                    text,
  industry                    text,
  notes                       text not null default '',
  -- partners.company at the time of the referral (stands in for the deferred Firm snapshot).
  partner_company_snapshot    text,

  deal_id                     uuid references deals(id) on delete set null,
  assigned_user_id            uuid references profiles(id) on delete set null,
  submitted_by_user_id        uuid references profiles(id) on delete set null,
  submitted_by_portal_user_id uuid,
  submitted_at                timestamptz not null default now(),
  triaged_by                  uuid references profiles(id) on delete set null,
  triaged_at                  timestamptz,
  decline_reason              referral_decline_reason,
  decline_note                text,
  duplicate_of_referral_id    uuid references referrals(id) on delete set null,
  duplicate_of_deal_id        uuid references deals(id) on delete set null,
  consent_text_version        text,
  nudged_at                   timestamptz,
  purged_at                   timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index referrals_org_status_idx      on referrals (org_id, status);
create index referrals_partner_idx         on referrals (partner_id);
create index referrals_deal_idx            on referrals (deal_id) where deal_id is not null;
create index referrals_assignee_status_idx on referrals (assigned_user_id, status);
-- One live link per partner + deal + direction (the old partner_deals PK).
create unique index referrals_partner_deal_live_uidx
  on referrals (partner_id, deal_id, direction)
  where deal_id is not null and status not in ('declined','withdrawn');

-- org_id always comes from the partner; a linked deal must be in the same org.
create or replace function public.referrals_enforce_org()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_partner_org uuid;
  v_deal_org    uuid;
begin
  select org_id into v_partner_org from partners where id = new.partner_id;
  if v_partner_org is null then
    raise exception 'referral partner not found' using errcode = '23503';
  end if;
  new.org_id := v_partner_org;
  if new.deal_id is not null then
    select org_id into v_deal_org from deals where id = new.deal_id;
    if v_deal_org is distinct from v_partner_org then
      raise exception 'referral deal and partner are in different orgs' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger referrals_enforce_org
  before insert or update on referrals
  for each row execute function public.referrals_enforce_org();

-- Append-only status history -----------------------------------------------
create table referral_status_history (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  referral_id  uuid not null references referrals(id) on delete cascade,
  from_status  referral_status,
  to_status    referral_status not null,
  actor_type   referral_actor_type not null,
  actor_id     uuid,
  note         text,
  created_at   timestamptz not null default now()
);
create index referral_status_history_referral_idx on referral_status_history (referral_id, created_at);

-- Writers set navigatr.referral_actor = 'system' for automatic changes and
-- navigatr.referral_note for a human reason; both are transaction-local.
create or replace function public.referrals_record_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor text := nullif(current_setting('navigatr.referral_actor', true), '');
  v_note  text := nullif(current_setting('navigatr.referral_note', true), '');
  v_sys   boolean;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  v_sys := v_actor = 'system' or auth.uid() is null;
  insert into referral_status_history (org_id, referral_id, from_status, to_status, actor_type, actor_id, note)
  values (
    new.org_id,
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    case when v_sys then 'system'::referral_actor_type else 'user'::referral_actor_type end,
    case when v_sys then null else auth.uid() end,
    v_note
  );
  return new;
end $$;

create trigger referrals_record_status
  after insert or update of status on referrals
  for each row execute function public.referrals_record_status();

-- Deals remember which referral and partner produced them --------------------
alter table deals add column if not exists source_referral_id uuid references referrals(id) on delete set null;
alter table deals add column if not exists source_partner_id  uuid references partners(id)  on delete set null;

-- Privileges + RLS ------------------------------------------------------------
alter table referrals enable row level security;
alter table referral_status_history enable row level security;

revoke all on referrals, referral_status_history from anon;
revoke insert, update, delete on referrals, referral_status_history from authenticated;
grant select on referrals, referral_status_history to authenticated;

create policy referrals_select on referrals for select using (
  org_id = public.user_org_id()
  and (
    public.can_see_partner(partner_id)
    or (assigned_user_id is not null and public.user_can_see_owner(assigned_user_id))
    or (assigned_user_id is null and public.caller_is_admin())
    or (deal_id is not null and exists (
          select 1 from deals d
          where d.id = referrals.deal_id and public.user_can_see_owner(d.owner_id)))
  )
);

create policy referral_status_history_select on referral_status_history for select using (
  org_id = public.user_org_id()
  and exists (select 1 from referrals r where r.id = referral_status_history.referral_id)
);

-- Helpers -------------------------------------------------------------------

-- Deal stage -> referral status for a linked referral (spec 4.5).
create or replace function public.referral_status_for_stage(p_stage deal_stage)
returns referral_status language sql immutable as $$
  select case p_stage
    when 'new'  then 'accepted'::referral_status
    when 'won'  then 'won'::referral_status
    when 'lost' then 'lost'::referral_status
    else 'working'::referral_status
  end
$$;

-- user_can_see_owner with an explicit viewer, for checks made on someone
-- else's behalf (reassignment now, portal duplicate scope in Phase 1).
create or replace function public.profile_can_see_owner(p_viewer uuid, p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with v as (select role_path, role_level, org_id, deactivated_at from profiles where id = p_viewer),
       t as (select role_path, org_id from profiles where id = p_owner)
  select case
    when p_viewer is null or p_owner is null then false
    when not exists (select 1 from v) or not exists (select 1 from t) then false
    when (select deactivated_at from v) is not null then false
    when (select org_id from v) is distinct from (select org_id from t) then false
    when p_viewer = p_owner then true
    when (select role_level from v) = 'administrator' then true
    when (select role_path from v) is null then false
    when (select role_path from t) is null then false
    else (select role_path from t) <@ (select role_path from v)
  end
$$;

-- Routing (spec 4.4): partner owner if active and placed (or an administrator),
-- else the owner's active manager, else NULL = administrator queue.
create or replace function public.referral_route_assignee(p_partner uuid)
returns uuid language sql stable security definer set search_path = public as $$
  with o as (
    select pr.id, pr.manager_id, pr.deactivated_at, pr.role_path, pr.role_level
    from partners p join profiles pr on pr.id = p.owner_id
    where p.id = p_partner
  ),
  m as (
    select pr.id, pr.deactivated_at from profiles pr where pr.id = (select manager_id from o)
  )
  select case
    when exists (select 1 from o)
         and (select deactivated_at from o) is null
         and ((select role_path from o) is not null or (select role_level from o) = 'administrator')
      then (select id from o)
    when exists (select 1 from m) and (select deactivated_at from m) is null
      then (select id from m)
    else null
  end
$$;

-- First business day after p_from, skipping weekends and global or org holidays.
create or replace function public.next_business_day(p_from date, p_org uuid)
returns date language plpgsql stable security definer set search_path = public as $$
declare
  d date := p_from + 1;
begin
  while extract(isodow from d) in (6, 7)
     or exists (select 1 from business_holidays h
                where h.holiday_date = d and (h.org_id is null or h.org_id = p_org)) loop
    d := d + 1;
  end loop;
  return d;
end $$;

-- Who may triage: anyone who can see the assignee (self, managers above,
-- admins); the administrator queue (NULL assignee) is admins only.
create or replace function public.can_triage_referral(p_assignee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_assignee is null then public.caller_is_admin()
    else public.user_can_see_owner(p_assignee)
  end
$$;

revoke execute on function public.profile_can_see_owner(uuid, uuid) from public, anon;
revoke execute on function public.referral_route_assignee(uuid)      from public, anon;
revoke execute on function public.next_business_day(date, uuid)       from public, anon;
revoke execute on function public.can_triage_referral(uuid)           from public, anon;
revoke execute on function public.referrals_enforce_org()             from public, anon;
revoke execute on function public.referrals_record_status()           from public, anon;
```

- [ ] **Step 4: Run the DB tests to verify they pass**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `033_referrals_foundation.sql PASS` and every previously passing test still PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261007000001_referrals_foundation.sql supabase/tests/033_referrals_foundation.sql
git commit -m "feat(referrals): referral + status history tables with hierarchy visibility"
```

---

### Task 2: Referral status follows the linked deal

**Files:**
- Create: `supabase/migrations/20261007000002_referrals_follow_deal_stage.sql`
- Test: `supabase/tests/034_referrals_follow_deal_stage.sql`

**Interfaces:**
- Consumes: `referral_status_for_stage`, `referrals`, `referral_status_history`, session setting `navigatr.referral_actor` (Task 1).
- Produces: trigger `deals_referrals_follow_stage` (AFTER UPDATE OF stage ON deals).

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/034_referrals_follow_deal_stage.sql`:

```sql
-- Tests for 20261007000002: a linked referral's status follows its deal's stage.
-- Self-cleans via ROLLBACK.

begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000e3', 'Referral Sync', 'ref-sync', 'ref-sync-a1');
insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('e3000000-0000-0000-0000-000000000001', 'rep@rs.example', 'authenticated', 'authenticated', now(), now(), now());
insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('e3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e3', 'rep', 'sales_professional', 'Rep', 'rep@rs.example', 'rep'::ltree);
insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('e3a00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e3', 'e3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'P', 'P CPA', 'cpa');
insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents) values
  ('e3d00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e3', 'e3000000-0000-0000-0000-000000000001', 'Linked Co',    'C', 'c@rs.example', '+15550003001', 100),
  ('e3d00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e3', 'e3000000-0000-0000-0000-000000000001', 'Withdrawn Co', 'C', 'w@rs.example', '+15550003002', 100);
insert into referrals (id, org_id, partner_id, company_name, deal_id, status) values
  ('e3b00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e3', 'e3a00000-0000-0000-0000-000000000001', 'Linked Co',    'e3d00000-0000-0000-0000-000000000001', 'accepted'),
  ('e3b00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e3', 'e3a00000-0000-0000-0000-000000000001', 'Withdrawn Co', 'e3d00000-0000-0000-0000-000000000002', 'withdrawn');

create or replace function _t_status(p uuid) returns text language sql as $$
  select status::text from referrals where id = p
$$;

do $$ begin
  update deals set stage = 'contacted' where id = 'e3d00000-0000-0000-0000-000000000001';
  if _t_status('e3b00000-0000-0000-0000-000000000001') <> 'working' then raise exception 'contacted should make the referral working'; end if;

  update deals set stage = 'won' where id = 'e3d00000-0000-0000-0000-000000000001';
  if _t_status('e3b00000-0000-0000-0000-000000000001') <> 'won' then raise exception 'won deal should make the referral won'; end if;

  update deals set stage = 'lost' where id = 'e3d00000-0000-0000-0000-000000000001';
  if _t_status('e3b00000-0000-0000-0000-000000000001') <> 'lost' then raise exception 'lost deal should make the referral lost'; end if;

  -- Reopen.
  update deals set stage = 'qualified' where id = 'e3d00000-0000-0000-0000-000000000001';
  if _t_status('e3b00000-0000-0000-0000-000000000001') <> 'working' then raise exception 'reopened deal should move the referral back to working'; end if;

  -- Withdrawn and declined are never touched.
  update deals set stage = 'won' where id = 'e3d00000-0000-0000-0000-000000000002';
  if _t_status('e3b00000-0000-0000-0000-000000000002') <> 'withdrawn' then raise exception 'withdrawn referral must not follow the deal'; end if;
end $$;

-- History: insert + 4 transitions, the transitions all attributed to system.
do $$ declare n int; s int; begin
  select count(*), count(*) filter (where actor_type = 'system') into n, s
    from referral_status_history where referral_id = 'e3b00000-0000-0000-0000-000000000001';
  if n <> 5 then raise exception 'expected 5 history rows, got %', n; end if;
  if s <> 5 then raise exception 'expected all rows system-attributed, got %', s; end if;
end $$;

-- A non-stage update does not write history.
do $$ declare n int; begin
  update deals set value_cents = 999 where id = 'e3d00000-0000-0000-0000-000000000001';
  select count(*) into n from referral_status_history where referral_id = 'e3b00000-0000-0000-0000-000000000001';
  if n <> 5 then raise exception 'value change must not add history, got %', n; end if;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `034_referrals_follow_deal_stage.sql FAIL` with "contacted should make the referral working".

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261007000002_referrals_follow_deal_stage.sql`:

```sql
-- 20261007000002_referrals_follow_deal_stage.sql
--
-- Spec 4.5: a referral linked to a deal follows that deal. new -> accepted,
-- any other open stage -> working, won -> won, lost -> lost (a reopened deal
-- moves the referral back to working). Declined, withdrawn and still-submitted
-- referrals are never touched. SECURITY DEFINER because the app role has no
-- UPDATE on referrals; history attributes these changes to 'system'.

create or replace function public.referrals_follow_deal_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_target referral_status;
begin
  if new.stage is not distinct from old.stage then
    return new;
  end if;
  v_target := public.referral_status_for_stage(new.stage);
  perform set_config('navigatr.referral_actor', 'system', true);
  update referrals r
     set status = v_target
   where r.deal_id = new.id
     and r.status in ('accepted','working','won','lost')
     and r.status <> v_target;
  perform set_config('navigatr.referral_actor', '', true);
  return new;
end $$;

revoke execute on function public.referrals_follow_deal_stage() from public, anon;

create trigger deals_referrals_follow_stage
  after update of stage on deals
  for each row execute function public.referrals_follow_deal_stage();
```

- [ ] **Step 4: Run the DB tests to verify they pass**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: 033 and 034 PASS, all others unchanged.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261007000002_referrals_follow_deal_stage.sql supabase/tests/034_referrals_follow_deal_stage.sql
git commit -m "feat(referrals): referral status follows its linked deal's stage"
```

---

### Task 3: Write RPCs (log, attribute, refer, remove, accept, decline, merge, withdraw, reassign)

**Files:**
- Create: `supabase/migrations/20261007000003_referral_rpcs.sql`
- Test: `supabase/tests/035_referral_rpcs.sql`

**Interfaces:**
- Consumes: everything from Task 1; `deal_dedupe_key(text, text)` (20260804000002); `deals.dedupe_key` generated column.
- Produces (all `security definer`, granted to `authenticated`):
  - `log_referral(p_partner_id uuid, p_company_name text, p_contact_name text default null, p_contact_email text default null, p_contact_phone text default null, p_address text default null, p_place_id text default null, p_industry text default null, p_notes text default '') returns uuid`
  - `attribute_deal_to_partner(p_partner_id uuid, p_deal_id uuid, p_note text default '') returns uuid`
  - `refer_deal_to_partner(p_partner_id uuid, p_deal_id uuid, p_note text default '') returns uuid`
  - `remove_referral_link(p_partner_id uuid, p_deal_id uuid) returns void`
  - `accept_referral(p_referral_id uuid) returns jsonb`: `{"result":"accepted","deal_id":uuid}` or `{"result":"duplicate","deal_id":uuid|null}`
  - `decline_referral(p_referral_id uuid, p_reason referral_decline_reason, p_note text default null) returns void`
  - `merge_referral(p_referral_id uuid, p_deal_id uuid) returns void`
  - `withdraw_referral(p_referral_id uuid, p_note text default null) returns void`
  - `reassign_referral(p_referral_id uuid, p_user_id uuid) returns boolean` (true when the new assignee can see the partner)
- Error messages the frontend maps (Task 5): `not_authorized`, `partner_not_visible`, `deal_not_visible`, `referral_not_found`, `referral_not_submitted`, `referral_closed`, `already_linked`, `company_required`, `assignee_invalid`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/035_referral_rpcs.sql`:

```sql
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
  if t <> 1 or due <> public.next_business_day(current_date, '00000000-0000-0000-0000-0000000000e4') then
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
  perform public.remove_referral_link('e4a00000-0000-0000-0000-000000000001', 'e4d00000-0000-0000-0000-0000000000a1');
  select count(*) into n from referrals where partner_id = 'e4a00000-0000-0000-0000-000000000001'
    and deal_id = 'e4d00000-0000-0000-0000-0000000000a1' and source = 'rep_entered';
  if n <> 0 then raise exception 'remove_referral_link should delete rep_entered links, % left', n; end if;
end $$;

-- 13. Anonymous callers cannot execute the RPCs.
do $$ begin
  perform set_config('role', 'anon', true);
  begin
    perform public.log_referral('e4a00000-0000-0000-0000-000000000001', 'Anon Co');
    raise exception 'anon should not execute log_referral';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `035_referral_rpcs.sql FAIL` (function public.log_referral does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261007000003_referral_rpcs.sql`:

```sql
-- 20261007000003_referral_rpcs.sql
--
-- Spec 4.3: the only write path for referrals. Every function re-checks org,
-- partner/deal visibility and triage rights, because the app role has no
-- INSERT/UPDATE/DELETE on referrals. Errors carry a stable token in the
-- message (mapped to copy in apps/app/src/features/partners/lib/referrals.ts).

-- Shared loader: the caller's referral row, locked, or a not-found error.
create or replace function public._referral_for_update(p_referral_id uuid)
returns referrals language plpgsql security definer set search_path = public as $$
declare
  r referrals;
begin
  select * into r from referrals where id = p_referral_id for update;
  if not found or r.org_id is distinct from public.user_org_id() then
    raise exception 'referral_not_found' using errcode = 'P0002';
  end if;
  return r;
end $$;

create or replace function public._referral_set_note(p_note text)
returns void language sql security definer set search_path = public as $$
  select set_config('navigatr.referral_note', coalesce(p_note, ''), true);
$$;

-- Log: "a partner told me about this business" ------------------------------
create or replace function public.log_referral(
  p_partner_id    uuid,
  p_company_name  text,
  p_contact_name  text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_address       text default null,
  p_place_id      text default null,
  p_industry      text default null,
  p_notes         text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.user_org_id();
  v_company text;
  v_id      uuid;
begin
  if v_org is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  if coalesce(btrim(p_company_name), '') = '' then
    raise exception 'company_required' using errcode = '22023';
  end if;
  select company into v_company from partners where id = p_partner_id;
  insert into referrals (
    org_id, partner_id, direction, source, status, company_name, contact_name,
    contact_email, contact_phone, address, place_id, industry, notes,
    partner_company_snapshot, assigned_user_id, submitted_by_user_id
  ) values (
    v_org, p_partner_id, 'inbound', 'rep_entered', 'submitted', btrim(p_company_name),
    nullif(btrim(p_contact_name), ''), nullif(btrim(p_contact_email), ''),
    nullif(btrim(p_contact_phone), ''), nullif(btrim(p_address), ''),
    nullif(btrim(p_place_id), ''), nullif(btrim(p_industry), ''), coalesce(p_notes, ''),
    v_company, auth.uid(), auth.uid()
  ) returning id into v_id;
  return v_id;
end $$;

-- Link an existing deal (keeps the partner page's "Attach deal" / "Refer a deal") --
create or replace function public._link_deal_to_partner(
  p_partner_id uuid, p_deal_id uuid, p_direction text, p_note text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid := public.user_org_id();
  v_deal    deals;
  v_company text;
  v_id      uuid;
begin
  if v_org is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  select * into v_deal from deals where id = p_deal_id;
  if not found or v_deal.org_id <> v_org or not public.user_can_see_owner(v_deal.owner_id) then
    raise exception 'deal_not_visible' using errcode = '42501';
  end if;
  select company into v_company from partners where id = p_partner_id;
  begin
    insert into referrals (
      org_id, partner_id, direction, source, status, company_name, contact_name,
      contact_email, contact_phone, address, place_id, industry, notes,
      partner_company_snapshot, deal_id, assigned_user_id, submitted_by_user_id,
      triaged_by, triaged_at
    ) values (
      v_org, p_partner_id, p_direction, 'rep_entered',
      public.referral_status_for_stage(v_deal.stage), v_deal.company_name,
      v_deal.contact_name, v_deal.contact_email, v_deal.contact_phone, v_deal.address,
      v_deal.place_id, v_deal.industry, coalesce(p_note, ''), v_company, p_deal_id,
      v_deal.owner_id, auth.uid(), auth.uid(), now()
    ) returning id into v_id;
  exception when unique_violation then
    raise exception 'already_linked' using errcode = '23505';
  end;
  if p_direction = 'inbound' then
    update deals set source_partner_id = p_partner_id
     where id = p_deal_id and source_partner_id is null;
  end if;
  return v_id;
end $$;

create or replace function public.attribute_deal_to_partner(p_partner_id uuid, p_deal_id uuid, p_note text default '')
returns uuid language sql security definer set search_path = public as $$
  select public._link_deal_to_partner(p_partner_id, p_deal_id, 'inbound', p_note)
$$;

create or replace function public.refer_deal_to_partner(p_partner_id uuid, p_deal_id uuid, p_note text default '')
returns uuid language sql security definer set search_path = public as $$
  select public._link_deal_to_partner(p_partner_id, p_deal_id, 'outbound', p_note)
$$;

-- Remove a rep-entered link (today's "x" on the partner page). Same rule as the
-- old partner_deals delete: the creator, a manager, or an admin.
create or replace function public.remove_referral_link(p_partner_id uuid, p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not public.can_see_partner(p_partner_id) then
    raise exception 'partner_not_visible' using errcode = '42501';
  end if;
  delete from referrals
   where partner_id = p_partner_id
     and deal_id = p_deal_id
     and source = 'rep_entered'
     and org_id = public.user_org_id()
     and (submitted_by_user_id = auth.uid()
          or public.user_role() in ('manager','admin')
          or public.caller_is_admin());
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update deals set source_partner_id = null
   where id = p_deal_id and source_partner_id = p_partner_id
     and not exists (select 1 from referrals r
                     where r.deal_id = p_deal_id and r.partner_id = p_partner_id and r.direction = 'inbound');
end $$;

-- Accept: create the deal, tag the lead source, add the first follow-up -------
create or replace function public.accept_referral(p_referral_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r         referrals := public._referral_for_update(p_referral_id);
  v_owner   uuid;
  v_deal    uuid;
  v_dup     uuid;
  v_partner text;
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then
    raise exception 'referral_not_submitted' using errcode = '22023';
  end if;
  v_owner := coalesce(r.assigned_user_id, auth.uid());

  begin
    insert into deals (
      org_id, owner_id, company_name, address, industry, contact_name, contact_email,
      contact_phone, value_cents, stage, lead_source, place_id, source_referral_id,
      source_partner_id
    ) values (
      r.org_id, v_owner, r.company_name, r.address, r.industry,
      coalesce(r.contact_name, r.company_name), r.contact_email, coalesce(r.contact_phone, ''),
      null, 'new', 'partner_referral', r.place_id, r.id, r.partner_id
    ) returning id into v_deal;
  exception when unique_violation then
    -- Blocked by the active-deal dedupe (place_id index or name+address trigger).
    select d.id into v_dup
      from deals d
     where d.org_id = r.org_id
       and d.stage not in ('won','lost')
       and ((r.place_id is not null and d.place_id = r.place_id)
            or d.dedupe_key = public.deal_dedupe_key(r.company_name, r.address))
       and public.user_can_see_owner(d.owner_id)
     limit 1;
    return jsonb_build_object('result', 'duplicate', 'deal_id', v_dup);
  end;

  update referrals
     set status = 'accepted', deal_id = v_deal, assigned_user_id = v_owner,
         triaged_by = auth.uid(), triaged_at = now()
   where id = r.id;

  select name into v_partner from partners where id = r.partner_id;
  insert into task (
    org_id, owner_id, type, title, deal_id, earliest_at, target_at, latest_at,
    original_target_at, date_source
  ) values (
    r.org_id, v_owner, 'call', 'Follow up on referral from ' || v_partner, v_deal,
    public.next_business_day(current_date, r.org_id),
    public.next_business_day(current_date, r.org_id),
    public.next_business_day(current_date, r.org_id),
    public.next_business_day(current_date, r.org_id),
    'interval'
  );

  return jsonb_build_object('result', 'accepted', 'deal_id', v_deal);
end $$;

create or replace function public.decline_referral(
  p_referral_id uuid, p_reason referral_decline_reason, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  r referrals := public._referral_for_update(p_referral_id);
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then
    raise exception 'referral_not_submitted' using errcode = '22023';
  end if;
  perform public._referral_set_note(p_note);
  update referrals
     set status = 'declined', decline_reason = p_reason, decline_note = nullif(btrim(p_note), ''),
         triaged_by = auth.uid(), triaged_at = now()
   where id = r.id;
  perform public._referral_set_note('');
end $$;

-- Merge: link to an existing deal the caller can see. Never touches lead_source.
create or replace function public.merge_referral(p_referral_id uuid, p_deal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r      referrals := public._referral_for_update(p_referral_id);
  v_deal deals;
  v_to   referral_status;
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then
    raise exception 'referral_not_submitted' using errcode = '22023';
  end if;
  select * into v_deal from deals where id = p_deal_id;
  if not found or v_deal.org_id <> r.org_id or not public.user_can_see_owner(v_deal.owner_id) then
    raise exception 'deal_not_visible' using errcode = '42501';
  end if;
  begin
    update referrals
       set status = 'accepted', deal_id = p_deal_id,
           assigned_user_id = coalesce(assigned_user_id, auth.uid()),
           triaged_by = auth.uid(), triaged_at = now()
     where id = r.id;
  exception when unique_violation then
    raise exception 'already_linked' using errcode = '23505';
  end;
  v_to := public.referral_status_for_stage(v_deal.stage);
  if v_to <> 'accepted' then
    update referrals set status = v_to where id = r.id;
  end if;
  update deals set source_partner_id = r.partner_id
   where id = p_deal_id and source_partner_id is null;
end $$;

create or replace function public.withdraw_referral(p_referral_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r referrals := public._referral_for_update(p_referral_id);
begin
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if r.status in ('won','lost','declined','withdrawn') then
    raise exception 'referral_closed' using errcode = '22023';
  end if;
  perform public._referral_set_note(p_note);
  update referrals set status = 'withdrawn' where id = r.id;
  perform public._referral_set_note('');
end $$;

-- Reassign (managers/admins). Returns whether the new assignee can see the partner,
-- so the UI can warn (FR-PORT-55).
create or replace function public.reassign_referral(p_referral_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  r       referrals := public._referral_for_update(p_referral_id);
  v_owner uuid;
begin
  if not (public.user_role() in ('manager','admin') or public.caller_is_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.can_triage_referral(r.assigned_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles
                 where id = p_user_id and org_id = r.org_id and deactivated_at is null) then
    raise exception 'assignee_invalid' using errcode = '22023';
  end if;
  if not public.user_can_see_owner(p_user_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update referrals set assigned_user_id = p_user_id where id = r.id;
  select owner_id into v_owner from partners where id = r.partner_id;
  return public.profile_can_see_owner(p_user_id, v_owner);
end $$;

-- Privileges ------------------------------------------------------------------
revoke execute on function public._referral_for_update(uuid)                          from public, anon;
revoke execute on function public._referral_set_note(text)                            from public, anon;
revoke execute on function public._link_deal_to_partner(uuid, uuid, text, text)       from public, anon;

revoke execute on function public.log_referral(uuid, text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.attribute_deal_to_partner(uuid, uuid, text)         from public, anon;
revoke execute on function public.refer_deal_to_partner(uuid, uuid, text)             from public, anon;
revoke execute on function public.remove_referral_link(uuid, uuid)                    from public, anon;
revoke execute on function public.accept_referral(uuid)                               from public, anon;
revoke execute on function public.decline_referral(uuid, referral_decline_reason, text) from public, anon;
revoke execute on function public.merge_referral(uuid, uuid)                          from public, anon;
revoke execute on function public.withdraw_referral(uuid, text)                       from public, anon;
revoke execute on function public.reassign_referral(uuid, uuid)                       from public, anon;

grant execute on function public.log_referral(uuid, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.attribute_deal_to_partner(uuid, uuid, text)          to authenticated;
grant execute on function public.refer_deal_to_partner(uuid, uuid, text)              to authenticated;
grant execute on function public.remove_referral_link(uuid, uuid)                     to authenticated;
grant execute on function public.accept_referral(uuid)                                to authenticated;
grant execute on function public.decline_referral(uuid, referral_decline_reason, text) to authenticated;
grant execute on function public.merge_referral(uuid, uuid)                           to authenticated;
grant execute on function public.withdraw_referral(uuid, text)                        to authenticated;
grant execute on function public.reassign_referral(uuid, uuid)                        to authenticated;
```

Note on the duplicate path in `accept_referral`: the `exception when unique_violation` block rolls back only the failed deal insert (plpgsql subtransaction), so the referral stays `submitted` and nothing else changes. If the name+address trigger raises with errcode `23505` (it does, see 20260804000002 line 126), it is caught the same way as the place_id index.

- [ ] **Step 4: Run the DB tests to verify they pass**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: 033, 034, 035 PASS. If case 3 fails on a NOT NULL column of `deals` or `task`, add the missing column with its documented default to the INSERT (do not relax the constraint) and re-run.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261007000003_referral_rpcs.sql supabase/tests/035_referral_rpcs.sql
git commit -m "feat(referrals): triage + link RPCs (accept creates deal, lead source, first task)"
```

---

### Task 4: Backfill partner_deals, mirror it, freeze app writes

**Files:**
- Create: `supabase/migrations/20261007000004_referrals_backfill_and_freeze.sql`
- Test: `supabase/tests/036_referrals_partner_deals_mirror.sql`

**Interfaces:**
- Consumes: `referrals`, `referral_status_for_stage` (Task 1).
- Produces: trigger `partner_deals_mirror` (AFTER INSERT OR DELETE on `partner_deals`); `partner_deals` has no INSERT/UPDATE/DELETE for `authenticated`. `reset_demo_data_base()` (SECURITY DEFINER, unchanged) keeps seeding through the mirror until a follow-up migration rewrites it and drops `partner_deals`.

- [ ] **Step 1: Write the failing DB test**

Create `supabase/tests/036_referrals_partner_deals_mirror.sql`:

```sql
-- Tests for 20261007000004: partner_deals rows mirror into referrals (this is what
-- the demo reseed relies on), deletes follow, and the app role can no longer write
-- partner_deals. The backfill uses the same SELECT as the mirror insert.
begin;

insert into organizations (id, name, slug, invite_code) values
  ('00000000-0000-0000-0000-0000000000e5', 'Referral Mirror', 'ref-mirror', 'ref-mirror-a1');
insert into auth.users (id, email, aud, role, created_at, updated_at, email_confirmed_at) values
  ('e5000000-0000-0000-0000-000000000001', 'rep@rm.example', 'authenticated', 'authenticated', now(), now(), now());
insert into profiles (id, org_id, role, role_level, full_name, email, role_path) values
  ('e5000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e5', 'rep', 'sales_professional', 'Rep', 'rep@rm.example', 'rep'::ltree);
insert into partners (id, org_id, created_by, owner_id, name, company, type) values
  ('e5a00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e5', 'e5000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'P', 'P CPA', 'cpa');
insert into deals (id, org_id, owner_id, company_name, contact_name, contact_email, contact_phone, value_cents, stage) values
  ('e5d00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e5', 'e5000000-0000-0000-0000-000000000001', 'Won Co', 'C', 'c@rm.example', '+15550005001', 100, 'won');

insert into partner_deals (partner_id, deal_id, org_id, attributed_by) values
  ('e5a00000-0000-0000-0000-000000000001', 'e5d00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e5', 'e5000000-0000-0000-0000-000000000001');

do $$ declare st text; src text; dir text; cn text; snap text; begin
  select status::text, source::text, direction, company_name, partner_company_snapshot
    into st, src, dir, cn, snap
    from referrals where deal_id = 'e5d00000-0000-0000-0000-000000000001';
  if st <> 'won' or src <> 'rep_entered' or dir <> 'inbound' or cn <> 'Won Co' or snap <> 'P CPA' then
    raise exception 'mirror wrong: % % % % %', st, src, dir, cn, snap;
  end if;
end $$;

do $$ declare n int; begin
  delete from partner_deals where deal_id = 'e5d00000-0000-0000-0000-000000000001';
  select count(*) into n from referrals where deal_id = 'e5d00000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'delete should remove the mirrored referral'; end if;
end $$;

do $$ begin
  perform set_config('request.jwt.claim.sub', 'e5000000-0000-0000-0000-000000000001', true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into partner_deals (partner_id, deal_id, org_id, attributed_by) values
      ('e5a00000-0000-0000-0000-000000000001', 'e5d00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e5', 'e5000000-0000-0000-0000-000000000001');
    raise exception 'app role insert into partner_deals should be denied';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: `036_referrals_partner_deals_mirror.sql FAIL` ("mirror wrong" with nulls).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261007000004_referrals_backfill_and_freeze.sql`:

```sql
-- 20261007000004_referrals_backfill_and_freeze.sql
--
-- Spec 4.7. Move every partner_deals link into referrals, then stop the app from
-- writing partner_deals. The table stays for one production promotion so a stale
-- PWA client fails loudly instead of writing somewhere nobody reads; a follow-up
-- migration rewrites reset_demo_data_base() and drops it. Until then the mirror
-- trigger keeps the demo reseed (SECURITY DEFINER, still inserts partner_deals)
-- producing referrals.

-- 1. Backfill ------------------------------------------------------------------
select set_config('navigatr.referral_actor', 'system', true);

insert into referrals (
  org_id, partner_id, direction, source, status, company_name, contact_name,
  contact_email, contact_phone, address, place_id, industry, partner_company_snapshot,
  deal_id, assigned_user_id, submitted_by_user_id, submitted_at, triaged_by,
  triaged_at, notes
)
select pd.org_id, pd.partner_id, pd.direction, 'rep_entered',
       public.referral_status_for_stage(d.stage), d.company_name, d.contact_name,
       d.contact_email, d.contact_phone, d.address, d.place_id, d.industry, p.company,
       pd.deal_id, d.owner_id, pd.attributed_by, pd.attributed_at, pd.attributed_by,
       pd.attributed_at, coalesce(pd.notes, '')
  from partner_deals pd
  join deals d    on d.id = pd.deal_id
  join partners p on p.id = pd.partner_id
on conflict do nothing;

select set_config('navigatr.referral_actor', '', true);

-- 2. Mirror (demo reseed bridge) ------------------------------------------------
create or replace function public.partner_deals_mirror_to_referrals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform set_config('navigatr.referral_actor', 'system', true);
    insert into referrals (
      org_id, partner_id, direction, source, status, company_name, contact_name,
      contact_email, contact_phone, address, place_id, industry, partner_company_snapshot,
      deal_id, assigned_user_id, submitted_by_user_id, submitted_at, triaged_by,
      triaged_at, notes
    )
    select new.org_id, new.partner_id, new.direction, 'rep_entered',
           public.referral_status_for_stage(d.stage), d.company_name, d.contact_name,
           d.contact_email, d.contact_phone, d.address, d.place_id, d.industry, p.company,
           new.deal_id, d.owner_id, new.attributed_by, new.attributed_at, new.attributed_by,
           new.attributed_at, coalesce(new.notes, '')
      from deals d
      join partners p on p.id = new.partner_id
     where d.id = new.deal_id
    on conflict do nothing;
    perform set_config('navigatr.referral_actor', '', true);
    return new;
  end if;
  delete from referrals
   where partner_id = old.partner_id and deal_id = old.deal_id and source = 'rep_entered';
  return old;
end $$;

revoke execute on function public.partner_deals_mirror_to_referrals() from public, anon;

create trigger partner_deals_mirror
  after insert or delete on partner_deals
  for each row execute function public.partner_deals_mirror_to_referrals();

-- 3. Freeze app writes ------------------------------------------------------------
revoke insert, update, delete on partner_deals from authenticated;
```

- [ ] **Step 4: Run the DB tests to verify they pass**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: 033 to 036 PASS; all earlier tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261007000004_referrals_backfill_and_freeze.sql supabase/tests/036_referrals_partner_deals_mirror.sql
git commit -m "feat(referrals): backfill partner_deals into referrals and freeze app writes"
```

---

### Task 5: Referral types, labels, and error copy (frontend lib)

**Files:**
- Create: `apps/app/src/features/partners/lib/referrals.ts`
- Test: `apps/app/src/features/partners/lib/referrals.test.ts`

**Interfaces:**
- Produces:
  - `type ReferralStatus = "submitted" | "accepted" | "working" | "won" | "lost" | "declined" | "withdrawn"`
  - `type ReferralDirection = "inbound" | "outbound"`
  - `type DeclineReason = "duplicate" | "outside_footprint" | "outside_icp" | "insufficient_contact" | "existing_customer" | "withdrawn_by_partner"`
  - `REFERRAL_STATUS_LABEL: Record<ReferralStatus, string>`
  - `REFERRAL_STATUS_BADGE: Record<ReferralStatus, BadgeKind>`
  - `DECLINE_REASON_OPTIONS: Array<{ value: DeclineReason; label: string }>`
  - `isLiveLink(status: ReferralStatus): boolean`
  - `referralErrorMessage(err: unknown, fallback: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// apps/app/src/features/partners/lib/referrals.test.ts
import { describe, it, expect } from "vitest";
import {
  DECLINE_REASON_OPTIONS,
  REFERRAL_STATUS_BADGE,
  REFERRAL_STATUS_LABEL,
  isLiveLink,
  referralErrorMessage,
  type ReferralStatus,
} from "./referrals";

const ALL: ReferralStatus[] = ["submitted", "accepted", "working", "won", "lost", "declined", "withdrawn"];

describe("referral status labels", () => {
  it("labels every status with the internal (rep-facing) name", () => {
    expect(ALL.map((s) => REFERRAL_STATUS_LABEL[s])).toEqual([
      "Submitted", "Accepted", "Working", "Won", "Lost", "Declined", "Withdrawn",
    ]);
  });

  it("gives every status a badge kind", () => {
    for (const s of ALL) expect(REFERRAL_STATUS_BADGE[s]).toBeTruthy();
    expect(REFERRAL_STATUS_BADGE.won).toBe("stage-won");
  });
});

describe("isLiveLink", () => {
  it("treats declined and withdrawn as dead, everything else as live", () => {
    expect(ALL.filter(isLiveLink)).toEqual(["submitted", "accepted", "working", "won", "lost"]);
  });
});

describe("DECLINE_REASON_OPTIONS", () => {
  it("offers the six PRD reason codes in order", () => {
    expect(DECLINE_REASON_OPTIONS.map((o) => o.value)).toEqual([
      "duplicate", "outside_footprint", "outside_icp", "insufficient_contact",
      "existing_customer", "withdrawn_by_partner",
    ]);
    expect(DECLINE_REASON_OPTIONS[0]?.label).toBe("Duplicate of an existing opportunity");
  });
});

describe("referralErrorMessage", () => {
  it("maps server tokens to plain copy", () => {
    expect(referralErrorMessage({ message: "referral_not_submitted" }, "x")).toBe("This referral was already handled.");
    expect(referralErrorMessage({ message: "already_linked" }, "x")).toBe("That deal is already linked to this partner.");
    expect(referralErrorMessage(new Error("deal_not_visible"), "x")).toBe("You can't see that deal.");
    expect(referralErrorMessage({ message: "partner_not_visible" }, "x")).toBe("You can't see that partner.");
    expect(referralErrorMessage({ message: "not_authorized" }, "x")).toBe("You don't have access to do that.");
    expect(referralErrorMessage({ message: "company_required" }, "x")).toBe("Add the business name.");
  });

  it("falls back for unknown errors and non-errors", () => {
    expect(referralErrorMessage({ message: "boom" }, "Couldn't save")).toBe("Couldn't save");
    expect(referralErrorMessage(undefined, "Couldn't save")).toBe("Couldn't save");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- src/features/partners/lib/referrals.test.ts`
Expected: FAIL, cannot resolve `./referrals`.

- [ ] **Step 3: Implement**

```ts
// apps/app/src/features/partners/lib/referrals.ts
/**
 * Referral vocabulary for the in-app (rep-facing) surfaces. Partner-facing
 * labels (Received, In Progress, Not Moving Forward) are a Phase 1 portal
 * concern and must never be mixed in here.
 */
import type { BadgeKind } from "@/components/navigatr/Badge";

export type ReferralStatus =
  | "submitted" | "accepted" | "working" | "won" | "lost" | "declined" | "withdrawn";
export type ReferralDirection = "inbound" | "outbound";
export type DeclineReason =
  | "duplicate" | "outside_footprint" | "outside_icp" | "insufficient_contact"
  | "existing_customer" | "withdrawn_by_partner";

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  submitted: "Submitted",
  accepted: "Accepted",
  working: "Working",
  won: "Won",
  lost: "Lost",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export const REFERRAL_STATUS_BADGE: Record<ReferralStatus, BadgeKind> = {
  submitted: "status-due-soon",
  accepted: "stage-new",
  working: "stage-contacted",
  won: "stage-won",
  lost: "priority-low",
  declined: "priority-low",
  withdrawn: "priority-low",
};

export const DECLINE_REASON_OPTIONS: Array<{ value: DeclineReason; label: string }> = [
  { value: "duplicate", label: "Duplicate of an existing opportunity" },
  { value: "outside_footprint", label: "Outside our service area" },
  { value: "outside_icp", label: "Not a fit for us" },
  { value: "insufficient_contact", label: "Not enough contact info" },
  { value: "existing_customer", label: "Already a customer" },
  { value: "withdrawn_by_partner", label: "Partner withdrew it" },
];

export function isLiveLink(status: ReferralStatus): boolean {
  return status !== "declined" && status !== "withdrawn";
}

const ERROR_COPY: Array<[token: string, copy: string]> = [
  ["referral_not_submitted", "This referral was already handled."],
  ["referral_closed", "This referral is already closed."],
  ["referral_not_found", "That referral no longer exists."],
  ["already_linked", "That deal is already linked to this partner."],
  ["deal_not_visible", "You can't see that deal."],
  ["partner_not_visible", "You can't see that partner."],
  ["assignee_invalid", "That teammate can't take this referral."],
  ["company_required", "Add the business name."],
  ["not_authorized", "You don't have access to do that."],
];

export function referralErrorMessage(err: unknown, fallback: string): string {
  const message =
    err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
      ? (err as { message: string }).message
      : "";
  const hit = ERROR_COPY.find(([token]) => message.includes(token));
  return hit ? hit[1] : fallback;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test -- src/features/partners/lib/referrals.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/partners/lib/referrals.ts apps/app/src/features/partners/lib/referrals.test.ts
git commit -m "feat(referrals): status labels, decline reasons, error copy"
```

---

### Task 6: Partner list and link mutations read/write referrals

**Files:**
- Modify: `apps/app/src/features/partners/hooks/usePartners.ts`
- Modify: `apps/app/src/features/partners/hooks/usePartners.test.tsx`
- Modify: `apps/app/src/features/partners/hooks/useAttributeDeal.ts` and its test
- Modify: `apps/app/src/features/partners/hooks/useReferDeal.ts` and its test
- Modify: `apps/app/src/features/pipeline/components/SendReferralSheet.tsx` (doc comment line 4 only)

**Interfaces:**
- Consumes: RPCs `attribute_deal_to_partner`, `refer_deal_to_partner`, `remove_referral_link` (Task 3); `isLiveLink`, `ReferralStatus` (Task 5).
- Produces: unchanged public hook signatures: `useAttributeDeal().mutateAsync({ partnerId, dealId, notes? })`, `useUnattributeDeal().mutateAsync({ partnerId, dealId })`, `useReferDeal().mutateAsync({ partnerId, dealId, notes? })`. `Partner.attributedDealIds` / `outboundDealIds` now exclude declined and withdrawn referrals and referrals with no deal yet.

- [ ] **Step 1: Update the usePartners test to the new embed (failing)**

In `usePartners.test.tsx`, replace every fixture key `partner_deals:` with `referrals:` and give each entry a status. The three existing fixtures become:

```ts
          referrals: [
            { deal_id: "d-206", direction: "inbound", status: "won" },
            { deal_id: "d-301", direction: "inbound", status: "working" },
            // Outbound link (we referred a deal TO this partner) must be
            // excluded from attribution.
            { deal_id: "d-999", direction: "outbound", status: "accepted" },
          ],
```

```ts
          referrals: [
            { deal_id: "in1", direction: "inbound", status: "accepted" },
            { deal_id: "out1", direction: "outbound", status: "accepted" },
            // No direction -> treated as inbound.
            { deal_id: "in2", status: "accepted" },
          ],
```

```ts
          referrals: null,
```

Rename the test titled `"splits partner_deals into inbound attribution and outbound referrals"` to `"splits referrals into inbound attribution and outbound referrals"`, update the header comment on line 2 to say `referrals`, and add this case after it:

```ts
  it("drops declined, withdrawn, and not-yet-linked referrals from the deal id lists", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "p-4", name: "Filter", company: "Filter Co", type: "cpa_bookkeeper",
          status: "active", phone: null, email: null, city: null,
          last_touch_at: null, next_followup_at: null, notes: "",
          referrals: [
            { deal_id: "keep", direction: "inbound", status: "working" },
            { deal_id: "gone1", direction: "inbound", status: "declined" },
            { deal_id: "gone2", direction: "inbound", status: "withdrawn" },
            { deal_id: null, direction: "inbound", status: "submitted" },
          ],
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePartners(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].attributedDealIds).toEqual(["keep"]);
  });
```

If the test asserts the select string, change its expected `"partner_deals(deal_id, direction), "` to `"referrals(deal_id, direction, status), "`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- src/features/partners/hooks/usePartners.test.tsx`
Expected: FAIL (attributedDealIds empty because the hook still reads `partner_deals`).

- [ ] **Step 3: Implement the usePartners change**

In `usePartners.ts`:
- Replace the header comment sentence about `partner_deals(deal_id)` with: "The nested `referrals(deal_id, direction, status)` select gets each partner's linked deal ids in one round-trip; declined, withdrawn, and not-yet-accepted referrals are dropped."
- Add `import { isLiveLink, type ReferralStatus } from "../lib/referrals";`
- In `PartnerRow`, replace the `partner_deals` field with:

```ts
  // Nested via PostgREST embedded resource (referrals.partner_id FK).
  referrals: Array<{ deal_id: string | null; direction?: string; status: ReferralStatus }> | null;
```

- Replace the first lines of `toPartner` and the two id lists with:

```ts
function toPartner(row: PartnerRow): Partner {
  const links = (row.referrals ?? []).filter(
    (l): l is { deal_id: string; direction?: string; status: ReferralStatus } =>
      l.deal_id !== null && isLiveLink(l.status),
  );
```

(the `attributedDealIds` / `outboundDealIds` expressions below stay exactly as they are).
- In the `.select(...)` string replace `"partner_deals(deal_id, direction), " +` with `"referrals(deal_id, direction, status), " +`.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test -- src/features/partners/hooks/usePartners.test.tsx`
Expected: PASS.

- [ ] **Step 5: Rewrite the attribute/refer hook tests for RPCs (failing)**

Replace the full contents of `useAttributeDeal.test.tsx`:

```tsx
// useAttributeDeal / useUnattributeDeal call the referral RPCs (Partner Portal
// Phase 0). The old partner_deals table is frozen for app writes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAttributeDeal, useUnattributeDeal } from "./useAttributeDeal";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrap(c: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpcMock.mockReset();
  authUserId = "user-1";
});

describe("useAttributeDeal", () => {
  it("calls attribute_deal_to_partner with partner, deal and note", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ref-1", error: null });
    const { result } = renderHook(() => useAttributeDeal(), { wrapper: wrap(client()) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1", notes: "met at chamber" });
    expect(rpcMock).toHaveBeenCalledWith("attribute_deal_to_partner", {
      p_partner_id: "p-1", p_deal_id: "d-1", p_note: "met at chamber",
    });
  });

  it("invalidates partners and referrals on success", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ref-1", error: null });
    const c = client();
    const spy = vi.spyOn(c, "invalidateQueries");
    const { result } = renderHook(() => useAttributeDeal(), { wrapper: wrap(c) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls.map((x) => x[0]?.queryKey)).toEqual([["partners", "list", "user-1"], ["referrals"]]);
  });

  it("surfaces the server error with friendly copy", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "already_linked" } });
    const { result } = renderHook(() => useAttributeDeal(), { wrapper: wrap(client()) });
    await expect(result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" }))
      .rejects.toThrow("That deal is already linked to this partner.");
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useAttributeDeal(), { wrapper: wrap(client()) });
    await expect(result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" })).rejects.toThrow("Not signed in");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("useUnattributeDeal", () => {
  it("calls remove_referral_link", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useUnattributeDeal(), { wrapper: wrap(client()) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });
    expect(rpcMock).toHaveBeenCalledWith("remove_referral_link", { p_partner_id: "p-1", p_deal_id: "d-1" });
  });

  it("maps not_authorized to plain copy", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    const { result } = renderHook(() => useUnattributeDeal(), { wrapper: wrap(client()) });
    await expect(result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" }))
      .rejects.toThrow("You don't have access to do that.");
  });
});
```

Replace the full contents of `useReferDeal.test.tsx`:

```tsx
// useReferDeal records an outbound referral via the refer_deal_to_partner RPC.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useReferDeal } from "./useReferDeal";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrap(c: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpcMock.mockReset();
  authUserId = "user-1";
});

describe("useReferDeal", () => {
  it("calls refer_deal_to_partner with partner, deal and note", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ref-1", error: null });
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(client()) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1", notes: "Q3 referral" });
    expect(rpcMock).toHaveBeenCalledWith("refer_deal_to_partner", {
      p_partner_id: "p-1", p_deal_id: "d-1", p_note: "Q3 referral",
    });
  });

  it("sends an empty note when none is given", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ref-1", error: null });
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(client()) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });
    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({ p_note: "" });
  });

  it("invalidates partners and referrals on success", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ref-1", error: null });
    const c = client();
    const spy = vi.spyOn(c, "invalidateQueries");
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(c) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(client()) });
    await expect(result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" })).rejects.toThrow("Not signed in");
  });

  it("maps server errors to friendly copy", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "deal_not_visible" } });
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(client()) });
    await expect(result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" })).rejects.toThrow("You can't see that deal.");
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/hooks/useAttributeDeal.test.tsx src/features/partners/hooks/useReferDeal.test.tsx`
Expected: FAIL (`supabase.from is not a function`).

- [ ] **Step 7: Implement the hooks**

Replace the full contents of `useAttributeDeal.ts`:

```ts
/**
 * useAttributeDeal: link an existing deal to a partner as an inbound referral.
 * useUnattributeDeal: remove a rep-entered link.
 *
 * Both go through SECURITY DEFINER RPCs (migration 20261007000003); the app
 * role has no direct write access to referrals. On success we refetch the
 * partners list (its embedded referrals drive attributedDealIds) and every
 * referrals query (queue, deal "Referred by").
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { PARTNERS_QUERY_KEY } from "./usePartners";
import { referralErrorMessage } from "../lib/referrals";

export interface AttributeDealInput {
  partnerId: string;
  dealId: string;
  notes?: string;
}

export function useAttributeDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: AttributeDealInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.rpc("attribute_deal_to_partner", {
        p_partner_id: input.partnerId,
        p_deal_id: input.dealId,
        p_note: input.notes ?? "",
      });
      if (error) throw new Error(referralErrorMessage(error, "Could not attribute deal"));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    },
  });
}

export function useUnattributeDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: { partnerId: string; dealId: string }): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.rpc("remove_referral_link", {
        p_partner_id: input.partnerId,
        p_deal_id: input.dealId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Could not remove the link"));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    },
  });
}
```

Replace the full contents of `useReferDeal.ts`:

```ts
/**
 * useReferDeal: record that we referred a deal TO a partner (outbound).
 * Calls the refer_deal_to_partner RPC (migration 20261007000003).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { PARTNERS_QUERY_KEY } from "./usePartners";
import { referralErrorMessage } from "../lib/referrals";

export interface ReferDealInput {
  partnerId: string;
  dealId: string;
  notes?: string;
}

export function useReferDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async (input: ReferDealInput): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.rpc("refer_deal_to_partner", {
        p_partner_id: input.partnerId,
        p_deal_id: input.dealId,
        p_note: input.notes ?? "",
      });
      if (error) throw new Error(referralErrorMessage(error, "Could not refer deal"));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    },
  });
}
```

Before replacing `useReferDeal.ts`, open it and confirm the exported input type name; if it is not `ReferDealInput`, keep the existing name so `SendReferralSheet` still compiles.

In `SendReferralSheet.tsx` line 4, change `outbound referral via useReferDeal (inserts a partner_deals row). Same Radix` to `outbound referral via useReferDeal (refer_deal_to_partner RPC). Same Radix`.

- [ ] **Step 8: Run all partner and pipeline tests**

Run: `pnpm --filter app test -- src/features/partners src/features/pipeline/components/SendReferralSheet`
Expected: PASS. If a page test (for example `PartnerDetailPage.test.tsx`) mocks `supabase.from("partner_deals")`, update that mock to `rpc` in the same way.

- [ ] **Step 9: Commit**

```bash
git add apps/app/src/features/partners/hooks apps/app/src/features/pipeline/components/SendReferralSheet.tsx
git commit -m "feat(referrals): partner list and link mutations use the referrals RPCs"
```

---

### Task 7: Referral queue, triage mutations, and deal referral hooks

**Files:**
- Create: `apps/app/src/features/partners/hooks/useReferralQueue.ts` (+ `useReferralQueue.test.tsx`)
- Create: `apps/app/src/features/partners/hooks/useReferralMutations.ts` (+ `useReferralMutations.test.tsx`)
- Create: `apps/app/src/features/partners/hooks/useDealReferral.ts` (+ `useDealReferral.test.tsx`)

**Interfaces:**
- Consumes: RPCs from Task 3; `referralErrorMessage`, `DeclineReason` (Task 5); `PARTNERS_QUERY_KEY` (usePartners); `DEALS_QUERY_KEY` (`@/features/pipeline/hooks/useDeals`).
- Produces:
  - `interface QueueReferral { id; partnerId; partnerName; partnerCompany; companyName; contactName: string|null; contactEmail: string|null; contactPhone: string|null; address: string|null; placeId: string|null; notes: string; submittedAt: string; assignedUserId: string|null }`
  - `REFERRAL_QUEUE_QUERY_KEY(userId) = ["referrals","queue",userId ?? "anon"]`
  - `useReferralQueue(): UseQueryResult<QueueReferral[]>`
  - `type AcceptResult = { result: "accepted"; dealId: string } | { result: "duplicate"; dealId: string | null }`
  - `useLogReferral()` mutateAsync(`LogReferralInput`) returns `string` (referral id). `LogReferralInput = { partnerId; companyName; contactName?; contactEmail?; contactPhone?; address?; notes? }`
  - `useAcceptReferral()` mutateAsync(`referralId: string`) returns `AcceptResult`
  - `useDeclineReferral()` mutateAsync(`{ referralId; reason: DeclineReason; note? }`)
  - `useMergeReferral()` mutateAsync(`{ referralId; dealId }`)
  - `interface DealReferral { referralId; partnerId; partnerName; partnerCompany }`
  - `useDealReferral(dealId: string | undefined): UseQueryResult<DealReferral | null>`

- [ ] **Step 1: Write the failing tests**

`useReferralQueue.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useReferralQueue } from "./useReferralQueue";

const orderMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "referrals") throw new Error(`unexpected table ${table}`);
      return { select: (...a: unknown[]) => { selectMock(...a); return { eq: (...e: unknown[]) => { eqMock(...e); return { eq: (...e2: unknown[]) => { eqMock(...e2); return { order: orderMock }; } }; } }; } };
    },
  },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => { orderMock.mockReset(); eqMock.mockReset(); selectMock.mockReset(); });

describe("useReferralQueue", () => {
  it("loads submitted inbound referrals oldest first and maps them", async () => {
    orderMock.mockResolvedValueOnce({
      data: [{
        id: "r-1", partner_id: "p-1", company_name: "Fresh Bakery", contact_name: "Ann",
        contact_email: null, contact_phone: "+15550001", address: "5 Oak St", place_id: null,
        notes: "Wants a demo", submitted_at: "2026-10-07T12:00:00Z", assigned_user_id: "user-1",
        partner: { name: "Jane", company: "Jane & Co" },
      }],
      error: null,
    });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqMock.mock.calls).toEqual([["status", "submitted"], ["direction", "inbound"]]);
    expect(orderMock).toHaveBeenCalledWith("submitted_at", { ascending: true });
    expect(result.current.data).toEqual([{
      id: "r-1", partnerId: "p-1", partnerName: "Jane", partnerCompany: "Jane & Co",
      companyName: "Fresh Bakery", contactName: "Ann", contactEmail: null, contactPhone: "+15550001",
      address: "5 Oak St", placeId: null, notes: "Wants a demo",
      submittedAt: "2026-10-07T12:00:00Z", assignedUserId: "user-1",
    }]);
  });

  it("throws the query error", async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

`useReferralMutations.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAcceptReferral, useDeclineReferral, useLogReferral, useMergeReferral } from "./useReferralMutations";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

function setup() {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(c, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={c}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

beforeEach(() => rpcMock.mockReset());

describe("useLogReferral", () => {
  it("calls log_referral with trimmed optional fields as null", async () => {
    rpcMock.mockResolvedValueOnce({ data: "r-9", error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useLogReferral(), { wrapper });
    const id = await result.current.mutateAsync({ partnerId: "p-1", companyName: " Fresh Bakery ", contactPhone: " ", notes: "hi" });
    expect(id).toBe("r-9");
    expect(rpcMock).toHaveBeenCalledWith("log_referral", {
      p_partner_id: "p-1", p_company_name: "Fresh Bakery", p_contact_name: null,
      p_contact_email: null, p_contact_phone: null, p_address: null, p_notes: "hi",
    });
  });
});

describe("useAcceptReferral", () => {
  it("returns accepted with the new deal id and refreshes deals, partners, referrals", async () => {
    rpcMock.mockResolvedValueOnce({ data: { result: "accepted", deal_id: "d-1" }, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).resolves.toEqual({ result: "accepted", dealId: "d-1" });
    expect(rpcMock).toHaveBeenCalledWith("accept_referral", { p_referral_id: "r-1" });
    await waitFor(() => expect(spy.mock.calls.map((x) => x[0]?.queryKey)).toEqual([
      ["referrals"], ["partners", "list", "user-1"], ["deals", "list", "user-1"],
    ]));
  });

  it("returns duplicate without a deal id when the match is not visible", async () => {
    rpcMock.mockResolvedValueOnce({ data: { result: "duplicate", deal_id: null }, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).resolves.toEqual({ result: "duplicate", dealId: null });
  });

  it("maps errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "referral_not_submitted" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).rejects.toThrow("This referral was already handled.");
  });
});

describe("useDeclineReferral", () => {
  it("calls decline_referral with reason and note", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeclineReferral(), { wrapper });
    await result.current.mutateAsync({ referralId: "r-1", reason: "outside_icp", note: "Too big" });
    expect(rpcMock).toHaveBeenCalledWith("decline_referral", { p_referral_id: "r-1", p_reason: "outside_icp", p_note: "Too big" });
  });
});

describe("useMergeReferral", () => {
  it("calls merge_referral", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeReferral(), { wrapper });
    await result.current.mutateAsync({ referralId: "r-1", dealId: "d-7" });
    expect(rpcMock).toHaveBeenCalledWith("merge_referral", { p_referral_id: "r-1", p_deal_id: "d-7" });
  });

  it("maps already_linked", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "already_linked" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1", dealId: "d-7" })).rejects.toThrow("That deal is already linked to this partner.");
  });
});
```

`useDealReferral.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useDealReferral } from "./useDealReferral";

const maybeSingleMock = vi.fn();
const calls: unknown[][] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const chain = {
        select: (...a: unknown[]) => { calls.push(["select", ...a]); return chain; },
        eq: (...a: unknown[]) => { calls.push(["eq", ...a]); return chain; },
        not: (...a: unknown[]) => { calls.push(["not", ...a]); return chain; },
        order: (...a: unknown[]) => { calls.push(["order", ...a]); return chain; },
        limit: (...a: unknown[]) => { calls.push(["limit", ...a]); return chain; },
        maybeSingle: maybeSingleMock,
      };
      return chain;
    },
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => { maybeSingleMock.mockReset(); calls.length = 0; });

describe("useDealReferral", () => {
  it("returns the earliest live inbound referral for the deal", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "r-1", partner_id: "p-1", partner: { name: "Jane", company: "Jane & Co" } }, error: null,
    });
    const { result } = renderHook(() => useDealReferral("d-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ referralId: "r-1", partnerId: "p-1", partnerName: "Jane", partnerCompany: "Jane & Co" });
    expect(calls).toContainEqual(["eq", "deal_id", "d-1"]);
    expect(calls).toContainEqual(["eq", "direction", "inbound"]);
    expect(calls).toContainEqual(["not", "status", "in", "(declined,withdrawn)"]);
  });

  it("returns null when the deal has no referral", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useDealReferral("d-2"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not run without a deal id", () => {
    const { result } = renderHook(() => useDealReferral(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter app test -- src/features/partners/hooks/useReferralQueue.test.tsx src/features/partners/hooks/useReferralMutations.test.tsx src/features/partners/hooks/useDealReferral.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`useReferralQueue.ts`:

```ts
/**
 * useReferralQueue: inbound referrals waiting for triage (status submitted)
 * that the signed-in user can see. RLS does the scoping: a rep sees their own,
 * a manager their team's, an administrator everything including the
 * administrator queue. Oldest first so nothing sits at the bottom.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface QueueReferral {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerCompany: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  placeId: string | null;
  notes: string;
  submittedAt: string;
  assignedUserId: string | null;
}

interface QueueRow {
  id: string;
  partner_id: string;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  place_id: string | null;
  notes: string;
  submitted_at: string;
  assigned_user_id: string | null;
  partner: { name: string; company: string } | null;
}

export const REFERRAL_QUEUE_QUERY_KEY = (userId: string | undefined) =>
  ["referrals", "queue", userId ?? "anon"] as const;

export function useReferralQueue() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: REFERRAL_QUEUE_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<QueueReferral[]> => {
      const { data, error } = await supabase
        .from("referrals")
        .select(
          "id, partner_id, company_name, contact_name, contact_email, contact_phone, " +
            "address, place_id, notes, submitted_at, assigned_user_id, " +
            "partner:partners(name, company)",
        )
        .eq("status", "submitted")
        .eq("direction", "inbound")
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as QueueRow[]).map((r) => ({
        id: r.id,
        partnerId: r.partner_id,
        partnerName: r.partner?.name ?? "",
        partnerCompany: r.partner?.company ?? "",
        companyName: r.company_name,
        contactName: r.contact_name,
        contactEmail: r.contact_email,
        contactPhone: r.contact_phone,
        address: r.address,
        placeId: r.place_id,
        notes: r.notes,
        submittedAt: r.submitted_at,
        assignedUserId: r.assigned_user_id,
      }));
    },
    staleTime: 30_000,
  });
}
```

`useReferralMutations.ts`:

```ts
/**
 * Triage + log mutations for referrals. Each calls one RPC from migration
 * 20261007000003 and refreshes every referrals query, the partners list, and
 * (when a deal can change) the deals list.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { DEALS_QUERY_KEY } from "@/features/pipeline/hooks/useDeals";
import { PARTNERS_QUERY_KEY } from "./usePartners";
import { referralErrorMessage, type DeclineReason } from "../lib/referrals";

export type AcceptResult =
  | { result: "accepted"; dealId: string }
  | { result: "duplicate"; dealId: string | null };

export interface LogReferralInput {
  partnerId: string;
  companyName: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  notes?: string;
}

function blankToNull(v: string | undefined): string | null {
  const t = v?.trim() ?? "";
  return t === "" ? null : t;
}

function useRefresh(includeDeals: boolean) {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    void queryClient.invalidateQueries({ queryKey: PARTNERS_QUERY_KEY(userId) });
    if (includeDeals) void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
  };
}

export function useLogReferral() {
  const refresh = useRefresh(false);
  return useMutation({
    mutationFn: async (input: LogReferralInput): Promise<string> => {
      const { data, error } = await supabase.rpc("log_referral", {
        p_partner_id: input.partnerId,
        p_company_name: input.companyName.trim(),
        p_contact_name: blankToNull(input.contactName),
        p_contact_email: blankToNull(input.contactEmail),
        p_contact_phone: blankToNull(input.contactPhone),
        p_address: blankToNull(input.address),
        p_notes: input.notes?.trim() ?? "",
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't log the referral"));
      return data as string;
    },
    onSuccess: refresh,
  });
}

export function useAcceptReferral() {
  const refresh = useRefresh(true);
  return useMutation({
    mutationFn: async (referralId: string): Promise<AcceptResult> => {
      const { data, error } = await supabase.rpc("accept_referral", { p_referral_id: referralId });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't accept the referral"));
      const raw = data as { result: "accepted" | "duplicate"; deal_id: string | null };
      return raw.result === "accepted"
        ? { result: "accepted", dealId: raw.deal_id as string }
        : { result: "duplicate", dealId: raw.deal_id };
    },
    onSuccess: refresh,
  });
}

export function useDeclineReferral() {
  const refresh = useRefresh(false);
  return useMutation({
    mutationFn: async (input: { referralId: string; reason: DeclineReason; note?: string }): Promise<void> => {
      const { error } = await supabase.rpc("decline_referral", {
        p_referral_id: input.referralId,
        p_reason: input.reason,
        p_note: input.note?.trim() || null,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't decline the referral"));
    },
    onSuccess: refresh,
  });
}

export function useMergeReferral() {
  const refresh = useRefresh(true);
  return useMutation({
    mutationFn: async (input: { referralId: string; dealId: string }): Promise<void> => {
      const { error } = await supabase.rpc("merge_referral", {
        p_referral_id: input.referralId,
        p_deal_id: input.dealId,
      });
      if (error) throw new Error(referralErrorMessage(error, "Couldn't merge the referral"));
    },
    onSuccess: refresh,
  });
}
```

Note: the accept test expects invalidation order `["referrals"]`, partners, deals, matching `useRefresh`.

`useDealReferral.ts`:

```ts
/**
 * useDealReferral: the partner who referred this deal, if any (earliest live
 * inbound referral). Drives the "Referred by" line on Deal Detail.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface DealReferral {
  referralId: string;
  partnerId: string;
  partnerName: string;
  partnerCompany: string;
}

interface Row {
  id: string;
  partner_id: string;
  partner: { name: string; company: string } | null;
}

export function useDealReferral(dealId: string | undefined) {
  return useQuery({
    queryKey: ["referrals", "deal", dealId ?? "none"] as const,
    enabled: Boolean(dealId),
    queryFn: async (): Promise<DealReferral | null> => {
      const { data, error } = await supabase
        .from("referrals")
        .select("id, partner_id, partner:partners(name, company)")
        .eq("deal_id", dealId as string)
        .eq("direction", "inbound")
        .not("status", "in", "(declined,withdrawn)")
        .order("submitted_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as unknown as Row;
      return {
        referralId: row.id,
        partnerId: row.partner_id,
        partnerName: row.partner?.name ?? "",
        partnerCompany: row.partner?.company ?? "",
      };
    },
    staleTime: 30_000,
  });
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter app test -- src/features/partners/hooks/useReferralQueue.test.tsx src/features/partners/hooks/useReferralMutations.test.tsx src/features/partners/hooks/useDealReferral.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/partners/hooks/useReferralQueue.* apps/app/src/features/partners/hooks/useReferralMutations.* apps/app/src/features/partners/hooks/useDealReferral.*
git commit -m "feat(referrals): queue, triage, log, and deal-referral hooks"
```

---

### Task 8: Review sheet (Accept / Decline / Merge)

**Files:**
- Create: `apps/app/src/features/partners/components/ReviewReferralSheet.tsx`
- Test: `apps/app/src/features/partners/components/ReviewReferralSheet.test.tsx`

**Interfaces:**
- Consumes: `QueueReferral` (Task 7), `useAcceptReferral`, `useDeclineReferral`, `useMergeReferral` (Task 7), `DECLINE_REASON_OPTIONS`, `DeclineReason` (Task 5), `usePlaceDuplicateCheck` (`@/features/pipeline/hooks/usePlaceDuplicateCheck`), `useDeals` (`@/features/pipeline/hooks/useDeals`), `Button`, `Select`, `NotesFieldWithMic` (`@/components/navigatr`).
- Produces: `ReviewReferralSheet({ referral: QueueReferral | null; open: boolean; onOpenChange(open: boolean): void })`.

Behavior:
- Title "Review referral". Body: company name, "From {partnerName} · {partnerCompany}", submitted date, contact name / phone / email / address when present, notes.
- On open, runs `checkPlaceDuplicate({ placeId, name: companyName, phone: contactPhone, address })`; when it returns a match, shows "Possible duplicate: {match.companyName} is already in your team's pipeline."
- Three modes. `main`: buttons Accept (primary), Merge, Decline. `decline`: reason `Select` (required) + note field + "Decline referral". `merge`: deal `Select` over open deals from `useDeals()` (stage not won/lost), sorted by company name, + "Merge into deal".
- Accept: on `accepted`, toast "Accepted. Deal created." and close. On `duplicate`, toast "Already in your team's pipeline" and switch to `merge` with the returned deal preselected when not null.
- Errors toast the thrown message and keep the sheet open.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/app/src/features/partners/components/ReviewReferralSheet.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReviewReferralSheet } from "./ReviewReferralSheet";
import type { QueueReferral } from "../hooks/useReferralQueue";

const accept = vi.fn();
const decline = vi.fn();
const merge = vi.fn();
vi.mock("../hooks/useReferralMutations", () => ({
  useAcceptReferral: () => ({ mutateAsync: accept, isPending: false }),
  useDeclineReferral: () => ({ mutateAsync: decline, isPending: false }),
  useMergeReferral: () => ({ mutateAsync: merge, isPending: false }),
}));
const checkPlaceDuplicate = vi.fn();
vi.mock("@/features/pipeline/hooks/usePlaceDuplicateCheck", () => ({
  usePlaceDuplicateCheck: () => ({ checkPlaceDuplicate }),
}));
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: [
    { id: "d-1", companyName: "Zed Cafe", stage: "contacted" },
    { id: "d-2", companyName: "Alpha Gym", stage: "new" },
    { id: "d-3", companyName: "Closed Co", stage: "won" },
  ] }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

const referral: QueueReferral = {
  id: "r-1", partnerId: "p-1", partnerName: "Jane", partnerCompany: "Jane & Co",
  companyName: "Fresh Bakery", contactName: "Ann", contactEmail: "ann@fresh.example",
  contactPhone: "+15550001", address: "5 Oak St", placeId: null, notes: "Wants a demo",
  submittedAt: "2026-10-07T12:00:00Z", assignedUserId: "user-1",
};

function renderSheet(onOpenChange = vi.fn()) {
  render(<ReviewReferralSheet referral={referral} open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

beforeEach(() => {
  accept.mockReset(); decline.mockReset(); merge.mockReset();
  checkPlaceDuplicate.mockReset().mockResolvedValue(null);
  toastSuccess.mockReset(); toastError.mockReset();
});

describe("ReviewReferralSheet", () => {
  it("shows what the partner sent", async () => {
    renderSheet();
    expect(screen.getByText("Fresh Bakery")).toBeInTheDocument();
    expect(screen.getByText(/From Jane · Jane & Co/)).toBeInTheDocument();
    expect(screen.getByText("Wants a demo")).toBeInTheDocument();
    await waitFor(() => expect(checkPlaceDuplicate).toHaveBeenCalledWith({
      placeId: null, name: "Fresh Bakery", phone: "+15550001", address: "5 Oak St",
    }));
  });

  it("warns about a possible duplicate", async () => {
    checkPlaceDuplicate.mockResolvedValueOnce({ tier: "phone", dealId: "d-1", companyName: "Zed Cafe", dealHasPlaceId: false });
    renderSheet();
    expect(await screen.findByText(/Possible duplicate: Zed Cafe is already in your team's pipeline/)).toBeInTheDocument();
  });

  it("accepts and closes", async () => {
    accept.mockResolvedValueOnce({ result: "accepted", dealId: "d-9" });
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(accept).toHaveBeenCalledWith("r-1");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Accepted. Deal created.");
  });

  it("moves to merge when accept hits a duplicate", async () => {
    accept.mockResolvedValueOnce({ result: "duplicate", dealId: "d-1" });
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("button", { name: "Merge into deal" })).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("Already in your team's pipeline");
  });

  it("requires a reason to decline", async () => {
    decline.mockResolvedValueOnce(undefined);
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    const submit = screen.getByRole("button", { name: "Decline referral" });
    expect(submit).toBeDisabled();
  });

  it("keeps the sheet open and toasts on error", async () => {
    accept.mockRejectedValueOnce(new Error("This referral was already handled."));
    const onOpenChange = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("This referral was already handled."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- src/features/partners/components/ReviewReferralSheet.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
// apps/app/src/features/partners/components/ReviewReferralSheet.tsx
/**
 * ReviewReferralSheet: triage one submitted referral. Accept creates the deal
 * (lead source Partner referral, first follow-up task); Decline needs a reason;
 * Merge links it to a deal the rep can already see and leaves that deal's lead
 * source alone. Same Radix Dialog shell as SendReferralSheet.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button, Select, NotesFieldWithMic } from "@/components/navigatr";
import { usePlaceDuplicateCheck } from "@/features/pipeline/hooks/usePlaceDuplicateCheck";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import type { QueueReferral } from "../hooks/useReferralQueue";
import { useAcceptReferral, useDeclineReferral, useMergeReferral } from "../hooks/useReferralMutations";
import { DECLINE_REASON_OPTIONS, type DeclineReason } from "../lib/referrals";

type Mode = "main" | "decline" | "merge";

export interface ReviewReferralSheetProps {
  referral: QueueReferral | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReviewReferralSheet({ referral, open, onOpenChange }: ReviewReferralSheetProps) {
  const accept = useAcceptReferral();
  const decline = useDeclineReferral();
  const merge = useMergeReferral();
  const { checkPlaceDuplicate } = usePlaceDuplicateCheck();
  const { data: deals = [] } = useDeals();

  const [mode, setMode] = React.useState<Mode>("main");
  const [reason, setReason] = React.useState<DeclineReason | "">("");
  const [note, setNote] = React.useState("");
  const [mergeDealId, setMergeDealId] = React.useState("");
  const [dupName, setDupName] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMode("main");
    setReason("");
    setNote("");
    setMergeDealId("");
    setDupName(null);
    if (!open || !referral) return;
    let live = true;
    void checkPlaceDuplicate({
      placeId: referral.placeId,
      name: referral.companyName,
      phone: referral.contactPhone,
      address: referral.address,
    }).then((m) => { if (live) setDupName(m?.companyName ?? null); });
    return () => { live = false; };
  }, [open, referral, checkPlaceDuplicate]);

  const openDeals = React.useMemo(
    () => deals
      .filter((d) => d.stage !== "won" && d.stage !== "lost")
      .sort((a, b) => a.companyName.localeCompare(b.companyName))
      .map((d) => ({ value: d.id, label: d.companyName })),
    [deals],
  );

  if (!referral) return null;

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const onAccept = () => run(async () => {
    const res = await accept.mutateAsync(referral.id);
    if (res.result === "accepted") {
      toast.success("Accepted. Deal created.");
      onOpenChange(false);
      return;
    }
    toast.error("Already in your team's pipeline");
    setMergeDealId(res.dealId ?? "");
    setMode("merge");
  });

  const onDecline = () => run(async () => {
    if (!reason) return;
    await decline.mutateAsync({ referralId: referral.id, reason, note });
    toast.success("Referral declined");
    onOpenChange(false);
  });

  const onMerge = () => run(async () => {
    if (!mergeDealId) return;
    await merge.mutateAsync({ referralId: referral.id, dealId: mergeDealId });
    toast.success("Merged into the existing deal");
    onOpenChange(false);
  });

  const submitted = new Date(referral.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const details: Array<[string, string | null]> = [
    ["Contact", referral.contactName],
    ["Phone", referral.contactPhone],
    ["Email", referral.contactEmail],
    ["Address", referral.address],
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">Review referral</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-body-strong text-text-default">{referral.companyName}</span>
            <span className="text-caption text-text-muted">
              From {referral.partnerName} · {referral.partnerCompany} · {submitted}
            </span>
          </div>

          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            {details.filter(([, v]) => v).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-caption text-text-subtle">{k}</dt>
                <dd className="text-body-md text-text-default">{v}</dd>
              </React.Fragment>
            ))}
          </dl>

          {referral.notes && (
            <p className="whitespace-pre-wrap text-body-md text-text-muted">{referral.notes}</p>
          )}

          {dupName && (
            <p className="rounded-radius-sm bg-status-warning-bg p-3 text-body-sm text-status-warning">
              Possible duplicate: {dupName} is already in your team's pipeline.
            </p>
          )}

          {mode === "main" && (
            <div className="flex flex-col gap-2 pt-1">
              <Button variant="primary" loading={accept.isPending} disabled={accept.isPending} onClick={onAccept}>
                Accept
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("merge")}>Merge</Button>
                <Button variant="secondary" className="flex-1" onClick={() => setMode("decline")}>Decline</Button>
              </div>
            </div>
          )}

          {mode === "decline" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Reason</span>
                <Select
                  value={reason}
                  onValueChange={(v) => setReason(v as DeclineReason)}
                  placeholder="Pick a reason…"
                  options={DECLINE_REASON_OPTIONS}
                />
              </label>
              <NotesFieldWithMic value={note} onChange={setNote} placeholder="Internal note (optional)" />
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!reason || decline.isPending}
                  loading={decline.isPending}
                  onClick={onDecline}
                >
                  Decline referral
                </Button>
              </div>
            </div>
          )}

          {mode === "merge" && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption font-medium text-text-muted">Existing deal</span>
                <Select
                  value={mergeDealId}
                  onValueChange={setMergeDealId}
                  placeholder="Pick a deal…"
                  options={openDeals}
                />
              </label>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setMode("main")}>Back</Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={!mergeDealId || merge.isPending}
                  loading={merge.isPending}
                  onClick={onMerge}
                >
                  Merge into deal
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default ReviewReferralSheet;
```

If `Select`'s `options` prop type is `Array<{ value: string; label: string }>`, `DECLINE_REASON_OPTIONS` satisfies it (its `value` is a string union). If `@testing-library/user-event` is not installed in `apps/app` (check `package.json`), use `fireEvent.click` from `@testing-library/react` in the test instead.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test -- src/features/partners/components/ReviewReferralSheet.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/partners/components/ReviewReferralSheet.*
git commit -m "feat(referrals): review sheet with accept, decline, and merge"
```

---

### Task 9: "Referrals to review" card on Partners and Partner Detail

**Files:**
- Create: `apps/app/src/features/partners/components/ReferralQueueCard.tsx`
- Test: `apps/app/src/features/partners/components/ReferralQueueCard.test.tsx`
- Modify: `apps/app/src/features/partners/pages/PartnersPage.tsx` (render the card directly after the closing `</header>`)
- Modify: `apps/app/src/features/partners/pages/PartnerDetailPage.tsx` (render the card, filtered to this partner, directly before the first `<ReferralSection`)

**Interfaces:**
- Consumes: `useReferralQueue`, `QueueReferral` (Task 7); `ReviewReferralSheet` (Task 8); `Card`, `Button` (`@/components/navigatr`).
- Produces: `ReferralQueueCard({ partnerId?: string })`. Renders nothing while loading, on error, or when the (filtered) queue is empty.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/app/src/features/partners/components/ReferralQueueCard.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ReferralQueueCard } from "./ReferralQueueCard";
import type { QueueReferral } from "../hooks/useReferralQueue";

let queue: QueueReferral[] | undefined;
vi.mock("../hooks/useReferralQueue", () => ({ useReferralQueue: () => ({ data: queue }) }));
vi.mock("./ReviewReferralSheet", () => ({
  ReviewReferralSheet: ({ referral, open }: { referral: QueueReferral | null; open: boolean }) =>
    open ? <div data-testid="sheet">{referral?.companyName}</div> : null,
}));

function q(id: string, partnerId: string, companyName: string): QueueReferral {
  return {
    id, partnerId, partnerName: "Jane", partnerCompany: "Jane & Co", companyName,
    contactName: null, contactEmail: null, contactPhone: null, address: null, placeId: null,
    notes: "", submittedAt: "2026-10-07T12:00:00Z", assignedUserId: null,
  };
}

beforeEach(() => { queue = undefined; });

describe("ReferralQueueCard", () => {
  it("renders nothing when the queue is empty or loading", () => {
    const { container, rerender } = render(<ReferralQueueCard />);
    expect(container).toBeEmptyDOMElement();
    queue = [];
    rerender(<ReferralQueueCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a count and each referral", () => {
    queue = [q("r-1", "p-1", "Fresh Bakery"), q("r-2", "p-2", "Bolt Gym")];
    render(<ReferralQueueCard />);
    expect(screen.getByText("Referrals to review")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Fresh Bakery")).toBeInTheDocument();
    expect(screen.getByText("Bolt Gym")).toBeInTheDocument();
  });

  it("filters to one partner when partnerId is given", () => {
    queue = [q("r-1", "p-1", "Fresh Bakery"), q("r-2", "p-2", "Bolt Gym")];
    render(<ReferralQueueCard partnerId="p-2" />);
    expect(screen.queryByText("Fresh Bakery")).not.toBeInTheDocument();
    expect(screen.getByText("Bolt Gym")).toBeInTheDocument();
  });

  it("opens the review sheet for the clicked referral", () => {
    queue = [q("r-1", "p-1", "Fresh Bakery")];
    render(<ReferralQueueCard />);
    fireEvent.click(screen.getByRole("button", { name: "Review Fresh Bakery" }));
    expect(screen.getByTestId("sheet")).toHaveTextContent("Fresh Bakery");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- src/features/partners/components/ReferralQueueCard.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the card**

```tsx
// apps/app/src/features/partners/components/ReferralQueueCard.tsx
/**
 * ReferralQueueCard: referrals waiting for triage. Hidden when there are none,
 * so it costs no space on a normal day. On Partner Detail it is filtered to
 * that partner.
 */
import * as React from "react";
import { Card, Button } from "@/components/navigatr";
import { useReferralQueue, type QueueReferral } from "../hooks/useReferralQueue";
import { ReviewReferralSheet } from "./ReviewReferralSheet";

export function ReferralQueueCard({ partnerId }: { partnerId?: string }) {
  const { data } = useReferralQueue();
  const [active, setActive] = React.useState<QueueReferral | null>(null);

  const items = React.useMemo(
    () => (data ?? []).filter((r) => !partnerId || r.partnerId === partnerId),
    [data, partnerId],
  );
  if (items.length === 0) return null;

  return (
    <Card padding="md">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-body-strong text-text-default">Referrals to review</h3>
        <span className="rounded-full bg-status-warning-bg px-2 text-caption font-medium tabular-nums text-status-warning">
          {items.length}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {items.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-body-md text-text-default">{r.companyName}</span>
              <span className="truncate text-caption text-text-muted">From {r.partnerName}</span>
            </div>
            <Button variant="secondary" size="sm" aria-label={`Review ${r.companyName}`} onClick={() => setActive(r)}>
              Review
            </Button>
          </li>
        ))}
      </ul>
      <ReviewReferralSheet
        referral={active}
        open={active !== null}
        onOpenChange={(o) => { if (!o) setActive(null); }}
      />
    </Card>
  );
}

export default ReferralQueueCard;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test -- src/features/partners/components/ReferralQueueCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire it into both pages**

In `PartnersPage.tsx`: add `import { ReferralQueueCard } from "../components/ReferralQueueCard";` next to the `AddPartnerSheet` import, and insert `<ReferralQueueCard />` on the line immediately after the header's closing `</header>`.

In `PartnerDetailPage.tsx`: add `import { ReferralQueueCard } from "../components/ReferralQueueCard";` next to the `ReferralSection` import, and insert `<ReferralQueueCard partnerId={partner.id} />` immediately before the first `<ReferralSection` (the "Referred to us" one).

Both page tests render real children; if `PartnersPage.regression-001.test.tsx` or `PartnerDetailPage.test.tsx` now fail because `useReferralQueue` hits an unmocked `supabase.from("referrals")`, add to those test files:

```ts
vi.mock("../components/ReferralQueueCard", () => ({ ReferralQueueCard: () => null }));
```

- [ ] **Step 6: Run partner tests**

Run: `pnpm --filter app test -- src/features/partners`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/partners/components/ReferralQueueCard.* apps/app/src/features/partners/pages
git commit -m "feat(referrals): referrals-to-review card on Partners and Partner Detail"
```

---

### Task 10: "Log a referral" sheet on Partner Detail

**Files:**
- Create: `apps/app/src/features/partners/components/LogReferralSheet.tsx`
- Test: `apps/app/src/features/partners/components/LogReferralSheet.test.tsx`
- Modify: `apps/app/src/features/partners/pages/PartnerDetailPage.tsx`

**Interfaces:**
- Consumes: `useLogReferral`, `LogReferralInput` (Task 7); `Button`, `NotesFieldWithMic` (`@/components/navigatr`).
- Produces: `LogReferralSheet({ open: boolean; onOpenChange(open: boolean): void; partnerId: string; partnerName: string })`.

Behavior: fields Business name (required), Contact name, Phone, Email, Address, Notes (mic). "Log referral" disabled until the business name is non-blank. On success: toast "Referral logged. It's in Referrals to review." and close. On error: toast the message and stay open. Fields reset each time the sheet opens.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/app/src/features/partners/components/LogReferralSheet.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { LogReferralSheet } from "./LogReferralSheet";

const logMock = vi.fn();
vi.mock("../hooks/useReferralMutations", () => ({
  useLogReferral: () => ({ mutateAsync: logMock, isPending: false }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/components/navigatr", async (orig) => {
  const actual = await orig<typeof import("@/components/navigatr")>();
  return {
    ...actual,
    NotesFieldWithMic: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
      <textarea aria-label="Notes" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    ),
  };
});

beforeEach(() => { logMock.mockReset(); toastSuccess.mockReset(); toastError.mockReset(); });

function setup() {
  const onOpenChange = vi.fn();
  render(<LogReferralSheet open onOpenChange={onOpenChange} partnerId="p-1" partnerName="Jane" />);
  return onOpenChange;
}

describe("LogReferralSheet", () => {
  it("needs a business name", () => {
    setup();
    expect(screen.getByRole("button", { name: "Log referral" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Log referral" })).toBeDisabled();
  });

  it("logs the referral with what was typed and closes", async () => {
    logMock.mockResolvedValueOnce("r-1");
    const onOpenChange = setup();
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Fresh Bakery" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+15550001" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Owner is Ann" } });
    fireEvent.click(screen.getByRole("button", { name: "Log referral" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(logMock).toHaveBeenCalledWith({
      partnerId: "p-1", companyName: "Fresh Bakery", contactName: "", contactEmail: "",
      contactPhone: "+15550001", address: "", notes: "Owner is Ann",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Referral logged. It's in Referrals to review.");
  });

  it("stays open on error", async () => {
    logMock.mockRejectedValueOnce(new Error("You can't see that partner."));
    const onOpenChange = setup();
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Fresh Bakery" } });
    fireEvent.click(screen.getByRole("button", { name: "Log referral" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You can't see that partner."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- src/features/partners/components/LogReferralSheet.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the sheet**

```tsx
// apps/app/src/features/partners/components/LogReferralSheet.tsx
/**
 * LogReferralSheet: record "this partner told me about a business" before any
 * deal exists. The referral lands in Referrals to review (status Submitted),
 * where Accept turns it into a deal. Plain fields in Phase 0; the Google place
 * search arrives with the Phase 1 portal form.
 */
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button, NotesFieldWithMic } from "@/components/navigatr";
import { useLogReferral } from "../hooks/useReferralMutations";

export interface LogReferralSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partnerId: string;
  partnerName: string;
}

const EMPTY = { companyName: "", contactName: "", contactPhone: "", contactEmail: "", address: "", notes: "" };

const FIELDS: Array<{ key: keyof typeof EMPTY; label: string; type: string; autoComplete: string }> = [
  { key: "companyName", label: "Business name", type: "text", autoComplete: "organization" },
  { key: "contactName", label: "Contact name", type: "text", autoComplete: "name" },
  { key: "contactPhone", label: "Phone", type: "tel", autoComplete: "tel" },
  { key: "contactEmail", label: "Email", type: "email", autoComplete: "email" },
  { key: "address", label: "Address", type: "text", autoComplete: "street-address" },
];

export function LogReferralSheet({ open, onOpenChange, partnerId, partnerName }: LogReferralSheetProps) {
  const log = useLogReferral();
  const [form, setForm] = React.useState(EMPTY);

  React.useEffect(() => { setForm(EMPTY); }, [open]);

  const set = (key: keyof typeof EMPTY) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const canSubmit = form.companyName.trim() !== "" && !log.isPending;

  const onSubmit = async () => {
    if (!canSubmit) return;
    try {
      await log.mutateAsync({ partnerId, ...form });
      toast.success("Referral logged. It's in Referrals to review.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't log the referral");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-radius-lg bg-surface-default p-5 shadow-card-hover sm:inset-0 sm:bottom-auto sm:top-1/2 sm:max-h-[85dvh] sm:-translate-y-1/2 sm:rounded-radius-lg"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-heading-sm text-text-default">Log a referral from {partnerName}</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="Close" className="rounded-radius-sm p-1 text-text-muted hover:text-text-default">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-text-muted">{f.label}</span>
              <input
                aria-label={f.label}
                type={f.type}
                autoComplete={f.autoComplete}
                value={form[f.key]}
                onChange={(e) => set(f.key)(e.target.value)}
                className="h-11 rounded-radius-sm border border-border-default bg-surface-default px-3 text-body-md text-text-default"
              />
            </label>
          ))}

          <NotesFieldWithMic value={form.notes} onChange={set("notes")} placeholder="What did the partner tell you?" />

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" className="flex-1" disabled={!canSubmit} loading={log.isPending} onClick={onSubmit}>
              Log referral
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default LogReferralSheet;
```

Before finalizing, check whether `@/components/navigatr` exports a text `Input` component used by `AddPartnerSheet`; if it does, use it in place of the raw `<input>` (keeping `aria-label={f.label}` so the test's `getByLabelText` still finds it).

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test -- src/features/partners/components/LogReferralSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the button to Partner Detail**

In `PartnerDetailPage.tsx`:
- Import `LogReferralSheet` from `"../components/LogReferralSheet"`.
- In `PartnerDetailPage`, add `const [logReferralOpen, setLogReferralOpen] = React.useState(false);` beside the other `useState` calls.
- Immediately before `<ReferralQueueCard partnerId={partner.id} />` (added in Task 9), insert:

```tsx
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={() => setLogReferralOpen(true)}>
            Log a referral
          </Button>
        </div>
```

(add `Plus` to the existing `lucide-react` import if it is not already there).
- Next to `<EditPartnerSheet ... />`, add:

```tsx
        <LogReferralSheet
          open={logReferralOpen}
          onOpenChange={setLogReferralOpen}
          partnerId={partner.id}
          partnerName={partner.name}
        />
```

Add a case to `PartnerDetailPage.test.tsx` (mock the sheet so the page test stays focused):

```tsx
vi.mock("../components/LogReferralSheet", () => ({
  LogReferralSheet: ({ open }: { open: boolean }) => (open ? <div data-testid="log-referral-sheet" /> : null),
}));

it("opens the Log a referral sheet", async () => {
  // Render the page exactly as the file's other cases do (reuse its render helper).
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Log a referral" }));
  expect(screen.getByTestId("log-referral-sheet")).toBeInTheDocument();
});
```

Replace `renderPage()` with the render helper the file already uses for its other cases.

- [ ] **Step 6: Run partner tests**

Run: `pnpm --filter app test -- src/features/partners`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/partners/components/LogReferralSheet.* apps/app/src/features/partners/pages/PartnerDetailPage*
git commit -m "feat(referrals): log a referral from the partner page"
```

---

### Task 11: "Referred by" on Deal Detail

**Files:**
- Modify: `apps/app/src/features/pipeline/pages/DealDetailPage.tsx` (`SourceCard`, around line 507)
- Test: `apps/app/src/features/pipeline/pages/DealDetailPage.test.tsx` (add cases; create the file only if it does not exist)

**Interfaces:**
- Consumes: `useDealReferral(dealId)` returning `DealReferral | null` (Task 7).
- Produces: in `SourceCard`, a line "Referred by {partnerName} ({partnerCompany})" linking to `/partners/{partnerId}`, shown only when a referral exists.

- [ ] **Step 1: Write the failing test**

Add to the Deal Detail test file (reuse its existing render helper and deal fixture; the snippet shows the mocks and the two cases):

```tsx
let dealReferral: { referralId: string; partnerId: string; partnerName: string; partnerCompany: string } | null = null;
vi.mock("@/features/partners/hooks/useDealReferral", () => ({
  useDealReferral: () => ({ data: dealReferral }),
}));

it("shows who referred the deal, linking to the partner", async () => {
  dealReferral = { referralId: "r-1", partnerId: "p-1", partnerName: "Jane", partnerCompany: "Jane & Co" };
  renderDealDetail();
  const link = await screen.findByRole("link", { name: "Jane (Jane & Co)" });
  expect(link).toHaveAttribute("href", "/partners/p-1");
  expect(screen.getByText(/Referred by/)).toBeInTheDocument();
});

it("shows no referral line when the deal has none", async () => {
  dealReferral = null;
  renderDealDetail();
  await screen.findByText("Source");
  expect(screen.queryByText(/Referred by/)).not.toBeInTheDocument();
});
```

Replace `renderDealDetail()` with the file's existing render helper.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test -- src/features/pipeline/pages/DealDetailPage.test.tsx`
Expected: FAIL (no "Referred by").

- [ ] **Step 3: Implement**

In `DealDetailPage.tsx`:
- Add `import { useDealReferral } from "@/features/partners/hooks/useDealReferral";` and, if not already imported, `import { Link } from "react-router-dom";`.
- At the top of `SourceCard`, add `const { data: referral } = useDealReferral(deal.id);`.
- Directly after the `{showPathOrigin && (...)}` block, add:

```tsx
      {referral && (
        <p className="mt-3 text-caption text-text-subtle">
          Referred by{" "}
          <Link to={`/partners/${referral.partnerId}`} className="text-text-link underline-offset-2 hover:underline">
            {referral.partnerName} ({referral.partnerCompany})
          </Link>
        </p>
      )}
```

If `text-text-link` is not a defined token (check `tailwind.config` or another link in the file), use the class the file's existing links use.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test -- src/features/pipeline/pages/DealDetailPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/pipeline/pages/DealDetailPage*
git commit -m "feat(referrals): show the referring partner on Deal Detail"
```

---

### Task 12: Full verification and PR to staging

**Files:** none new.

- [ ] **Step 1: Database from zero + every DB test**

Run: `supabase db reset && ./tools/run-db-tests.sh "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
Expected: every test PASS (033 to 036 included), the two documented SKIPs unchanged.

- [ ] **Step 2: Full frontend suite**

Run: `pnpm --filter app test`
Expected: all PASS. Fix any remaining test that mocked `supabase.from("partner_deals")`.

- [ ] **Step 3: Real production build**

Run: `pnpm --filter app build`
Expected: exits 0 (`tsc -b` and `vite build` both succeed).

- [ ] **Step 4: Search for leftovers**

Run: `grep -rn "partner_deals" apps/app/src supabase/functions`
Expected: no hits outside comments that describe the migration history.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "Partner Portal Phase 0: referrals with status, history, and in-app triage" --body "$(cat <<'EOF'
## Summary
- New `referrals` + append-only `referral_status_history`, hierarchy-scoped reads, RPC-only writes
- Referral status follows its deal (new/working/won/lost)
- Accept creates the deal (lead source Partner referral) and a next-business-day call task; Decline needs a reason; Merge links an existing deal and never changes its lead source
- `partner_deals` backfilled into `referrals`, frozen for app writes, mirrored for the demo reseed
- Partners: Referrals to review card; Partner Detail: Log a referral; Deal Detail: Referred by

Spec: docs/superpowers/specs/2026-10-07-partner-portal-design.md (section 4)

## Follow-up (separate PR after one production promotion)
- Rewrite `reset_demo_data_base()` to seed `referrals` directly and drop `partner_deals`

## Test plan
- [ ] DB tests 033 to 036 pass in CI from an empty database
- [ ] `pnpm --filter app test` and `pnpm --filter app build` pass
- [ ] On staging: log a referral, accept it, confirm the deal shows lead source Partner referral, a follow-up task, and "Referred by"
- [ ] On staging: decline with a reason; merge into an existing deal and confirm its lead source is unchanged

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Bind the PR**

Use the ccd_pr `get_status` tool; if it does not report this PR, call `bind_pr` with its URL. Do not merge or promote without the user's go.
