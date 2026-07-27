# Persistence Index Wave 1 (Addendum Corrections) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Checkbox (`- [ ]`) steps.

**Goal:** Apply Robert's addendum corrections to the live Persistence Index: manager-only widget, two re-engagement exclusions (future appointment, reassigned-within-30-days), below-floor score shown out of 60 with a broken chart line and an `insufficient_data` flag, `capture_source` on activities, a disclosure line, and displayed eligible/recovered counts.

**Architecture:** Scoring correctness stays mirrored across the client (`persistenceIndex.ts`) and server (`_shared/persistence/score.ts`), guarded by the existing parity test. Below the follow-up floor the composite becomes null (breaks the trend line, drops the rep from company/team aggregates); the live per-rep view shows the raw partial out of 60. Three small migrations add the new columns.

**Design authority:** `docs/superpowers/specs/2026-07-27-persistence-index-wave1-addendum-corrections-design.md` and the addendum PDF it cites.

**Tech Stack:** Supabase (SQL editor migrations), Deno edge fn, TypeScript, vitest.

---

### Task 1: Migrations (owner_changed_at, capture_source, insufficient_data)

**Files:**
- Create: `supabase/migrations/20260727000010_deals_owner_changed_at.sql`
- Create: `supabase/migrations/20260727000011_activities_capture_source.sql`
- Create: `supabase/migrations/20260727000012_persistence_snapshot_insufficient_data.sql`

- [ ] **Step 1: owner_changed_at + trigger.**
```sql
-- 20260727000010_deals_owner_changed_at.sql
-- Interim reassignment guard for Persistence Index re-engagement (addendum 3.7):
-- a last-owner-change timestamp so a deal reassigned within the trailing 30 days
-- can be excluded from the re-engagement denominator. Backfilled to created_at.
alter table deals add column if not exists owner_changed_at timestamptz;
update deals set owner_changed_at = created_at where owner_changed_at is null;
alter table deals alter column owner_changed_at set default now();

create or replace function deals_touch_owner_changed_at()
returns trigger language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id then
    new.owner_changed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists deals_owner_changed_at_trg on deals;
create trigger deals_owner_changed_at_trg
  before update on deals
  for each row execute function deals_touch_owner_changed_at();
```

- [ ] **Step 2: capture_source.**
```sql
-- 20260727000011_activities_capture_source.sql
-- Every activity carries how it was captured (addendum 4.5). All current rows are
-- manual. Later separates new automatic-email visibility from prior under-logging.
alter table activities add column if not exists capture_source text not null default 'manual';
alter table activities drop constraint if exists activities_capture_source_check;
alter table activities add constraint activities_capture_source_check
  check (capture_source in ('manual','automatic'));
```

- [ ] **Step 3: insufficient_data on the snapshot.**
```sql
-- 20260727000012_persistence_snapshot_insufficient_data.sql
-- Below the follow-up volume floor the composite is not comparable to a full
-- 0-100 score (addendum 4.3, R-01). Flag those rows so the trend line breaks and
-- the value is not plotted next to full scores.
alter table persistence_index_snapshot
  add column if not exists insufficient_data boolean not null default false;
```

