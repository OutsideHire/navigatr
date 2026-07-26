# Persistence Index SP-A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace Response Velocity with a computable Re-engagement After Silence component (formula 40/30/30), add a Follow-Up Discipline volume floor that shows a partial score plus a caveat, and render the sub-component rows from a formula descriptor. Pure client-side.

**Architecture:** All scoring lives in `apps/app/src/features/dashboard/lib/persistenceIndex.ts`. Task 1 rewrites the individual score (new component, floor, descriptor, composite). Task 2 updates the team/per-rep/benchmark aggregates. Task 3 updates the two display components to render from the descriptor. Task 4 rewires the report page and runs the suite. TDD throughout.

**Tech Stack:** TypeScript, vitest + Testing Library, React.

**Spec:** `docs/superpowers/specs/2026-07-26-persistence-index-spA-formula-reengagement-design.md`

---

### Task 1: Engine, individual score (Re-engagement + FUD floor + descriptor + composite)

**Files:**
- Modify: `apps/app/src/features/dashboard/lib/persistenceIndex.ts`
- Test: `apps/app/src/features/dashboard/lib/persistenceIndex.test.ts`

- [ ] **Step 1: Write failing tests** for the new behavior. Add to `persistenceIndex.test.ts` (import the new symbols `computeReEngagement`, `SILENCE_THRESHOLD_DAYS`, `FOLLOWUP_FLOOR`, `REENGAGEMENT_MAX`, `FORMULA_VERSION`). Use a fixed `now = new Date("2026-07-26T00:00:00Z")`. Build `Deal`/`Activity` fixtures inline (match the shapes already used elsewhere in this test file). Cover:

```ts
// Re-engagement: a deal that went silent (>21d gap) then got a later touch counts as re-engaged.
// deal active; activities day 0 and day 25 (gap 25d > 21d), now = day 30 -> onset day21 in [now-30, now-7]=[day0,day23] -> reEngaged. rate 1.0 -> 30.
// Re-engagement: a deal silent with NO later touch (trailing) counts as a miss.
//   one active deal, single activity 25 days before now -> onset = now-4d, which is > fairness cutoff (now-7d) => NOT qualifying yet => silentCount 0 => 30 (nothing scored silent).
//   another: single activity 40 days before now -> onset = now-19d, in [now-30,now-7] => qualifying, trailing, reEngaged false => rate 0 -> 0.
// Fairness window: a deal that went silent 3 days ago is excluded (onset after now-7).
// Zero silent but has active deals -> points 30, hasSample true, rate null.
// No active deals -> hasSample false, points 0.
// Silent deal that is stage 'lost' -> excluded from denominator.
// FUD floor: dueCount 1..7 -> hasSample false, belowFloor true; dueCount 0 -> hasSample false, belowFloor false; dueCount >= 8 -> hasSample true, belowFloor false, scores.
// Composite: below-floor FUD is excluded; composite computed over cadence + reEngagement; result.caveats.followUpBelowFloor true; result has no `responseVelocity` field; result.components has 3 entries in order followUp,cadence,reEngagement; result.formulaVersion === 2.
```
Write concrete `it(...)` blocks with real fixtures and explicit expected numbers per the comments above.

- [ ] **Step 2: Run tests, confirm FAIL**

Run: `pnpm --filter app test -- persistenceIndex`
Expected: FAIL (symbols undefined; `responseVelocity` still present; no `components`).

- [ ] **Step 3: Implement.** In `persistenceIndex.ts`:

(a) Add constants after the existing ones (after line 19):
```ts
export const REENGAGEMENT_MAX = 30;
export const SILENCE_THRESHOLD_DAYS = 21;
export const FAIRNESS_WINDOW_DAYS = 7;
export const FOLLOWUP_FLOOR = 8;
/** v1 = Follow-Up/Response-Velocity/Cadence. v2 drops Response Velocity
 *  (permanently uncomputable without inbound capture) for Re-engagement After
 *  Silence. SP-B will drive this and the parameters above from a config table. */
export const FORMULA_VERSION = 2;
```

