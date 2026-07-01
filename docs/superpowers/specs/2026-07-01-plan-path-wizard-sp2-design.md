# Plan a Path — 6-step Wizard (SP2) — Design

**Goal:** Add a full-page, linear "Plan a Path" wizard matching the FR-PATH mockup, assembling
existing path building blocks into ordered steps. SP2 ships mode-choice + search + results + review +
saved (saves immediately); **SP3** later inserts the Schedule step + upcoming-paths.

## Decomposition context
- SP1 (city/ZIP search backend) — **already built** (`geocode` fn + `usePathOrigin.searchLocation` +
  `useMerchants(origin)`). No work.
- **SP2 (this spec)** — the wizard shell + steps.
- SP3 (later) — scheduling/reminders/upcoming paths (adds the Schedule step; makes the flow "of 6").

## Routing & shell
- New route `/path/plan` → `PlanPathWizard` (full page), added in `App.tsx` under the authed routes,
  same guard as `/path`.
- `PlanPathWizard` owns a **data-driven stepper**: an ordered array of step descriptors
  `{ key, title }`. SP2 steps: `mode → search → results → review → saved` (5). The progress bar +
  "Step N of M" derive from this array, so SP3 inserting `schedule` before `saved` needs no shell
  rework. Header: "Plan a path" + "Step N of M · {title}". Footer: Back / Continue (+ per-step primary
  actions). Close (X) returns to `/path`.
- Entry from PathPage: the existing "Create path" entry point gets a companion "Plan a path" action
  that routes to `/path/plan`. (Keep the current entry working.)

## Steps (SP2)
1. **Choose mode** (`ChoosePathMode`) — two cards: *Create a Path* (FR-PATH-01) and *Plan a Path*
   (FR-PATH-02). Selecting Create + Continue navigates to `/path` (today's live current-location
   discover flow — unchanged). Selecting Plan + Continue advances to `search`.
2. **Search by city/ZIP + filters** (`PlanSearchStep`) — reuse `LocationSearch` bound to
   `usePathOrigin.searchLocation`; radius (5/10/15mi), min-employees select, industry selection
   (reuse `IndustryEditor`/`IndustrySelection` with the merged Retail / Restaurants groups),
   "All business types" toggle, "Browse all categories". "Search businesses" resolves the origin and
   advances to `results`. Guard: no Continue until an origin is resolved.
3. **Add stops from results** (`PlanResultsStep`) — `useMerchants(origin, filters)`; render results via
   `MerchantList` cards with "Add to today's path" (adds to the wizard's in-progress stop set) and
   "Log drop-in" (`DropInSheet`). Sticky footer: "N stops added" + "Review path" (enabled when N ≥ 1).
4. **Review planned path** (`PlanReviewStep`) — ordered stop list with **drag-to-reorder** + remove +
   "Add more stops" (back to `results`). Reuses the queue-ordering helpers; DnD via the same primitive
   used elsewhere if present, else a minimal keyboard-accessible reorder (up/down controls) as the
   baseline. Continue = **save**: `createPath` (path_date = today) then `addStops` in the reviewed
   order (route optimized on save via existing logic), then advance to `saved`.
5. *(schedule — SP3, not in SP2.)*
6. **Saved** (`PlanSavedStep`) — confirmation summary: "{name} is ready", checklist (N stops added,
   route optimized, visible on mobile + web), actions "View upcoming" (→ `/path`) and "Build another"
   (→ reset to `mode`). Done (→ `/path`).

## State
`PlanPathWizard` holds wizard state (no global store): `stepKey`, `mode`, resolved `origin`+`label`
(from `usePathOrigin`), filters (`IndustrySelection`, `radiusM`, `minEmployees`, `allIndustries`),
the in-progress `Set<stopId>` + ordering, and the created `pathId` after save. Step components are
controlled/presentational, receiving state + callbacks — each independently testable.

## Files
- `apps/app/src/features/path/pages/PlanPathWizard.tsx` (shell + state + step routing)
- `apps/app/src/features/path/components/plan/ChoosePathMode.tsx`, `PlanSearchStep.tsx`,
  `PlanResultsStep.tsx`, `PlanReviewStep.tsx`, `PlanSavedStep.tsx`
- `apps/app/src/features/path/components/plan/steps.ts` (step descriptor array + `Step` type)
- `App.tsx` (route), PathPage entry affordance
- Reuse (no change): `LocationSearch`, `MerchantList`, `DropInSheet`, `IndustryEditor`,
  `usePathOrigin`, `useMerchants`, `usePathMutations`, route-ordering helpers.

## Testing
- `steps.ts` — descriptor list shape/order; "Step N of M" derivation.
- `ChoosePathMode` — Create routes to `/path`; Plan advances.
- `PlanSearchStep` — Continue disabled until origin resolves; searching calls `searchLocation`.
- `PlanResultsStep` — "Add" increments the count; "Review" disabled at 0 stops.
- `PlanReviewStep` — reorder + remove update order/count; save calls `createPath` + `addStops` with the
  reviewed order; advances to saved.
- `PlanPathWizard` integration — full Plan happy path (mode→search→results→review→saved), Back
  navigation, and Create-mode routing out. Reuse jsdom pointer polyfills for any DnD/portal.

## Non-goals (SP2)
Scheduling, reminders, upcoming-paths, future-dated paths (all SP3). No backend/migration changes —
SP2 is frontend assembly over existing hooks/mutations.

## Risks
- Re-uses many existing components; keep them unchanged (props-only) to avoid regressing PathPage.
- Drag-reorder: if no shared DnD primitive exists, ship accessible up/down reorder as the baseline and
  note DnD as a polish follow-up rather than blocking.