- [ ] **Step 4: Commit**
```bash
git add -f supabase/migrations/20260727000010_deals_owner_changed_at.sql supabase/migrations/20260727000011_activities_capture_source.sql supabase/migrations/20260727000012_persistence_snapshot_insufficient_data.sql
git commit -m "feat(persistence): Wave 1 migrations (owner_changed_at, capture_source, insufficient_data)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Scoring corrections in both implementations + parity + 10-case test

**Files:**
- Modify: `supabase/functions/_shared/persistence/score.ts` (+ `.test.ts`)
- Modify: `apps/app/src/features/dashboard/lib/persistenceIndex.ts` (+ `.test.ts`)
- Modify: `apps/app/src/features/dashboard/lib/persistenceIndex.parity.test.ts`

Read both scoring files first. Keep the two in lockstep; the parity test enforces it.

- [ ] **Step 1: Extend the deal shape (both files).**
  - Server `ScoreDeal`: add `owner_changed_at: string | null` and `has_future_appointment: boolean`.
  - Client: the app `Deal` type already exists; the re-engagement code reads `owner_changed_at` and `has_future_appointment` off the deal. Add these as optional fields the caller supplies (a Deal may not carry them in every context; treat missing as "no future appointment" / "not recently reassigned"). If editing the shared app `Deal` type is too broad, accept them via the function's deal argument typed structurally in the re-engagement helper.

- [ ] **Step 2: Add the two exclusions to re-engagement (both).** In the active-deal loop, before evaluating onsets, `continue` (exclude the deal) when:
  - `deal.has_future_appointment === true`, or
  - `owner_changed_at` is set and `new Date(owner_changed_at).getTime() > now - lookbackDays*DAY_MS` (reassigned within the trailing window).
  Keep the existing won/lost exclusion.

- [ ] **Step 3: Below-floor composite null + insufficientData (both).** In the composite step: if `followUp.belowFloor` is true, set the returned `composite = null` and add `insufficientData: true` to the result; otherwise `insufficientData: false` and composite as today. (Server `RepScore` gains `insufficientData: boolean`; client `PersistenceIndexResult` gains `insufficientData: boolean`. The existing `caveats.followUpBelowFloor` stays.) Note: the raw partial for display is still derivable from the component points (cadence + reEngagement), so no separate field is needed.

- [ ] **Step 4: Document episode counting.** Add a comment on the re-engagement function: silentCount/reEngagedCount count one episode per deal (dedupe to the most recent qualifying onset per deal), per addendum 3.8.

- [ ] **Step 5: Tests.**
  - Client + server unit tests: a deal with `has_future_appointment` is excluded; a deal with `owner_changed_at` inside the window is excluded, outside the window is included; below-floor -> `composite === null` and `insufficientData === true`, and the two component points are still present for display.
  - Parity test: add fixtures exercising both exclusions and the below-floor null composite; assert client and server agree on composite, insufficientData, and the sub-component points.
  - New 10-case test (in the client test file) implementing addendum 3.11 exactly: for each scenario (Never went quiet 12d; Crossed inside fairness 25d; Silent not recovered 35d; Silent recovered 40d + recovery 5d before D; Silence too old 60d; Note only [no qualifying activity]; Future appointment booked; Went quiet then closed lost; Reassigned mid-silence; Perfect cadence all <21d) assert the Expected result (in denominator / not / hit / miss / zero-episodes-scores-30). Build the fixtures with the new deal fields.

- [ ] **Step 6: Run + PASS**: `pnpm --filter app test -- persistence` (covers both files, parity, and the 10-case test). `pnpm --filter app typecheck` clean.

- [ ] **Step 7: Commit**
```bash
git add supabase/functions/_shared/persistence/score.ts supabase/functions/_shared/persistence/score.test.ts apps/app/src/features/dashboard/lib/persistenceIndex.ts apps/app/src/features/dashboard/lib/persistenceIndex.test.ts apps/app/src/features/dashboard/lib/persistenceIndex.parity.test.ts
git commit -m "feat(persistence): re-engagement exclusions + below-floor null composite (parity + 10 addendum cases)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Server orchestrator + edge function + config

**Files:**
- Modify: `supabase/functions/_shared/persistence/runSnapshots.ts` (+ `.test.ts`)
- Modify: `supabase/functions/_shared/persistence/config.ts` (+ `.test.ts`)
- Modify: `supabase/functions/compute_persistence_snapshots/index.ts`
- Update: the flattened deploy file in the scratchpad note (Task 5 hands it to the user)

- [ ] **Step 1: config.** Add `emailInScoring: false` to `DEFAULT_PERSISTENCE_CONFIG` and map `email_in_scoring` in `resolvePersistenceConfig`. Test the default + override.

- [ ] **Step 2: runSnapshots.** The `RepSnapshotRow` gains `insufficient_data: boolean`. Set it from `scoreRep(...).insufficientData`; when true, `composite` is already null from the scorer (so it is excluded from the `composites` array that feeds median/p90, unchanged). Update the test to assert a below-floor rep row has `insufficient_data: true`, `composite: null`, and is excluded from the company median.

- [ ] **Step 3: edge fn Deps.** `fetchOrgDeals` now also selects `owner_changed_at`, and computes `has_future_appointment` per deal by fetching `scheduled_appointments` for the org (`select deal_id, start_at, status`, filter `status = 'scheduled'` and `start_at > now`), building a Set of deal ids, and setting `has_future_appointment` on each ScoreDeal. Map `owner_changed_at` through.

- [ ] **Step 4: Run + PASS**: `pnpm --filter app test -- persistence`. (Edge fn index.ts has no vitest; it is I/O.)