(b) Add `belowFloor: boolean` to `FollowUpResult` and update `computeFollowUpDiscipline`'s two returns:
- the `due.length === 0` return: add `belowFloor: false`.
- the final return: compute `const belowFloor = due.length < FOLLOWUP_FLOOR;` and return `hasSample: !belowFloor`, plus `belowFloor`. (So dueCount 1..7 is excluded from the composite but still carries its computed points/rate for display.)

(c) Add the Re-engagement result type + function (place after `computeTouchCadence`, before the Composite section):
```ts
// ── Re-engagement After Silence ──────────────────────────────────────────

export interface ReEngagementResult {
  points: number;
  max: number;
  hasSample: boolean;
  rate: number | null;
  silentCount: number;
  reEngagedCount: number;
}

/**
 * Scores whether a rep gets back in touch with deals that went quiet. A deal
 * "goes silent" when SILENCE_THRESHOLD_DAYS pass with no logged activity. The
 * denominator is active deals whose silence began inside the trailing window
 * and at least FAIRNESS_WINDOW_DAYS ago (a just-quiet deal has not had a fair
 * chance to be recovered); the numerator is how many then got a later touch.
 * Zero silent deals (with active deals present) scores the full max, not
 * "excluded". Reassignment mid-silence is NOT modeled client-side (SP-B).
 */
export function computeReEngagement(
  deals: Deal[],
  activities: Activity[],
  ownerId: string,
  now: Date,
  windowDays: number = WINDOW_DAYS,
): ReEngagementResult {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - windowDays * DAY_MS;
  const fairnessCutoffMs = nowMs - FAIRNESS_WINDOW_DAYS * DAY_MS;
  const silenceMs = SILENCE_THRESHOLD_DAYS * DAY_MS;

  const activeDeals = deals.filter(
    (d) => d.owner_id === ownerId && d.stage !== "won" && d.stage !== "lost",
  );
  if (activeDeals.length === 0) {
    return { points: 0, max: REENGAGEMENT_MAX, hasSample: false, rate: null, silentCount: 0, reEngagedCount: 0 };
  }

  const byDeal = new Map<string, number[]>();
  for (const a of activities) {
    const t = new Date(a.occurredAt).getTime();
    if (t > nowMs) continue;
    const g = byDeal.get(a.dealId);
    if (g) g.push(t);
    else byDeal.set(a.dealId, [t]);
  }

  let silentCount = 0;
  let reEngagedCount = 0;
  for (const d of activeDeals) {
    const times = (byDeal.get(d.id) ?? []).slice().sort((x, y) => x - y);
    if (times.length === 0) continue;

    let latestOnset: number | null = null;
    let latestReEngaged = false;
    for (let i = 0; i < times.length; i++) {
      const onset = times[i] + silenceMs;
      const next = i + 1 < times.length ? times[i + 1] : null;
      let reEngaged: boolean;
      if (next === null) {
        if (onset > nowMs) continue; // not yet silent
        reEngaged = false;
      } else if (next - times[i] > silenceMs) {
        reEngaged = true; // a later touch broke the silence
      } else {
        continue; // no silence in this interval
      }
      if (onset < windowStartMs || onset > fairnessCutoffMs) continue; // not a qualifying onset
      if (latestOnset === null || onset > latestOnset) {
        latestOnset = onset;
        latestReEngaged = reEngaged;
      }
    }
    if (latestOnset === null) continue;
    silentCount += 1;
    if (latestReEngaged) reEngagedCount += 1;
  }

  if (silentCount === 0) {
    return { points: REENGAGEMENT_MAX, max: REENGAGEMENT_MAX, hasSample: true, rate: null, silentCount: 0, reEngagedCount: 0 };
  }
  const rate = reEngagedCount / silentCount;
  return { points: Math.round(rate * REENGAGEMENT_MAX), max: REENGAGEMENT_MAX, hasSample: true, rate, silentCount, reEngagedCount };
}
```

