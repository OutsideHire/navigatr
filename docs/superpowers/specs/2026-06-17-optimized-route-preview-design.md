# Optimized Route Preview — Create-path step 3 (2026-06-17)

## Problem

The Create-path wizard has two steps: **Filters** → **Select stops**. The rep curates
the stop set in step 2 (with a map, route stats, and a numbered nearest-neighbor list),
then taps "Start path" and the route begins immediately. There is no distinct
**confirmation** moment — a read-only review of the final optimized route before
committing. This adds a third step, **Optimized route preview**, between Select stops and
starting the path.

## Decisions (locked in brainstorming)

- **New third step**, read-only: Filters → Select stops → **Optimized route preview** →
  start. The rep edits in step 2; step 3 only confirms.
- **No employee count or revenue/value metrics, and no Value/Employees sort tabs.** Live
  prospects come from Google Places, which provides name, address, distance, category,
  rating, review count, and phone — but **no employee count and no revenue estimate**. The
  attached mockup showed "42 emp / $18K est." and Value/Employees tabs; those are dropped
  because no real data backs them. (Matches the existing "Places-only" rule in the wizard.)
- **Stop list is capped** at the first `PREVIEW_ROWS` (4) of the route, with a
  "+ N more stops" line. The full, editable list already lives in step 2.
- **The final primary button starts the path and is labelled "Start path"** (not
  "Continue") — the preview is the last step, nothing follows. Step 2's primary button
  becomes **"Review route (N) →"**.
- **Route order is the nearest-neighbor driving order** (`orderStops`), numbered 1..N — the
  same ordering used everywhere else in the flow. Per-row distance is "from you"
  (distance from origin), shown for information, not a re-sort.

## Architecture

Reuses the existing pure functions — `orderStops` (`lib/proposeRoute.ts`), `routeStats` +
`formatEta` (`lib/routeStats.ts`), `formatDistance` (`@/lib/distance`) — so the preview's
numbers match step 2 exactly. No new data, no fetching, no model change.

### A. New component `RoutePreview.tsx` (Create step 3)

Purely presentational. Props:

```ts
export interface RoutePreviewProps {
  ordered: MerchantWithDistance[]; // nearest-neighbor driving order
  stats: RouteStats;               // from routeStats(origin, ordered)
  onBack: () => void;              // → step 2 (Select stops)
  onStart: () => void;             // commit + start the path
}
```

Layout, top to bottom inside the dialog body:

1. **KPI bar** — a single rounded panel (brand-tinted, like the mockup) with four cells:
   - **Stops** = `stats.stopCount`
   - **Nearest** = `formatDistance(stats.nearestMeters)` (guard null → "—")
   - **Furthest** = `formatDistance(stats.furthestMeters)` (guard null → "—")
   - **Est. time** = `formatEta(stats.etaMinutes)`
2. **Stop cards** — `ordered.slice(0, PREVIEW_ROWS)`, each: a numbered badge (driving
   order, `i + 1`), the name, a line `{address} · {formatDistance(distanceMeters)} away`,
   and a muted line with `★{rating.toFixed(1)}` (when present) and the phone. No emp/$.
3. **"+ N more stops"** — shown only when `ordered.length > PREVIEW_ROWS`
   (`N = ordered.length - PREVIEW_ROWS`).

Footer: `Back` (secondary → `onBack`) and **`Start path`** (primary, `Navigation` icon →
`onStart`). `PREVIEW_ROWS = 4` is a module const.

### B. `CreatePathWizard.tsx`

- Extend `type Step = "filters" | "select" | "preview"`.
- Title bar by step: filters → "Create path", select → "Select stops", preview →
  "Optimized route preview".
- Compute the route once for the preview (reusing the same pure fns SelectStops uses):
  ```ts
  const selected = React.useMemo(() => pool.filter((m) => selectedIds.has(m.id)), [pool, selectedIds]);
  const ordered = React.useMemo(() => orderStops(origin, selected), [origin, selected]);
  const previewStats = React.useMemo(
    () => routeStats(origin, ordered.map((m) => ({ lat: m.lat, lng: m.lng }))),
    [origin, ordered],
  );
  ```
  (Add `orderStops` and `routeStats` to the imports.)
- Render `step === "preview"` →
  `<RoutePreview ordered={ordered} stats={previewStats} onBack={() => setStep("select")} onStart={() => onStart(ordered.map((m) => m.id))} />`.
- The `onStart` prop (up to PathPage) now fires from the preview, not from SelectStops.

### C. `SelectStops.tsx` (small change)

- Replace the `onStart: (orderedIds: string[]) => void` prop with `onReview: () => void`.
- The primary footer button: label **"Review route ({selected.length}) →"**, still
  `disabled={noStops}`, `onClick={onReview}`. It no longer computes/began the route; the
  `Navigation` leading icon can be swapped for a forward chevron (`ChevronRight`) or kept —
  cosmetic. It keeps rendering its own map + accordions + internal `ordered`/`stats` for
  the in-step display (unchanged).
- The wizard passes `onReview={() => setStep("preview")}`.

## Data flow

Select stops (step 2, curate) → **Review route →** sets `step = "preview"` → wizard
computes `selected → ordered → previewStats` → RoutePreview renders them read-only →
**Start path** → `onStart(ordered.map(m => m.id))` → PathPage writes the queue (unchanged).
Back from the preview returns to step 2 with the curated selection intact (selection state
lives in the wizard, untouched by navigation).

## Error handling / edge cases

- **Empty route:** the preview is only reachable with ≥1 stop (step 2's Review button is
  `disabled` when `noStops`). RoutePreview still guards: if `ordered.length === 0`, render
  the KPI bar with zeros and no cards (no crash), but this path is not expected in practice.
- **Null nearest/furthest** (zero stops) → render "—" in those KPI cells.
- **Fewer than `PREVIEW_ROWS` stops** → show all cards, no "+ N more" line.
- **No live controls on the preview**, so no mid-step reactivity: editing happens only
  after Back. Selection survives Back/forward because it is wizard state.

## Testing

**New `RoutePreview.test.tsx`:**
- Renders the four KPI values from a given `stats` (stop count, nearest, furthest, ETA).
- Renders exactly `PREVIEW_ROWS` stop cards when `ordered` is longer, plus a
  "+ N more stops" line with the correct N.
- Renders all cards and NO "+ more" line when `ordered.length <= PREVIEW_ROWS`.
- Does NOT render any employee or "$"/"est." text.
- `Back` button calls `onBack`; `Start path` button calls `onStart`.

**Update `CreatePathWizard.test.tsx`:**
- Stepping filters → select → preview: after reaching Select stops, clicking
  "Review route" shows "Optimized route preview".
- Preview "Start path" calls the wizard's `onStart` with the ordered merchant IDs.
- Back from the preview returns to "Select stops".

**Update `SelectStops.test.tsx`:**
- The primary button reads "Review route (N)" and calls `onReview` (not `onStart`);
  disabled when no stops are selected.

## Out of scope

Employee/revenue metrics or their sort tabs; reordering the route by anything other than
nearest-neighbor; editing stops on the preview itself; a real routing/traffic API (ETA
stays a labeled straight-line estimate); changes to step 1 or to how PathPage writes the
queue.
