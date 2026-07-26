# Persistence Index SP-B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the nightly Persistence Index snapshot pipeline: per-rep snapshots + a daily company aggregate (median + p90), a per-tenant config record, a formula-version stamp, and client wiring that feeds the trend chart's company-average / top-decile lines from the aggregate (with an accrual fallback to SP-A's static benchmark). The live today-score and the rep's own trend line stay client-computed (unchanged).

**Architecture:** Mirror the shipped Logging Coverage pipeline exactly. Compute lives in dependency-free `supabase/functions/_shared/persistence/*.ts` (vitest-tested), invoked by a Deno edge function `compute_persistence_snapshots`, fired nightly by pg_cron via pg_net using Vault secrets. Two new tables mirror `coverage_snapshot`'s shape and RLS (service-role write only). A parity test guarantees the ported server scoring matches the app's SP-A client scoring.

**Tech Stack:** Supabase Postgres (migrations pasted into SQL editor), Deno edge functions, pg_cron + pg_net, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-07-26-persistence-index-spB-snapshot-pipeline-design.md`

**Reference (copy these patterns):** `supabase/migrations/20260624000003_coverage_snapshot.sql` (table + RLS + org-consistency trigger), `20260624000004_coverage_snapshot_cron.sql` (cron), `20260625000001_coverage_rollup.sql` (security-definer RPC), `supabase/functions/compute_coverage_snapshots/index.ts` (edge fn I/O), `supabase/functions/_shared/coverage/{runSnapshots,config}.ts`.

---

### Task 1: Migration - config column + two snapshot tables

**Files:**
- Create: `supabase/migrations/20260727000001_persistence_snapshots.sql`

SQL applied via the Supabase SQL editor (no vitest). Read `20260624000003_coverage_snapshot.sql` first to copy the org-consistency trigger + RLS style exactly.

- [ ] **Step 1: Write the migration.** Contents:

```sql
-- 20260727000001_persistence_snapshots.sql
--
-- Persistence Index SP-B: per-tenant config + nightly snapshot tables.
-- Mirrors the Logging Coverage snapshot pattern (20260624000003): denormalized
-- trigger-enforced org_id, unique(user_id, snapshot_date), SELECT-only RLS so
-- ONLY the service-role nightly job writes. NO BACKFILL: tables start empty and
-- accumulate forward from cron start (a deliberate beta choice, per Robert).

-- Per-tenant config (merged over code defaults by resolvePersistenceConfig).
alter table organizations
  add column if not exists persistence_index_config jsonb not null default '{}'::jsonb;

-- Per-rep daily snapshot (manager-visible).
create table if not exists persistence_index_snapshot (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references organizations(id) on delete cascade,
  user_id                   uuid not null references profiles(id) on delete cascade,
  snapshot_date             date not null,
  composite                 numeric,
  followup_points           numeric,
  followup_below_floor      boolean not null default false,
  followup_due_count        int not null default 0,
  cadence_points            numeric,
  reengagement_points       numeric,
  reengagement_rate         numeric,
  deals_went_silent_count   int not null default 0,
  deals_re_engaged_count    int not null default 0,
  response_velocity_points  numeric,        -- permanently null; forward-compat
  formula_version           int not null,
  window_start_date         date not null,
  window_end_date           date not null,
  created_at                timestamptz not null default now(),
  unique (user_id, snapshot_date)
);
create index if not exists persistence_snapshot_user_date_idx on persistence_index_snapshot (user_id, snapshot_date desc);
create index if not exists persistence_snapshot_org_date_idx  on persistence_index_snapshot (org_id, snapshot_date);

-- Per-org daily aggregate (org-visible): powers the company-average + top-decile lines.
create table if not exists persistence_company_snapshot (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  snapshot_date     date not null,
  composite_median  numeric,
  composite_p90     numeric,
  rep_count         int not null default 0,
  formula_version   int not null,
  created_at        timestamptz not null default now(),
  unique (org_id, snapshot_date)
);
create index if not exists persistence_company_snapshot_org_date_idx on persistence_company_snapshot (org_id, snapshot_date desc);