- [ ] **Step 5: Commit**
```bash
git add supabase/functions/_shared/persistence/ supabase/functions/compute_persistence_snapshots/index.ts
git commit -m "feat(persistence): orchestrator sets insufficient_data; edge fn feeds exclusions + email_in_scoring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Client plumbing + UI (manager-only, disclosure, /60, counts)

**Files:**
- Modify: `apps/app/src/features/dashboard/components/PersistenceIndexWidget.tsx` (+ test)
- Modify: `apps/app/src/features/dashboard/components/PersistenceSubComponents.tsx` and/or `pages/PersistenceIndexReport.tsx` (+ tests)
- Modify: the hooks that build the deal list fed to scoring so deals carry `owner_changed_at` (already on the row once the column exists) and `has_future_appointment`.

- [ ] **Step 1: Deal plumbing.** Wherever `useDeals` (or the persistence hooks) shape the deals passed into `computePersistenceIndex`/history/roster, ensure `owner_changed_at` is selected and a `has_future_appointment` boolean is attached. Add a small hook or reuse an existing appointments query to get the set of deal ids with a future `scheduled_appointments` row (`status = 'scheduled'`, `start_at > now`) for the viewer's scope, and map it onto the deals. If a clean seam does not exist, compute `has_future_appointment` in the persistence hooks by reading a `useScheduledAppointments`-style query. Keep it minimal; missing data means false (no exclusion), which is safe.

- [ ] **Step 2: Widget manager-only + disclosure.** In `PersistenceIndexWidget`, return `null` when `role` is not `manager` or `admin` (mirror the AdditionalReports pattern). In the manager view add the disclosure caption: `Reflects calls, drop-ins, and appointments. Email is not yet captured automatically.`

- [ ] **Step 3: Below-floor /60 display + counts.** In the detail breakdown (`PersistenceSubComponents` / report), when the shown scorecard is `insufficientData` (follow-up below floor), display the score as the partial out of 60 (cadence points + re-engagement points, out of 60) with the existing caveat, instead of a /100 composite. Add the re-engagement eligible/recovered counts beside the re-engagement row: `N went quiet, M brought back` (from `deals_went_silent_count` / `deals_re_engaged_count`, i.e. the scorer's silentCount/reEngagedCount). Confirm the trend chart already renders a null composite as a line break (below-floor days now yield null); if not, break the line on null.

- [ ] **Step 4: Tests.** Widget: null for a rep role, renders + disclosure for a manager. Detail: below-floor rep shows "/60" not "/100" and the caveat; eligible/recovered counts render. History/chart: a below-floor (null-composite) day is a gap.

- [ ] **Step 5: Run + PASS**: `pnpm --filter app test -- PersistenceIndexWidget PersistenceSubComponents PersistenceIndexReport` then the full suite in Task 5.

- [ ] **Step 6: Commit**
```bash
git add apps/app/src/features/dashboard
git commit -m "feat(persistence): manager-only widget + disclosure; below-floor /60 display + re-engagement counts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Full suite + typecheck + push + refreshed deploy handoff

- [ ] **Step 1:** `pnpm --filter app test` all green (incl. parity + 10-case).
- [ ] **Step 2:** `pnpm --filter app typecheck` clean.
- [ ] **Step 3:** `git push origin HEAD:main`.
- [ ] **Step 4: Regenerate the flattened edge-function file** (inline the updated `_shared/persistence/{score,config,runSnapshots}.ts` + `index.ts`, deduping shared helpers, as before) and save it to the scratchpad. Hand the user the deploy checklist:
  1. Run the three Task 1 migrations in the SQL editor (owner_changed_at + trigger, capture_source, insufficient_data).
  2. Re-deploy `compute_persistence_snapshots` with the refreshed flattened file (paste over the existing function, Deploy).
  3. Optionally trigger the job once (the `net.http_post` one-liner) to refresh snapshots with the new logic.
  Frontend is safe to push first (backward compatible: missing new deal fields default to no-exclusion; insufficient_data column defaults false).

---

## Self-review checklist (controller, before dispatch)
- Both scoring impls change together; parity test + 10-case test are the correctness contract. ✓
- Below-floor -> composite null everywhere (client result, snapshot, aggregates), partial /60 only at the live display layer. ✓
- `has_future_appointment` + `owner_changed_at` populated by BOTH the edge fn (Task 3) and the client hooks (Task 4); missing = safe (no exclusion). ✓
- Migrations idempotent; owner_changed_at backfilled to created_at so existing deals are not treated as freshly reassigned. ✓
- Widget manager-only mirrors AdditionalReports; rep branch code retained. ✓
