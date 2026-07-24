# Unified Activity Performance Report — Phase 1 Design Spec

**Date:** 2026-07-24
**Status:** Approved (pending spec review)
**Module:** Dashboard reports (repurposes `ActivityToWinReport`)
**PRD:** navigatr-prd-addendum-unified-activity-report (Unified Activity Performance Report). This spec is **Phase 1 only** (PRD §7): merged shell, scope selector, effort allocation band, scope-aware metric strip + columns, rep table + drill-down, rank divergence, reconciliation footer, CSV. Phase 2 (close-date anchoring, dual survivorship metric) and Phase 3 (won-vs-lost comparison) are deferred.

---

## 1. Goal

Consolidate the two current reports (Activities by Sales Rep & Company = effort; Activity-to-Win = effort that converted) into ONE report where **deal outcome is the top-level control**. The user picks a scope (All / Won / Lost / Open) and the same rep → company → activity structure re-reads through that lens with a scope-appropriate metric strip. Surfaces the currently-invisible "effort not converted."

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Replace vs parallel (PRD D-4) | **Replace.** Repurpose the existing `ActivityToWinReport` page + route (`/dashboard/activity-to-win`) into the unified report. Remove the standalone `ActivitiesByRepCompanyReport` page + route (`/dashboard/activities-by-rep`). |
| Report name | "Activity performance". |
| Entry points | Dashboard Activity-to-Win hero widget keeps linking to the report (opens at Won). The managers' "Additional reports" row re-points to the report (opens at All). |
| Default scope (PRD D-5) | Won. |
| "Unlinked" outcome (PRD UAP-6/16) | **Dropped.** Our `activities` require a `deal_id` and every deal has a company, so every activity classifies as won/lost/open; the unlinked segment/footer line would always be zero. (If dealless activities ever exist, revisit.) |
| Anchoring (Phase 1) | **Activity-date window for every scope**, so the band, table, and footer always reconcile. Window label reads "Activity logged in the last N days" for all scopes. The close-date anchoring for Won/Lost (PRD §5.1, UAP-13) is the Phase-2 correction. |
| Scope persistence (PRD UAP-3) | Within the session/page only (React state); not across sessions. |

## 3. Core data model (Phase 1, all client-side, no migration)

Reads `useDeals()` + `useActivitiesForOrg()` (both already RLS-scoped). Every activity is classified by its deal's outcome:
- `classifyDealOutcome(stage)` → `"won"` (stage won) | `"lost"` (stage lost) | `"open"` (anything else).

All counts derive from the **activities table filtered to the activity-date window**, then joined to their deal for outcome + company + owner. This single source keeps the allocation band, rep table, and reconciliation footer tied by construction (PRD UAP-15 invariant).

New pure module `lib/unifiedActivityReport.ts`:
- `type ReportScope = "all" | "won" | "lost" | "open"`.
- `unifiedActivityReport(deals, activities, { scope, range }) → UnifiedReport` where:
  - `band: { won: number; open: number; lost: number; total: number }` — activity counts by outcome in window (drives the allocation band; segments are the legend).
  - `reps: UnifiedRepRow[]` — for the active scope, rep → company rows of per-type counts (call/email/drop_in/appointment/total), plus scope columns: `dealCount`, `valueCents` (won/lost/open deals of that rep/company in scope), and `avgBusinessDays` (won/lost only). Reps with in-window activity but no deals in the active scope still render (null scope cells) per PRD UAP-10.
  - `reconciliation: { total, won, openLost, unattached: 0 }` — footer figures.
  - `rankDivergence: Map<ownerId, { effortRank, outcomeRank }>` — effort rank by total activity volume; outcome rank by the scope's value metric; tag surfaced when `|effortRank - outcomeRank| >= 2` (PRD §4.5).
- `unifiedMetricStrip(deals, activities, { scope, range }) → MetricStripData` — scope-specific metrics (see §4). Reuses the existing `computeActivityToWin` / `computeActivityToLost` engines for the won/lost value + days figures where they already compute them.
- `unifiedReportCsv(reps, scope, nameOf, band) → string` — CSV reflecting the active scope's columns (PRD §4.8), reusing the `escapeCsvCell` formula-injection guard from `repCompanyCsv.ts`.

## 4. Scope-aware metric strip (PRD §4.3)

