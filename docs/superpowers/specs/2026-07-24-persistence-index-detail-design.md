# Persistence Index — Detail Display Design Spec

**Date:** 2026-07-24
**Status:** Approved (pending spec review)
**Module:** Dashboard / Persistence Index detail page (`PersistenceIndexReport`)
**PRD:** §3.3.B (navigatr_PRD_Section_3.3.B_Persistence_Index_Consolidated). This spec covers the **display detail** only (FR-DASH-PI series); the server snapshot pipeline, real tenant-wide benchmarks, Response Velocity, and inbound-signal capture are explicitly out of scope (deferred).

---

## 1. Goal

Turn the Persistence Index detail page from a trend-only view into the "underlying details" the PRD describes: show **where the score comes from** (sub-component breakdown), **how it compares** (benchmark lines + markers), and **period context** (stats grid). Frontend-only, using data we can honestly compute today; honestly label what is not yet available.

## 2. What already exists (unchanged foundation)

`PersistenceIndexReport` (reached from the dashboard widget) shows: composite score /100 + target 75 + period delta, time-range pills (1W/1M/3M/6M/1Y), an SVG trend line with a target reference line, a volume bar chart, and (manager/admin) a "by rep" roster that drills into a rep's own trend. Pure engine in `lib/persistenceIndex.ts`:
- `computePersistenceIndex` → `{ composite, followUp: FollowUpResult, cadence: CadenceResult, responseVelocity: {comingSoon:true}, windowDays, targetScore }`. `FollowUpResult = {points, max, hasSample, completionRate, dueCount}`; `CadenceResult = {points, max, hasSample, medianTouchesPerWeek, activeDeals}`.
- `computeTeamPersistenceIndex` → team medians of the same.
- `computePersistenceHistory` → `PersistencePoint[] {date, composite, activityCount}`; `historyDelta`.
- `computePerRepPersistence` → `PerRepScore[]`; `median`, `percentile` helpers exist.

## 3. New display sections

### 3.1 Sub-component breakdown — "Where your score comes from" (FR-DASH-PI-06)
Three rows, always all three (forward-compatible):
- **Follow-Up Discipline**: progress bar filled to `points/max`; label `${points} / 40 · ${round(completionRate*100)}%`; a benchmark tick marking the peer-average position (see §4.2). Shows an "insufficient data" caption when `!hasSample`.
- **Response Velocity**: rendered **greyed with a "Coming soon" chip** and caption "needs inbound capture"; empty bar; never contributes points. (No timing-confidence caveat needed since it is not scored.)
- **Touch Cadence**: progress bar to `points/max`; label `${points} / 30 · ${round((points/30)*100)}%`; peer-average tick; insufficient-data caption when `!hasSample`.

A caption under the three rows: "Score currently reflects the 2 components we can measure today; response velocity joins once inbound capture ships."

Which result feeds it depends on the current view: rep viewing own → the viewer's `computePersistenceIndex`; manager team view → `computeTeamPersistenceIndex` medians; manager with a rep selected → that rep's `computePersistenceIndex`.

### 3.2 Benchmark reference lines + legend (FR-DASH-PI-04, -08)
- The trend chart gains **configurable reference lines** (support 1–3 per FR-DASH-PI-08, not hardcoded two): peer average and top-tier lines as dashed horizontals, plus an optional target line. Add a subtle **area fill** below the rep line.
- A **benchmark legend row** under the chart: "You / <peer-avg label> / <top-tier label>" with small color markers matching the lines.
- Benchmark availability + labels are scope-driven (§4.2). When no peer benchmark is available (rep-scope / solo), the chart falls back to the existing **target line only** and the legend shows just the target.

### 3.3 Stats grid — "This period" (FR-DASH-PI-07)
A responsive grid of the values we can compute from the loaded history + benchmarks:
- **High / Low** (max / min composite over the period), **Period average** (mean of scored composites).
- **Daily activity avg** (mean `activityCount`), **Days above <peer-avg>** (count of scored days with composite > peer average; omitted at rep scope).
- **<peer-avg label>** and **<top-tier label>** (from benchmarks; omitted at rep scope).
The PRD's Logging Coverage cell is omitted for now (it belongs to the separate Coverage feature and is mostly "No data"); note it as deferred. Grid shows only cells with a real value; never fabricate.

