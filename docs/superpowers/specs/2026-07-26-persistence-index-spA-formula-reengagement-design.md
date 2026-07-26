# Persistence Index SP-A: Formula Swap + Re-engagement After Silence (Design Spec)

**Date:** 2026-07-26
**Status:** Approved (proceeding to plan + build)
**Module:** Dashboard / Persistence Index scoring engine + its widget/detail consumers
**Sub-project:** SP-A of the full-spec Persistence Index re-scope (SP-A..E). See the decomposition in chat.

---

## 1. Goal

Replace Response Velocity (permanently uncomputable without inbound capture) with **Re-engagement After Silence**, a component computable from existing touch-gap data. Update the composite to the canonical formula, add a Follow-Up Discipline volume floor, and drive the sub-component rows from a formula descriptor instead of three hardcoded rows. Pure client-side, same posture as the shipped slices. No backend, no snapshot pipeline (that is SP-B).

## 2. Canonical formula

| Component | Weight |
|---|---|
| Follow-Up Discipline | 40 |
| Touch Cadence | 30 |
| Re-engagement After Silence | 30 |

Response Velocity is **cut entirely** (not "coming soon"). The greyed placeholder row is removed everywhere.

Introduce `FORMULA_VERSION = 2` (v1 was FUD/Response-Velocity/Cadence) and a component descriptor so the UI renders rows from data. SP-B will later drive the descriptor + parameters from a config table; SP-A hardcodes them as named constants (forward-compatible).

## 3. Re-engagement After Silence: computation

New pure function `computeReEngagement(deals, activities, ownerId, now)`. Constants (named, forward-compat for SP-B config):
- `SILENCE_THRESHOLD_DAYS = 21`
- `FAIRNESS_WINDOW_DAYS = 7`
- `WINDOW_DAYS = 30` (reuse existing)
- `REENGAGEMENT_MAX = 30`

Algorithm:
1. `activeDeals` = deals where `owner_id === ownerId` and `stage` not in (`won`,`lost`).
2. If `activeDeals` is empty: return `{ points: 0, max: 30, hasSample: false, rate: null, silentCount: 0, reEngagedCount: 0 }`. (No deals to work = no sample, same posture as cadence.)
3. For each active deal, take its activities with `occurredAt <= now`, sorted ascending by time. Skip deals with no such activity (no timeline to locate a silence onset).
4. Build **silence onsets** for the deal. For each activity `acts[i]` with time `t_i`, let `onset = t_i + 21 days`:
   - If there is a next activity `acts[i+1]` and `t_{i+1} - t_i > 21 days`: push `{ onset, reEngaged: true }` (the deal went silent, then a later touch broke the silence).
   - If there is no next activity and `onset <= now`: push `{ onset, reEngaged: false }` (the deal went silent and is still silent).
5. **Qualifying onsets** = onsets whose `onset` falls in `[now - 30 days, now - 7 days]` (crossed the threshold within the trailing 30 days AND at least 7 days ago, the fairness window).
6. If the deal has no qualifying onset, it is not in the denominator. Otherwise it counts once in `silentCount`; take the **latest** qualifying onset, and if its `reEngaged` is true, increment `reEngagedCount`.
7. **Zero-silent edge case (must not fall through to the generic zero-sample rule):** if `silentCount === 0` but the rep has active deals, return `{ points: 30, max: 30, hasSample: true, rate: null, silentCount: 0, reEngagedCount: 0 }`. A rep with nothing to recover scores the full 30.
8. Otherwise `rate = reEngagedCount / silentCount`; `points = round(rate * 30)` (linear). Return `{ points, max: 30, hasSample: true, rate, silentCount, reEngagedCount }`.

Edge cases covered by the above:
- **Silent then closed Lost:** excluded because step 1 drops `lost` (and `won`).
- **Re-silenced after recovery:** using the latest qualifying onset reflects current state; a fresh (< 7-day) silence is excluded by the fairness window, so it is not unfairly counted as a miss.

**Known limitation (documented, not faked):** Robert's spec says the silence clock restarts on deal reassignment mid-silence. We do not track ownership-change history client-side, so SP-A computes from the deal's full activity timeline regardless of reassignment. SP-B (nightly snapshot with per-day ownership) is where this is honored. Note it in code comments and beta materials.

## 4. Follow-Up Discipline volume floor

`FOLLOWUP_FLOOR = 8`. `computeFollowUpDiscipline` sets `hasSample = dueCount >= FOLLOWUP_FLOOR` (previously `dueCount > 0`) and exposes `belowFloor = dueCount > 0 && dueCount < FOLLOWUP_FLOOR` (and, implicitly, `dueCount === 0` also yields `hasSample: false`). Add `belowFloor` to `FollowUpResult`.