| Scope | Metrics (Phase 1, computable today) |
|---|---|
| Won | Revenue won (sum won-deal value); Touches per win (total in-window activity / won-deal count); Avg business days to close. |
| Lost | Revenue lost; Touches per loss; Avg business days before loss; Win rate (won / closed). |
| Open | Open pipeline value (sum open-deal value); Touches logged (activity on open deals); Open deal count. |
| All | Total activity; Deals won; Touches per win; Win rate. |

Metrics with insufficient sample show a caveat rather than a misleading number. "Touches on winners" (survivorship) and the precise close-date figures are Phase 2 (PRD UAP-17); Phase 1 shows the honest "touches per win" only.

## 5. Screen (repurposed `ActivityToWinReport.tsx`)

Top to bottom:
1. **Header**: "Activity performance" + the per-scope window label.
2. **Scope selector**: pills All / Won / Lost / Open; Won active by default; sets scope.
3. **Allocation band**: one horizontal bar segmented Won / Open / Lost, each sized by activity share and labeled with its count; each segment is a control that sets scope; doubles as the legend.
4. **Metric strip**: the scope's metrics (§4).
5. **Rep table**: rank + name, an inline activity-mix indicator (the four type colors), the scope's outcome columns; expand a rep → per-company table filtered to the active scope; rank-divergence tag inline; reps with activity but no scope deals render with null cells.
6. **Reconciliation footer**: persistent, non-dismissible: "N logged · X on won · Y on open or lost · 0 unattached."
7. **Export CSV** button (active scope + columns).

Manager/rep behavior: RLS scoping already limits `useDeals`/`useActivitiesForOrg` to the viewer's reps; a rep sees only their own deals (their table is themselves). Existing role handling from the current report is preserved.

## 6. Placement changes
- `ActivityToWinReport.tsx` rebuilt into the unified report (route `/dashboard/activity-to-win` unchanged).
- Dashboard `ActivitiesToWinHero` widget: unchanged behavior (it is the Won-scope headline metric) but its link now opens the unified report (same route, already does).
- `DashboardPage.AdditionalReports`: re-point the managers' row to the unified report (label "Activity performance", subtitle "Activity by outcome, rep, and company"); it can pass an `?scope=all` param or just open the report (which defaults to Won). Remove the `/dashboard/activities-by-rep` route + `ActivitiesByRepCompanyReport` page + its lazy import.
- The old `activitiesReport.ts` (averages-based helpers for the current AW report) and `repCompanyActivity.ts` may be partially reused or retired; reuse `attributeActivities`, the Activity-to-Win/lost engines, and the CSV escaper. Remove any code left with no consumer.

## 7. Non-goals (Phase 2 / 3 / out of scope)
- Close-date anchoring + full-activity-history for Won/Lost + the "deals closed in last N days" labels (Phase 2).
- "Touches on winners" survivorship metric shown adjacent to touches-per-win (Phase 2).
- Won-vs-lost side-by-side comparison toggle (Phase 3, gated on ≥5 deals/side).
- Unlinked activity (not applicable to our schema).
- Persistence Index integration, forecasting/quota, cross-tenant benchmarking, Miles (PRD §8).

## 8. Testing
- Unit tests for `unifiedActivityReport`: the four scopes; the band/reps/footer reconcile (the four-state sum invariant, PRD UAP-15); reps with activity but no scope deals render with null scope cells; rank-divergence tagging at the >=2 boundary; classifyDealOutcome mapping. `unifiedMetricStrip` per scope. `unifiedReportCsv` (header + scope columns + injection guard).
- Component tests: scope selector switches the metric strip + columns + window label together; allocation-band segment click sets scope; drill-down expands a per-company table; reconciliation footer always present.
- Existing tests: the removed rep/company report's tests are deleted with it; update the AW report's tests to the new unified page; no other dashboard tests break. Full `pnpm --filter app test` + `typecheck` green.

## 9. Files (anticipated)
- Create: `lib/unifiedActivityReport.ts` (+ test), possibly `lib/unifiedActivityCsv.ts` (+ test).
- Rewrite: `pages/ActivityToWinReport.tsx` (+ test) into the unified report; likely extract `components/AllocationBand.tsx`, `components/ScopeMetricStrip.tsx`, `components/UnifiedRepTable.tsx` (each tested) to keep the page focused.
- Modify: `App.tsx` (remove the `/dashboard/activities-by-rep` route + lazy import), `DashboardPage.tsx` (re-point the Additional-reports row).
- Remove: `pages/ActivitiesByRepCompanyReport.tsx` (+ test); retire now-unused helpers.

## 10. Rollout
Frontend-only, no migration. Ships by pushing to main; verified via full suite + a visual check on the demo org across all four scopes.
