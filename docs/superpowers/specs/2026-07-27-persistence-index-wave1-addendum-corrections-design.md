# Persistence Index Wave 1: Addendum Corrections (Design Spec)

**Date:** 2026-07-27
**Status:** Approved (addendum is the design authority; proceeding to plan + build)
**Design authority:** `~/Downloads/navigatr-persistence-index-addendum.pdf` (PRD Addendum 3.3.B v1.0, "Approved for build"). This spec implements its corrections to the already-shipped SP-A/SP-B.

---

## 1. Goal

Bring the live Persistence Index into line with Robert's addendum. Seven corrections, all beta-blocking or before-beta.

## 2. Corrections

### C1. Widget manager-only (D-04 / addendum 4.2)
`PersistenceIndexWidget` must render only for managers and admins. Return `null` for other roles (mirrors the `AdditionalReports` manager-only pattern at DashboardPage). The rep (individual) branch code stays in place for the eventual rep-facing re-enablement, just not shown. Robert 4.2: not exposed to Sales Professional level for the duration of beta.

### C2. Re-engagement exclusions (addendum 3.5 / FR-METRIC-RE-03)
A deal must be excluded from the re-engagement denominator when either:
- it has a **future-dated appointment** (a `scheduled_appointments` row for the deal with `status = 'scheduled'` and `start_at > now`), or
- it was **reassigned within the trailing 30 days**.
Current code counts both as misses; test cases "Future appointment booked" and "Reassigned mid-silence" (addendum 3.11) fail today.

Reassignment needs a new `deals.owner_changed_at timestamptz` set by a trigger when `owner_id` changes (none exists). The scoring reads it; a deal with `owner_changed_at > now - 30d` is excluded.

Both scoring implementations must add these exclusions and stay in parity:
- server `supabase/functions/_shared/persistence/score.ts` (`scoreRep`)
- client `apps/app/src/features/dashboard/lib/persistenceIndex.ts` (`computeReEngagement` / `computePersistenceIndex`)

New scoring inputs: `ScoreDeal` gains `owner_changed_at: string | null` and `has_future_appointment: boolean` (the client Deal-adapter and the edge fn Deps populate both). The parity test exercises both exclusions. All 10 addendum 3.11 test cases must pass (FR-METRIC-RE-06).

### C3. Below-floor: no rescaling, out of 60 (R-01 condition 1 / addendum 4.3)
When Follow-Up Discipline is below the volume floor, the score is NOT normalized to 100. Design decision that satisfies all R-01 conditions at once:
- Scoring sets `composite = null` and `insufficientData = true` when `followUp.belowFloor`.
- `composite = null` makes below-floor days a gap in the trend line (C4), excludes the rep from the company median/p90 (null is already filtered), and from the team median.
- The live per-rep / self display, when `insufficientData`, shows the raw partial as "(cadence points + re-engagement points) / 60" with the existing caveat, rather than a /100 number. It never rescales.

### C4. Chart discontinuity + insufficient_data flag (R-01 condition 2 / addendum 4.3)
- Add `insufficient_data boolean not null default false` to `persistence_index_snapshot`; the orchestrator sets it true for below-floor reps and stores `composite = null` for them.
- `computePersistenceHistory` already yields `composite = null` for below-floor days (via C3), so the client trend line breaks there. Confirm the chart renders null as a gap (it already does for null composites).

### C5. capture_source on activities (addendum 4.5)
Add `activities.capture_source text not null default 'manual'` with a check constraint `in ('manual','automatic')`. All current rows default to manual. No behavior change now; it is the field that later separates new email visibility from prior under-logging. (Overlaps SP-E; done here because the addendum says before beta.)

### C6. Disclosure line (addendum 4.7)
The widget (manager audience) carries one line: "Reflects calls, drop-ins, and appointments. Email is not yet captured automatically."

### C7. Display eligible/recovered counts + document episode counting (addendum 3.10, 3.8 / FR-METRIC-RE-05)
Show the re-engagement eligible and recovered counts beside the score in the detail breakdown ("N went quiet, you brought back M"). Document that we count one episode per deal (dedupe to the most recent episode per deal, addendum 3.8), in a code comment on the scoring.

## 3. Config

Add `email_in_scoring: false` to the persistence config defaults (server `config.ts`). Informational for beta; flips with a formula_version bump when email capture ships. Two-stage recalibration (day 30, then email + 30) is process, not built now.

## 4. Company aggregate + team roll-up interaction

Below-floor reps have `composite = null`, so they are already excluded from `computeTeamPersistenceIndex` (median of non-null composites) and from the nightly `persistence_company_snapshot` median/p90. No extra work beyond C3. This is correct: a /60 partial is not comparable to a /100 full score.

## 5. Testing

- Scoring parity test extended with the two new exclusions and the below-floor `composite = null` / `insufficientData` behavior; both implementations agree.
- A test that runs all 10 addendum 3.11 re-engagement scenarios against the (client or shared) scorer and asserts the "Expected result" column (in denominator / not / hit / miss / zero-episodes-30).
- Widget: renders null for a rep; renders for a manager; shows the disclosure line.
- Report/detail: below-floor rep shows "/60" partial + caveat, not a /100 number; eligible/recovered counts render.
- SQL (columns, trigger) verified by the migration + manual QA.
- Full `pnpm --filter app test` + `typecheck` green.

## 6. Deploy (backend steps handed to the user)

Three migrations to paste into the Supabase SQL editor: `deals.owner_changed_at` + trigger; `activities.capture_source`; `persistence_index_snapshot.insufficient_data`. Then redeploy the `compute_persistence_snapshots` edge function (updated flattened file: new exclusions + insufficient_data + email_in_scoring). Frontend ships to main as usual. The nightly job picks up the new logic on its next run; optionally trigger once to refresh.

## 7. Files (anticipated)

- Migrations: `<ts>_deals_owner_changed_at.sql`, `<ts>_activities_capture_source.sql`, `<ts>_persistence_snapshot_insufficient_data.sql`.
- `apps/app/src/features/dashboard/lib/persistenceIndex.ts` (exclusions, below-floor composite null + insufficientData) + tests.
- `supabase/functions/_shared/persistence/score.ts` (same, parity) + tests; `runSnapshots.ts` (set insufficient_data, store null composite) + tests; `config.ts` (email_in_scoring).
- `supabase/functions/compute_persistence_snapshots/index.ts` (fetch scheduled_appointments + owner_changed_at; pass new fields) + refreshed flattened deploy file.
- Client data plumbing: the report/widget hooks (`usePersistenceIndex`, history, roster) must supply `owner_changed_at` + `has_future_appointment` on deals (a small hook reading `scheduled_appointments` for future-appt deal ids; deals already carry owner_changed_at once the column exists).
- `apps/app/src/features/dashboard/components/PersistenceIndexWidget.tsx` (manager-only null, disclosure line).
- `apps/app/src/features/dashboard/components/PersistenceSubComponents.tsx` / `PersistenceIndexReport.tsx` (below-floor /60 display, eligible/recovered counts).
- Parity + 10-case test.

## 8. Non-goals (Wave 2 / deferred, per addendum)

Appointment outcome capture (3.3.B.12), the task object + manual completion control (3.3.B.15, deferred; design-now shape only), team-scoped benchmark lines, Google email/calendar capture.