## 4. Data & computation (new, all pure + client-side)

### 4.1 New pure functions (in `lib/persistenceIndex.ts` or a sibling `persistenceDetail.ts`, tested)
- `persistenceBenchmarks(composites: (number|null)[])` → `{ repCount, peerAvg: number|null, topDecile: number|null, topPerformer: number|null, strategy: "full"|"top-performer"|"small"|"solo" }` applying §3.3.B.9 degradation by scored-rep count: ≥10 → median + p90(topDecile); 5–9 → median + max(topPerformer), no decile; 2–4 → median only + small-sample caveat; ≤1 → solo (no peer benchmarks). Uses existing `median`/`percentile`.
- `subComponentPeerAverages(deals, activities, {now, windowDays})` → `{ followUpAvgPct: number|null, cadenceAvgPct: number|null, repCount }` = median of each scored rep's follow-up points (as % of 40) and cadence points (as % of 30), for the sub-component ticks. (Requires per-rep sub-component points; extend the per-rep computation or add a `computePerRepBreakdown` returning `{ownerId, composite, followUpPoints|null, cadencePoints|null}`.)
- `persistenceStats(points: PersistencePoint[], peerAvg: number|null)` → `{ high, low, periodAvg, dailyActivityAvg, daysAboveAvg: number|null, scoredDays }`.

### 4.2 Benchmark scope + honesty (client-side reality)
Benchmarks are computed across the reps the **viewer can see** (RLS-scoped), not a true tenant-wide snapshot. Label by scope so it is never misleading:
- **Rep** (sees only self): no peer benchmark → target line only; sub-component ticks omitted; benchmark stats omitted.
- **Manager** (sees their subtree): label **"Team average" / "Team top 10%" / "Top performer"**.
- **Admin** (sees org): label **"Company average" / "Top 10%" / "Top performer"**.
- Small-sample caveat ("Based on N reps") shown for 2–4 reps; the whole benchmark suppressed appropriately below that. A one-line note states benchmarks are computed across visible reps until the nightly server pipeline lands.

### 4.3 Hooks
Add `usePersistenceBenchmarks(windowDays)` composing `useDeals` + `useActivitiesForOrg` (already RLS-scoped) → the benchmark + sub-component-peer numbers. Reuse `usePersistenceIndex` / `useTeamPersistenceIndex` / `usePersistenceHistory` / `usePerRepPersistence` as they are for the per-view result.

## 5. Non-goals (deferred, explicitly)
- Response Velocity real computation; inbound-signal capture (voice / tap-to-timestamp); the `inbound_signal` entity.
- Nightly server `persistence_index_snapshot` / `company_aggregate_snapshot` pipeline + 12-month backfill; formula-versioning + version markers.
- True tenant-wide benchmarks (we use visible-rep approximations, labeled).
- Logging-coverage stat cell; multi-rep overlay; notifications; Industry Average (v2).
- Any DB migration (frontend-only).

## 6. Testing
- Unit tests for `persistenceBenchmarks` (each degradation tier incl. boundaries 1/2/4/5/9/10), `subComponentPeerAverages`, `persistenceStats` (high/low/avg/daysAbove/empty).
- Component tests: sub-component breakdown renders 3 rows incl. the Response Velocity "coming soon" row and a follow-up/cadence bar with the peer tick; stats grid renders computed values and omits benchmark cells at rep scope; benchmark legend/reference-lines appear for manager/admin and fall back to target-only for a rep.
- Existing `PersistenceIndexReport` / `persistenceIndex` tests stay green; full `pnpm --filter app test` + `typecheck` green.

## 7. Files (anticipated)
- `lib/persistenceIndex.ts` (or new `lib/persistenceDetail.ts`) + test — new pure functions.
- `hooks/usePersistenceBenchmarks.ts` + test.
- `pages/PersistenceIndexReport.tsx` — reference-line/area-fill chart, benchmark legend, sub-component breakdown card, stats grid, honesty notes.
- Possibly a small `components/PersistenceSubComponents.tsx` if the page grows unwieldy.

## 8. Rollout
Frontend-only, no migration. Ships by pushing to main; verified via full suite + a visual check on the demo org.