(d) Add the descriptor type (near the Composite section):
```ts
export interface ComponentView {
  key: "followUp" | "cadence" | "reEngagement";
  label: string;
  points: number;
  max: number;
  hasSample: boolean;
  belowFloor?: boolean;
}
```

(e) Reshape `PersistenceIndexResult`: remove `responseVelocity: { comingSoon: true }`; add:
```ts
  reEngagement: ReEngagementResult;
  components: ComponentView[];
  caveats: { followUpBelowFloor: boolean };
  formulaVersion: number;
```

(f) Rewrite the body of `computePersistenceIndex` to compute reEngagement, build the descriptor, and scale the composite over `hasSample` components:
```ts
  const followUp = computeFollowUpDiscipline(deals, activities, opts.ownerId, windowStart, windowEnd);
  const cadence = computeTouchCadence(deals, activities, opts.ownerId, windowStart, windowEnd);
  const reEngagement = computeReEngagement(deals, activities, opts.ownerId, windowEnd, windowDays);

  const components: ComponentView[] = [
    { key: "followUp", label: "Follow-up discipline", points: followUp.points, max: followUp.max, hasSample: followUp.hasSample, belowFloor: followUp.belowFloor },
    { key: "cadence", label: "Touch cadence", points: cadence.points, max: cadence.max, hasSample: cadence.hasSample },
    { key: "reEngagement", label: "Re-engagement after silence", points: reEngagement.points, max: reEngagement.max, hasSample: reEngagement.hasSample },
  ];

  let availPoints = 0;
  let availMax = 0;
  for (const c of components) {
    if (c.hasSample) { availPoints += c.points; availMax += c.max; }
  }

  return {
    composite: availMax > 0 ? Math.round((availPoints / availMax) * 100) : null,
    followUp,
    cadence,
    reEngagement,
    components,
    caveats: { followUpBelowFloor: followUp.belowFloor },
    windowDays,
    targetScore: TARGET_SCORE,
    formulaVersion: FORMULA_VERSION,
  };
```
Also update the module doc comment at the top to describe the three components (drop the "response velocity placeholder" language).

- [ ] **Step 4: Run tests, confirm PASS**

Run: `pnpm --filter app test -- persistenceIndex`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/dashboard/lib/persistenceIndex.ts apps/app/src/features/dashboard/lib/persistenceIndex.test.ts
git commit -m "feat(persistence): re-engagement component + FUD floor + formula descriptor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Engine aggregates (team roll-up, per-rep, peer averages)

**Files:**
- Modify: `apps/app/src/features/dashboard/lib/persistenceIndex.ts`
- Modify: `apps/app/src/features/dashboard/hooks/usePersistenceBenchmarks.ts`
- Modify: `apps/app/src/features/dashboard/hooks/usePerRepPersistence.ts` (only if a type reference breaks; it re-exports `PerRepScore`)
- Test: `apps/app/src/features/dashboard/lib/persistenceIndex.test.ts`

- [ ] **Step 1: Write failing tests** in `persistenceIndex.test.ts`:
```ts
// computeTeamPersistenceIndex: result has reEngagement median points + max 30, and NO responseVelocity field.
// computePerRepPersistence: each PerRepScore has reEngagementPoints (number|null).
// subComponentPeerAverages: returns reEngagementAvgPct (median re-engagement points as % of 30, or null).
```

- [ ] **Step 2: Run, confirm FAIL** (`pnpm --filter app test -- persistenceIndex`).

- [ ] **Step 3: Implement.**