-- Org-consistency trigger for the per-rep table (mirrors coverage_snapshot):
-- force org_id to match the user's org so downstream queries gate on org_id alone.
create or replace function persistence_snapshot_enforce_org()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from profiles where id = new.user_id;
  if v_org is null then raise exception 'user % has no org', new.user_id; end if;
  new.org_id := v_org;
  return new;
end;
$$;
drop trigger if exists persistence_snapshot_enforce_org_trg on persistence_index_snapshot;
create trigger persistence_snapshot_enforce_org_trg
  before insert or update on persistence_index_snapshot
  for each row execute function persistence_snapshot_enforce_org();

-- RLS: SELECT only (service-role writes bypass RLS). No insert/update/delete policy.
alter table persistence_index_snapshot enable row level security;
create policy persistence_snapshot_select on persistence_index_snapshot for select
  using (org_id = public.user_org_id() and (user_id = auth.uid() or public.user_can_see_owner(user_id)));

alter table persistence_company_snapshot enable row level security;
create policy persistence_company_snapshot_select on persistence_company_snapshot for select
  using (org_id = public.user_org_id());
```
Before writing, VERIFY the helper names against the coverage migration: confirm `public.user_org_id()` and `public.user_can_see_owner(uuid)` exist (grep migrations). If `user_can_see_owner` has a different name, use the actual one coverage_snapshot's SELECT policy uses (copy that policy's predicate verbatim).

- [ ] **Step 2: Commit**
```bash
git add -f supabase/migrations/20260727000001_persistence_snapshots.sql
git commit -m "feat(persistence): SP-B migration - config column + snapshot tables + RLS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Ported pure scoring + parity test

**Files:**
- Create: `supabase/functions/_shared/persistence/score.ts`
- Create: `supabase/functions/_shared/persistence/score.test.ts`
- Create: `apps/app/src/features/dashboard/lib/persistenceIndex.parity.test.ts`

Port the SP-A scoring into a dependency-free module using structural types + config params. The parity test is the correctness contract: it proves the port matches the app's shipped `persistenceIndex.ts`.

- [ ] **Step 1: Read the source to port.** Read `apps/app/src/features/dashboard/lib/persistenceIndex.ts` fully. You are porting `computeFollowUpDiscipline`, `computeTouchCadence`, `computeReEngagement`, and the composite logic of `computePersistenceIndex`. The app uses hardcoded constants; the port takes them via a config object whose DEFAULTS equal the app constants (SILENCE 21, FAIRNESS 7, WINDOW 30, FLOOR 8, TARGET_CADENCE 3.5, FOLLOWUP_MAX 40, CADENCE_MAX 30, REENGAGEMENT_MAX 30, FORMULA_VERSION 2).

- [ ] **Step 2: Write `score.ts`** with structural types (no app imports):
```ts
/**
 * Persistence Index scoring, ported from apps/app SP-A persistenceIndex.ts for
 * the nightly snapshot job. Pure + dependency-free (vitest via the _shared
 * include). Params come from resolved tenant config; DEFAULTS equal the app's
 * hardcoded SP-A constants, and persistenceIndex.parity.test.ts asserts this
 * port matches the app implementation so the two cannot drift.
 */
export interface ScoreDeal { id: string; owner_id: string | null; stage: string; }
export interface ScoreActivity { dealId: string; occurredAt: string; followUpDate: string | null; }
export interface ScoreParams {
  followupMax: number; cadenceMax: number; reengagementMax: number;
  targetCadence: number; windowDays: number; silenceThresholdDays: number;
  fairnessWindowDays: number; followupFloor: number; formulaVersion: number;
}
export const DEFAULT_SCORE_PARAMS: ScoreParams = {
  followupMax: 40, cadenceMax: 30, reengagementMax: 30,
  targetCadence: 3.5, windowDays: 30, silenceThresholdDays: 21,
  fairnessWindowDays: 7, followupFloor: 8, formulaVersion: 2,
};
export interface RepScore {
  composite: number | null;
  followupPoints: number; followupBelowFloor: boolean; followupDueCount: number;
  cadencePoints: number;
  reengagementPoints: number; reengagementRate: number | null;
  dealsWentSilentCount: number; dealsReEngagedCount: number;
  formulaVersion: number;
}
// Port the three component computations + composite here, parameterized by
// ScoreParams, returning RepScore. Include a private median/percentile helper
// (do NOT import from apps/app). Mirror the app algorithm EXACTLY (the parity
// test enforces it). Provide: export function scoreRep(deals: ScoreDeal[],
// activities: ScoreActivity[], ownerId: string, now: Date, params: ScoreParams
// = DEFAULT_SCORE_PARAMS): RepScore
```
Implement `scoreRep` fully by porting the app logic (follow-up discipline with the floor -> hasSample=dueCount>=floor; touch cadence tiered points; re-engagement onset algorithm with fairness window and zero-silent-scores-full-max; composite scaled over the components that have a sample). The composite must match the app's `computePersistenceIndex` composite exactly. Include a private `median`/`percentile` (copy the tiny implementations from `apps/app/src/features/dashboard/lib/activityToWin.ts`).