**Composite behavior below the floor (product decision, 2026-07-26):** show a **partial score with a caveat**, NOT a suppressed Index. When FUD is below the floor it is excluded from the composite scaling (as any no-sample component is), so the composite is computed over Touch Cadence + Re-engagement, and a caveat is surfaced on the result so the UI can display "follow-up volume too low to score discipline." Composite is null only when NO component has a sample.

> Divergence flag for Robert: Robert's write-up preferred suppressing the whole Index below the floor ("a blank gets asked about"). The product owner chose the partial-score-with-caveat path so a signal stays visible. This is close to the exclude-and-rescale behavior Robert cautioned against; the caveat is the mitigation. Revisit if beta shows gaming.

## 5. Composite + descriptor

`PersistenceIndexResult` changes:
- Replace `responseVelocity: { comingSoon: true }` with `reEngagement: ReEngagementResult`.
- Add `components: ComponentView[]` (ordered: Follow-Up Discipline, Touch Cadence, Re-engagement After Silence), each `{ key, label, points, max, hasSample, belowFloor? }`, so the widget and detail card render from this array rather than named fields.
- Add `caveats: { followUpBelowFloor: boolean }` (or fold `belowFloor` into the FUD component view; the report reads it for the caveat line).
- `formulaVersion: number`.

Composite math: sum `points`/`max` over components with `hasSample`, `composite = round(availPoints / availMax * 100)`, null if `availMax === 0`.

## 6. Downstream consumers (all lose Response Velocity, gain Re-engagement)

- `computeTeamPersistenceIndex`: add median re-engagement points across reps; drop `responseVelocity`. Keep the median-of-composites approach.
- `computePerRepPersistence` / `PerRepScore`: add `reEngagementPoints: number | null`.
- `subComponentPeerAverages`: add `reEngagementAvgPct`.
- `computePersistenceHistory`: unchanged in logic (reads the composite), verify it still works with the new composite.
- `persistenceStats`, `persistenceBenchmarks`, `benchmarkAvgLabel`: unaffected by the swap except any place that references the RV field.

## 7. UI

- `PersistenceIndexWidget`: render the sub-component rows from `result.components`; remove the Response Velocity "coming soon" row; show the Re-engagement row. Show the FUD "insufficient follow-up volume to score" state and the composite caveat when `followUpBelowFloor`.
- `PersistenceSubComponents` (detail card): same, render three rows from the descriptor; Re-engagement replaces the greyed Response Velocity row (no longer a "coming soon" row).
- Any label/legend that named "Response Velocity" is updated to "Re-engagement After Silence".

Out of scope for SP-A (later stages): manager-only gating, Logging Coverage gate, benchmark degradation changes, chart color/y-axis/legend cosmetics (SP-D); config table + snapshot pipeline + real formula-version history (SP-B); follow-up completion / task work (SP-C).

## 8. Testing

TDD throughout. New tests:
- `computeReEngagement`: rate math; the fairness window (a 2-day-old silence is excluded); the 30-day window boundary; zero-silent-with-active-deals returns 30 + hasSample true; no-active-deals returns hasSample false; silent-then-Lost excluded; re-silenced-after-recovery uses latest qualifying onset; a gap-onset counts as re-engaged.
- FUD floor: `dueCount` 1..7 -> `hasSample: false`, `belowFloor: true`; `dueCount >= 8` -> scores; `dueCount === 0` -> `hasSample: false`, `belowFloor: false`.
- Composite: below-floor FUD excluded but composite still computed over cadence + re-engagement with the caveat set; RV field gone.
- Team roll-up / per-rep / peer averages include re-engagement, no RV.
- Widget + sub-component card: render Re-engagement row, no "coming soon" RV row, show the caveat when below floor.
- Full `pnpm --filter app test` + `typecheck` green.

## 9. Files (anticipated)

- `apps/app/src/features/dashboard/lib/persistenceIndex.ts` (+ `.test.ts`): the engine changes above.
- `apps/app/src/features/dashboard/components/PersistenceIndexWidget.tsx` (+ test): render from descriptor, RV removed, caveat.
- `apps/app/src/features/dashboard/components/PersistenceSubComponents.tsx` (+ test): three rows from descriptor, Re-engagement row.
- Any hook types that referenced `responseVelocity` (`usePersistenceIndex`, `useTeamPersistenceIndex`, `usePerRepPersistence`, `usePersistenceBenchmarks`) updated to the new shape.

## 10. Deploy

Frontend-only, no migration. Ships to main like the prior slices, then SP-B builds the backend under it.