(a) `TeamPersistenceIndexResult`: remove `responseVelocity`; add `reEngagement: { points: number | null; max: number }` and `components: ComponentView[]`. In `computeTeamPersistenceIndex`, add:
```ts
  const reEngPts = scored.filter((r) => r.reEngagement.hasSample).map((r) => r.reEngagement.points);
  const teamComponents: ComponentView[] = [
    { key: "followUp", label: "Follow-up discipline", points: fuPts.length ? Math.round(median(fuPts) as number) : 0, max: FOLLOWUP_MAX, hasSample: fuPts.length > 0 },
    { key: "cadence", label: "Touch cadence", points: cadPts.length ? Math.round(median(cadPts) as number) : 0, max: CADENCE_MAX, hasSample: cadPts.length > 0 },
    { key: "reEngagement", label: "Re-engagement after silence", points: reEngPts.length ? Math.round(median(reEngPts) as number) : 0, max: REENGAGEMENT_MAX, hasSample: reEngPts.length > 0 },
  ];
```
and in the return, replace the `responseVelocity` line with:
```ts
    reEngagement: { points: reEngPts.length ? Math.round(median(reEngPts) as number) : null, max: REENGAGEMENT_MAX },
    components: teamComponents,
```

(b) `PerRepScore`: add `reEngagementPoints: number | null;`. In `computePerRepPersistence`, add to the mapped row:
```ts
      reEngagementPoints: r.reEngagement.hasSample ? r.reEngagement.points : null,
```

(c) `SubComponentPeerAverages`: add `reEngagementAvgPct: number | null;`. In `subComponentPeerAverages`, add:
```ts
  const reEng = rows.map((r) => r.reEngagementPoints).filter((p): p is number => p != null);
```
and in the return:
```ts
    reEngagementAvgPct: reEng.length ? Math.round(((median(reEng) as number) / REENGAGEMENT_MAX) * 100) : null,
```

(d) `usePersistenceBenchmarks.ts`: add `reEngagementAvgPct: number | null;` to its exposed type and pass `reEngagementAvgPct: sub.reEngagementAvgPct,` through (mirror the existing followUpAvgPct/cadenceAvgPct lines).

- [ ] **Step 4: Run, confirm PASS** (`pnpm --filter app test -- persistenceIndex`), and run the benchmarks hook test if present (`pnpm --filter app test -- usePersistenceBenchmarks`).

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/dashboard/lib/persistenceIndex.ts apps/app/src/features/dashboard/lib/persistenceIndex.test.ts apps/app/src/features/dashboard/hooks/usePersistenceBenchmarks.ts
git commit -m "feat(persistence): re-engagement in team roll-up, per-rep, peer averages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Display components (widget + sub-component card)

**Files:**
- Modify: `apps/app/src/features/dashboard/components/PersistenceIndexWidget.tsx`
- Modify: `apps/app/src/features/dashboard/components/PersistenceSubComponents.tsx`
- Test: their co-located `.test.tsx` files (update existing; add the new-row + caveat assertions)

- [ ] **Step 1: Write/adjust failing tests.**
- Widget test: assert there is NO "Coming soon" / "Response velocity" text; assert a "Re-engagement after silence" row renders when scored; assert the FUD caveat text renders when `caveats.followUpBelowFloor` (mock the hook result accordingly).
- SubComponents test: assert it renders a Re-engagement row and no "Response velocity"/"coming soon" text; assert a caveat/footnote shows when passed.

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement.**

Widget (`PersistenceIndexWidget.tsx`):
- Delete `ComingSoonRow`.
- Replace the manual per-name bars in BOTH branches with a map over `components` (render a `Bar` for each `c.hasSample` component using `c.label`, `c.points`, `c.max`). Individual branch maps `pi.components`; team branch maps `t.components` (both now carry the descriptor from Tasks 1-2).
- When `caveats.followUpBelowFloor` is true (individual) add a caption line: `Follow-up volume too low to score discipline; showing cadence and re-engagement only.`
- Update the module doc comment (remove Response Velocity "coming soon" language).