- [ ] **Step 3: Write `score.test.ts`** (vitest): unit tests for `scoreRep` mirroring the SP-A engine tests (zero-silent -> full reengagement max; below-floor -> followupBelowFloor true and excluded from composite; a re-engaged deal; no active deals). Concrete expected numbers.

- [ ] **Step 4: Write the parity test** `apps/app/src/features/dashboard/lib/persistenceIndex.parity.test.ts`:
```ts
// Guards against drift between the app's live scoring (persistenceIndex.ts) and
// the server port (_shared/persistence/score.ts). If these ever disagree on a
// fixture, the build fails. Import the app module via @, the port via relative path.
import { describe, it, expect } from "vitest";
import { computePersistenceIndex } from "./persistenceIndex";
import { scoreRep, DEFAULT_SCORE_PARAMS } from "../../../../../../supabase/functions/_shared/persistence/score";
// (verify the relative path resolves from this file to supabase/functions/_shared/persistence/score.ts)
```
Build a fixture matrix (empty; zero-silent-with-active-deals; below-floor follow-ups; a mix with a re-engaged deal and a still-silent deal) and for each assert `scoreRep(...).composite === computePersistenceIndex(...).composite` AND each sub-component points field matches (followupPoints === followUp.points, cadencePoints === cadence.points, reengagementPoints === reEngagement.points), using `DEFAULT_SCORE_PARAMS` and the same `now`. Use identical camelCase fixtures for both (app Activity is camelCase; ScoreActivity is camelCase).

- [ ] **Step 5: Run tests, confirm PASS**

Run: `pnpm --filter app test -- persistence`
Expected: score.test.ts + parity test pass. If the parity test fails, the port does not match the app; fix the port until identical.