SubComponents (`PersistenceSubComponents.tsx`):
- Change the props to take an array plus an optional footnote:
```ts
export function PersistenceSubComponents({
  rows, footnote,
}: {
  rows: { key: string; label: string; points: number | null; max: number; peerPct: number | null }[];
  footnote?: string;
}) {
```
- Render `rows.map((r) => <Row key={r.key} label={r.label} points={r.points} max={r.max} peerPct={r.peerPct} />)`.
- Delete the hardcoded Response Velocity block and the old "response velocity joins once inbound capture ships" caption. Render `footnote` (if provided) in the existing caption slot.
- Keep the `Row` sub-component as-is.

- [ ] **Step 4: Run, confirm PASS** (`pnpm --filter app test -- PersistenceIndexWidget PersistenceSubComponents`).

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/dashboard/components/PersistenceIndexWidget.tsx apps/app/src/features/dashboard/components/PersistenceSubComponents.tsx apps/app/src/features/dashboard/components/PersistenceIndexWidget.test.tsx apps/app/src/features/dashboard/components/PersistenceSubComponents.test.tsx
git commit -m "feat(persistence): widget + breakdown render re-engagement from descriptor, drop response velocity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Report page wiring + full suite + typecheck + push

**Files:**
- Modify: `apps/app/src/features/dashboard/pages/PersistenceIndexReport.tsx`
- Test: its co-located test if present

- [ ] **Step 1: Rewire the report page.**
- Add a `subReEngagement` value mirroring the existing `subFollowUp`/`subCadence` derivation (lines ~192-200): from `selectedRow?.reEngagementPoints ?? null` when a rep is selected, else `team.reEngagement.points` for the team view, else `own?.reEngagement.hasSample ? own.reEngagement.points : null`.
- Replace the `<PersistenceSubComponents followUpPoints=... cadencePoints=... peerFollowUpPct=... peerCadencePct=... />` call with the new array-based API:
```tsx
<PersistenceSubComponents
  rows={[
    { key: "followUp", label: "Follow-up discipline", points: subFollowUp, max: FOLLOWUP_MAX, peerPct: showBenchmarks ? bench.followUpAvgPct : null },
    { key: "cadence", label: "Touch cadence", points: subCadence, max: CADENCE_MAX, peerPct: showBenchmarks ? bench.cadenceAvgPct : null },
    { key: "reEngagement", label: "Re-engagement after silence", points: subReEngagement, max: REENGAGEMENT_MAX, peerPct: showBenchmarks ? bench.reEngagementAvgPct : null },
  ]}
  footnote={own?.caveats.followUpBelowFloor ? "Follow-up volume too low to score discipline; showing cadence and re-engagement only." : undefined}
/>
```
- Import `REENGAGEMENT_MAX` (and confirm `FOLLOWUP_MAX`, `CADENCE_MAX` imports exist) from `../lib/persistenceIndex`.
- Remove any remaining reference to `responseVelocity` on the report page (there should be none after this).

- [ ] **Step 2: Full suite**

Run: `pnpm --filter app test`
Expected: all green. Fix any consumer the type changes broke (search the repo for `responseVelocity` and `comingSoon` and remove/replace remaining references; search for the old `PersistenceSubComponents` prop names).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter app typecheck`
Expected: clean. Resolve any remaining type errors from the `responseVelocity` removal or the SubComponents prop change.

- [ ] **Step 4: Commit + push**
```bash
git add -A apps/app/src/features/dashboard
git commit -m "feat(persistence): wire re-engagement into detail report; SP-A complete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin HEAD:main
```

---

## Self-review checklist (controller, before dispatch)

- Types defined in Task 1 (`ReEngagementResult`, `ComponentView`, reshaped `PersistenceIndexResult`) are referenced consistently in Tasks 2-4. ✓
- `FOLLOWUP_MAX + CADENCE_MAX + REENGAGEMENT_MAX = 40 + 30 + 30 = 100`. ✓
- No `responseVelocity` / `comingSoon` references remain after Task 4 (Step 2 greps for them). ✓
- `computeReEngagement` signature matches its call in `computePersistenceIndex` (passes `windowEnd` as `now`, `windowDays`). ✓
- History (`computePersistenceHistory`) reads only the composite; no change needed. ✓