- [ ] **Step 6: Commit**
```bash
git add supabase/functions/_shared/persistence/score.ts supabase/functions/_shared/persistence/score.test.ts apps/app/src/features/dashboard/lib/persistenceIndex.parity.test.ts
git commit -m "feat(persistence): port scoring to _shared for snapshots + parity test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Config resolver + snapshot orchestrator

**Files:**
- Create: `supabase/functions/_shared/persistence/config.ts` (+ `.test.ts`)
- Create: `supabase/functions/_shared/persistence/runSnapshots.ts` (+ `.test.ts`)

Mirror `_shared/coverage/config.ts` and `_shared/coverage/runSnapshots.ts`.

- [ ] **Step 1: Write `config.ts`** mirroring coverage's `resolveCoverageConfig` shape:
```ts
import { DEFAULT_SCORE_PARAMS, type ScoreParams } from "./score.ts";
export const DEFAULT_PERSISTENCE_CONFIG = {
  ...DEFAULT_SCORE_PARAMS,
  coverageCaveatPct: 0.75,   // SP-D consumes; stored now
  coverageSuppressPct: 0.5,
};
export type PersistenceConfig = typeof DEFAULT_PERSISTENCE_CONFIG;
// resolvePersistenceConfig(raw: unknown): PersistenceConfig -- merge org jsonb
// over defaults, rejecting non-finite numbers (copy coverage's `num` guard).
```
Map jsonb snake_case keys (silence_threshold_days, target_cadence, window_days, followup_floor, formula_version, coverage_caveat_pct, coverage_suppress_pct) onto the camelCase config fields. Never throw.

- [ ] **Step 2: Write `config.test.ts`**: empty jsonb -> defaults; partial override merges; non-finite rejected.

- [ ] **Step 3: Write `runSnapshots.ts`** mirroring coverage's orchestrator:
```ts
import { scoreRep, type ScoreDeal, type ScoreActivity } from "./score.ts";
import type { PersistenceConfig } from "./config.ts";
export interface SnapshotDeps {
  listOrgs(): Promise<{ id: string; config: PersistenceConfig }[]>;
  listRepIds(orgId: string): Promise<string[]>;                       // distinct deal owners in org
  fetchOrgDeals(orgId: string): Promise<ScoreDeal[]>;
  fetchOrgActivities(orgId: string): Promise<ScoreActivity[]>;
  upsertRepSnapshot(row: RepSnapshotRow): Promise<void>;
  upsertCompanySnapshot(row: CompanySnapshotRow): Promise<void>;
  log(message: string): void;
}
```
For each org: fetch deals + activities once; for each rep id, `scoreRep(deals, activities, repId, now, config)` -> build a `RepSnapshotRow` (snake_case fields matching the table: org_id, user_id, snapshot_date, composite, followup_points, followup_below_floor, followup_due_count, cadence_points, reengagement_points, reengagement_rate, deals_went_silent_count, deals_re_engaged_count, response_velocity_points: null, formula_version, window_start_date, window_end_date) -> `upsertRepSnapshot`. Collect non-null composites; compute `composite_median` + `composite_p90` (copy the percentile helper) + `rep_count`; `upsertCompanySnapshot` one row per org. Window = trailing `config.windowDays` ending on the run date (UTC), same isoDate helper as coverage. Return a `RunSummary { orgs, reps, repSnapshots, companySnapshots, failures }`. Wrap per-rep work in try/catch (log + failures++), like coverage.

- [ ] **Step 4: Write `runSnapshots.test.ts`**: a fake `SnapshotDeps` with in-memory fixtures for one org + two reps; assert per-rep rows upserted with expected composites and the company row has the expected median/p90/rep_count. Include an org with a rep whose composite is null (excluded from median).

- [ ] **Step 5: Run + PASS**: `pnpm --filter app test -- persistence`

- [ ] **Step 6: Commit**
```bash
git add supabase/functions/_shared/persistence/config.ts supabase/functions/_shared/persistence/config.test.ts supabase/functions/_shared/persistence/runSnapshots.ts supabase/functions/_shared/persistence/runSnapshots.test.ts
git commit -m "feat(persistence): config resolver + snapshot orchestrator (_shared)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Edge function

**Files:**
- Create: `supabase/functions/compute_persistence_snapshots/index.ts`
- Create: `supabase/functions/compute_persistence_snapshots/deno.json`

Mirror `compute_coverage_snapshots/index.ts` exactly (I/O only; all logic in _shared).

- [ ] **Step 1: Write `deno.json`** identical to coverage's:
```json
{
  "imports": {
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2"
  }
}
```

- [ ] **Step 2: Write `index.ts`**: `makeDeps(db)` implementing `SnapshotDeps`:
  - `listOrgs`: `db.from("organizations").select("id, persistence_index_config")` -> `{ id, config: resolvePersistenceConfig(o.persistence_index_config) }`.
  - `listRepIds(orgId)`: distinct `owner_id` from `db.from("deals").select("owner_id").eq("org_id", orgId)` (filter nulls, dedupe).
  - `fetchOrgDeals(orgId)`: `db.from("deals").select("id, owner_id, stage").eq("org_id", orgId)` -> ScoreDeal[].
  - `fetchOrgActivities(orgId)`: activities for the org's deals. Activities have no org_id column, so join via deals: fetch deal ids for the org then `db.from("activities").select("deal_id, occurred_at, follow_up_date").in("deal_id", dealIds)`, mapping to `{ dealId, occurredAt, followUpDate }`. (If the org has many deals, chunk the `.in(...)` in batches of 200; copy the chunk helper from `_shared/chunk.ts` if present.)
  - `upsertRepSnapshot(row)`: `db.from("persistence_index_snapshot").upsert(row, { onConflict: "user_id,snapshot_date" })`.
  - `upsertCompanySnapshot(row)`: `db.from("persistence_company_snapshot").upsert(row, { onConflict: "org_id,snapshot_date" })`.
  - `log`: console.log.
  `Deno.serve` calls `runSnapshots(makeDeps(db), new Date())` and returns the summary, with the same try/catch 500 shape as coverage.

- [ ] **Step 3: Commit** (no vitest for the Deno I/O file)
```bash
git add supabase/functions/compute_persistence_snapshots/
git commit -m "feat(persistence): compute_persistence_snapshots edge function

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Company-series RPC + cron migrations

**Files:**
- Create: `supabase/migrations/20260727000002_persistence_company_series_rpc.sql`
- Create: `supabase/migrations/20260727000003_persistence_snapshot_cron.sql`

- [ ] **Step 1: Write the RPC migration:**
```sql
-- 20260727000002_persistence_company_series_rpc.sql
-- Org daily company-aggregate series for the trend chart's company-average and
-- top-decile lines. Org-scoped via user_org_id(); the client gates by role
-- (reps do not render peer benchmarks). SELECT-only, no mutation.
create or replace function persistence_company_series(p_range_days integer default 90)
returns table (snapshot_date date, composite_median numeric, composite_p90 numeric, rep_count int)
language sql stable security definer set search_path = public as $$
  select s.snapshot_date, s.composite_median, s.composite_p90, s.rep_count
  from persistence_company_snapshot s
  where s.org_id = public.user_org_id()
    and s.snapshot_date >= (current_date - make_interval(days => greatest(1, least(coalesce(p_range_days, 90), 400))))
  order by s.snapshot_date asc;
$$;
grant execute on function persistence_company_series(integer) to authenticated;
```

- [ ] **Step 2: Write the cron migration** mirroring `20260624000004_coverage_snapshot_cron.sql` (read it first; copy structure exactly), using persistence-specific vault secret names:
```sql
-- 20260727000003_persistence_snapshot_cron.sql
-- Nightly Persistence Index snapshot schedule (SP-B). Mirrors the coverage cron.
-- Requires two Vault secrets created by an operator at apply time:
--   persistence_fn_url            (the deployed compute_persistence_snapshots URL)
--   persistence_service_role_key  (service role key)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('persistence-snapshots-nightly')
where exists (select 1 from cron.job where jobname = 'persistence-snapshots-nightly');

select cron.schedule(
  'persistence-snapshots-nightly',
  '30 7 * * *',  -- 07:30 UTC daily (15 min after coverage, to stagger load)
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'persistence_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'persistence_service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 3: Commit**
```bash
git add -f supabase/migrations/20260727000002_persistence_company_series_rpc.sql supabase/migrations/20260727000003_persistence_snapshot_cron.sql
git commit -m "feat(persistence): company-series RPC + nightly snapshot cron

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Client - company-series hook + daily benchmark lines with accrual fallback

**Files:**
- Create: `apps/app/src/features/dashboard/hooks/usePersistenceCompanySeries.ts` (+ test)
- Modify: `apps/app/src/features/dashboard/pages/PersistenceIndexReport.tsx` (feed daily lines into TrendChart; fallback)
- Test: `apps/app/src/features/dashboard/pages/PersistenceIndexReport.test.tsx`

- [ ] **Step 1: Write the hook + failing test.** `usePersistenceCompanySeries(rangeDays)` calls `supabase.rpc("persistence_company_series", { p_range_days: rangeDays })` and returns `{ series: { date, median, p90 }[] }` (map snapshot_date->date etc.), swallowing errors to an empty series (mirror `useCoverageSnapshots`' error handling). Test: mock supabase.rpc, assert it maps rows and returns [] on error.

- [ ] **Step 2: Read the report page** to see how `TrendChart` reference lines are configured (SP-A gave it N configurable dashed lines) and how benchmarks are currently gated by role (`showBenchmarks`, `benchmarkAvgLabel`).

- [ ] **Step 3: Wire the daily lines.** In `PersistenceIndexReport.tsx`, when `showBenchmarks` is true, call `usePersistenceCompanySeries(rangeDays)`. If the returned series has >= 2 dated points, render two daily reference lines from it: company median ("Company average") and p90 ("Top decile"), aligned to the chart's date axis. If fewer than 2 points exist (accrual bridge), fall back to SP-A's existing static client-side benchmark line(s) exactly as today. Do not change the own-line or the today-score. Note in a comment that the daily lines are company-wide (org), a beta simplification vs SP-A's team-scoped static benchmark; label them "Company average" / "Top decile" when the daily series is used.

- [ ] **Step 4: Update tests.** Report page test: with a mocked non-empty company series, assert the daily "Company average"/"Top decile" lines render; with an empty/1-point series, assert the static fallback still renders. Mock the new hook.

- [ ] **Step 5: Run + PASS**: `pnpm --filter app test -- PersistenceIndexReport usePersistenceCompanySeries`

- [ ] **Step 6: Commit**
```bash
git add apps/app/src/features/dashboard/hooks/usePersistenceCompanySeries.ts apps/app/src/features/dashboard/hooks/usePersistenceCompanySeries.test.tsx apps/app/src/features/dashboard/pages/PersistenceIndexReport.tsx apps/app/src/features/dashboard/pages/PersistenceIndexReport.test.tsx
git commit -m "feat(persistence): daily company-average + top-decile lines from snapshots (accrual fallback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Full suite + typecheck + push + deploy handoff

**Files:** none (verification + handoff)

- [ ] **Step 1: Full suite** `pnpm --filter app test` -> all green (includes the _shared persistence tests + parity test via the vitest include).
- [ ] **Step 2: Typecheck** `pnpm --filter app typecheck` -> clean.
- [ ] **Step 3: Push** `git push origin HEAD:main`.
- [ ] **Step 4: Deploy handoff.** Give the user the exact backend checklist (this pipeline is NOT live until these run):
  1. Paste + run the three migrations in the Supabase SQL editor, in order: `20260727000001_persistence_snapshots.sql`, `20260727000002_persistence_company_series_rpc.sql`, then (last) `20260727000003_persistence_snapshot_cron.sql`.
  2. Deploy the `compute_persistence_snapshots` edge function (flattened single-file paste into the dashboard, per project norm) and copy its invoke URL.
  3. Create two Vault secrets: `persistence_fn_url` (the edge function URL) and `persistence_service_role_key` (the service role key). The cron migration reads these; run it AFTER they exist (or re-run it).
  4. Confirm pg_cron + pg_net are enabled (the cron migration creates them; Supabase may require enabling pg_cron in the dashboard first).
  5. Optional seed: invoke the edge function once manually so day-one snapshots exist and the company lines are not empty on launch.
  Note: the frontend is backward-compatible (empty company series falls back to the static benchmark), so pushing the frontend before the backend is applied is safe.

---

## Self-review checklist (controller, before dispatch)

- Table columns in Task 1 match the RepSnapshotRow fields the orchestrator (Task 3) and edge fn (Task 4) write. Cross-check field names. ✓
- Parity test (Task 2) is the correctness contract for the port; it must compare composite AND each sub-component. ✓
- RPC (Task 5) is org-scoped; client gates by role (Task 6). ✓
- Vault secret names match between the cron migration (Task 5) and the deploy handoff (Task 7): `persistence_fn_url`, `persistence_service_role_key`. ✓
- No backfill anywhere (documented in Task 1 header). ✓
- Verify `user_can_see_owner` / `user_org_id` helper names against the actual coverage migration before writing Task 1's RLS. (Flagged in Task 1 Step 1.)
