# Optimized Route Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only third step, "Optimized route preview," to the Create-path wizard — a KPI summary plus the first few numbered stops — that the rep confirms before the path starts.

**Architecture:** A new presentational `RoutePreview` component renders the existing `routeStats` KPIs and the nearest-neighbor `orderStops` route. The wizard gains a `"preview"` step that computes the ordered route once and passes it down; `SelectStops`'s primary button changes from starting the path to advancing to the preview, and the preview's "Start path" button now fires the wizard's `onStart`.

**Tech Stack:** React + TypeScript, Radix Dialog, Vitest + Testing Library, navigatr design tokens. Reuses `orderStops` (`lib/proposeRoute.ts`), `routeStats`/`formatEta` (`lib/routeStats.ts`), `formatDistance` (`@/lib/distance`).

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-17-optimized-route-preview-design.md`

Run all commands from the worktree app dir: `cd /Users/ryanmeo/navigatr/.claude/worktrees/route-preview/apps/app`.

---

## File Structure

- **Create:** `apps/app/src/features/path/components/RoutePreview.tsx` — read-only step-3 view (KPI bar + capped stop list + footer). Standalone, no fetching/selection.
- **Create:** `apps/app/src/features/path/components/RoutePreview.test.tsx` — unit tests for the view.
- **Modify:** `apps/app/src/features/path/components/SelectStops.tsx` — swap `onStart` → `onReview`; primary button becomes "Review route (N) →".
- **Modify:** `apps/app/src/features/path/components/SelectStops.test.tsx` — reflect the renamed prop/button.
- **Modify:** `apps/app/src/features/path/components/CreatePathWizard.tsx` — add `"preview"` step, compute the ordered route, render `RoutePreview`, fire `onStart` from it.
- **Modify:** `apps/app/src/features/path/components/CreatePathWizard.test.tsx` — update the two existing "Select stops shows Start path" assertions; add preview-step coverage.

Task order keeps each commit green: Task 1 adds the standalone component (no other file depends on it yet); Task 2 makes the coupled `SelectStops` + wizard prop change in one commit so typecheck never breaks.

---

### Task 1: `RoutePreview` component (standalone)

**Files:**
- Create: `apps/app/src/features/path/components/RoutePreview.tsx`
- Create: `apps/app/src/features/path/components/RoutePreview.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/features/path/components/RoutePreview.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RoutePreview } from "./RoutePreview";
import type { MerchantWithDistance } from "./MerchantList";
import type { RouteStats } from "../lib/routeStats";

function row(id: string, distanceMeters: number, over: Partial<MerchantWithDistance> = {}): MerchantWithDistance {
  return {
    id, name: id, category: "automotive", address: `${id} St`, lat: 35, lng: -97,
    phone: "+15125550100", employeeCountRange: "", status: "untouched", lastActivity: null,
    isChain: false, distanceMeters, rating: 4.2, ...over,
  } as MerchantWithDistance;
}

const STATS: RouteStats = {
  stopCount: 6,
  nearestMeters: 643.7,   // ~0.4 mi
  furthestMeters: 13196,  // ~8.2 mi
  totalRouteMeters: 20000,
  etaMinutes: 210,        // ~3h 30m
};

function setup(count: number, statsOver: Partial<RouteStats> = {}) {
  const ordered = Array.from({ length: count }, (_, i) => row(`Stop${i + 1}`, (i + 1) * 643.7));
  const onBack = vi.fn();
  const onStart = vi.fn();
  render(<RoutePreview ordered={ordered} stats={{ ...STATS, stopCount: count, ...statsOver }} onBack={onBack} onStart={onStart} />);
  return { onBack, onStart };
}

describe("RoutePreview", () => {
  it("renders the four KPI values from stats", () => {
    setup(6);
    expect(screen.getByText("6")).toBeInTheDocument();          // Stops
    expect(screen.getByText("Stops")).toBeInTheDocument();
    expect(screen.getByText("0.4 mi")).toBeInTheDocument();     // Nearest
    expect(screen.getByText("8.2 mi")).toBeInTheDocument();     // Furthest
    expect(screen.getByText("~3h 30m")).toBeInTheDocument();    // Est. time
  });

  it("renders only the first 4 stops and a '+N more' line when longer", () => {
    setup(6);
    expect(screen.getByText("Stop1")).toBeInTheDocument();
    expect(screen.getByText("Stop4")).toBeInTheDocument();
    expect(screen.queryByText("Stop5")).not.toBeInTheDocument();
    expect(screen.getByText(/\+\s*2\s*more stops/i)).toBeInTheDocument();
  });

  it("renders all stops and no '+more' line when 4 or fewer", () => {
    setup(3);
    expect(screen.getByText("Stop3")).toBeInTheDocument();
    expect(screen.queryByText(/more stops/i)).not.toBeInTheDocument();
  });

  it("shows no employee or dollar-estimate text", () => {
    setup(4);
    expect(screen.queryByText(/emp\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/est\./i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("Back calls onBack and Start path calls onStart", () => {
    const { onBack, onStart } = setup(4);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(onBack).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /start path/i }));
    expect(onStart).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter app test RoutePreview`
Expected: FAIL — `Failed to resolve import "./RoutePreview"` (component does not exist yet).

- [ ] **Step 3: Write the component**

Create `apps/app/src/features/path/components/RoutePreview.tsx`:

```tsx
/**
 * RoutePreview — Create step 3. A read-only confirmation of the optimized
 * (nearest-neighbor) route before the rep starts the path: a KPI summary, the
 * first few numbered stops, then "+N more stops". No employee/value metrics —
 * Places data doesn't carry them. Editing happens back in step 2 (Select stops).
 */
import * as React from "react";
import { Navigation, Phone } from "lucide-react";

import { Button } from "@/components/navigatr";
import { formatDistance } from "@/lib/distance";
import { formatEta, type RouteStats } from "../lib/routeStats";
import type { MerchantWithDistance } from "./MerchantList";

/** Stops listed before collapsing into a "+N more stops" line. */
const PREVIEW_ROWS = 4;

export interface RoutePreviewProps {
  /** Nearest-neighbor driving order (numbered 1..N). */
  ordered: MerchantWithDistance[];
  /** Route math for the same ordered set. */
  stats: RouteStats;
  /** Return to Select stops (step 2). */
  onBack: () => void;
  /** Commit and start the path. */
  onStart: () => void;
}

export function RoutePreview({ ordered, stats, onBack, onStart }: RoutePreviewProps) {
  const shown = ordered.slice(0, PREVIEW_ROWS);
  const moreCount = ordered.length - shown.length;

  // nearest/furthest are null for an empty route; formatDistance renders "—" for
  // non-finite input, so coerce null → NaN to reuse that path.
  const kpis: Array<{ label: string; value: string }> = [
    { label: "Stops", value: String(stats.stopCount) },
    { label: "Nearest", value: formatDistance(stats.nearestMeters ?? NaN) },
    { label: "Furthest", value: formatDistance(stats.furthestMeters ?? NaN) },
    { label: "Est. time", value: formatEta(stats.etaMinutes) },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {/* KPI summary */}
        <div className="grid grid-cols-4 gap-2 rounded-radius-md bg-brand-primary-10 px-3 py-4">
          {kpis.map((k) => (
            <div key={k.label} className="flex flex-col items-center gap-0.5 text-center">
              <span className="text-body-strong tabular-nums text-brand-primary">{k.value}</span>
              <span className="text-caption text-text-muted">{k.label}</span>
            </div>
          ))}
        </div>

        {/* First PREVIEW_ROWS of the nearest-neighbor route. */}
        <div className="flex flex-col gap-2">
          {shown.map((m, i) => (
            <div key={m.id} className="flex items-start gap-3 rounded-radius-md border border-border-default p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-radius-full bg-brand-primary text-caption font-semibold tabular-nums text-brand-primary-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-md font-medium text-text-default">{m.name}</p>
                <p className="truncate text-caption text-text-muted">
                  {m.address}
                  {Number.isFinite(m.distanceMeters) ? ` · ${formatDistance(m.distanceMeters)} away` : ""}
                </p>
                {(typeof m.rating === "number" || m.phone) && (
                  <p className="mt-1 flex items-center gap-3 text-caption text-text-muted">
                    {typeof m.rating === "number" && <span>★ {m.rating.toFixed(1)}</span>}
                    {m.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" aria-hidden /> {m.phone}
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          ))}
          {moreCount > 0 && (
            <p className="py-1 text-center text-caption text-text-muted">+ {moreCount} more stops</p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-2 border-t border-border-default px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button variant="secondary" onClick={onBack}>Back</Button>
        <Button variant="primary" leadingIcon={Navigation} className="flex-1" onClick={onStart}>
          Start path
        </Button>
      </div>
    </div>
  );
}

export default RoutePreview;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter app test RoutePreview`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter app typecheck`
Expected: clean.

```bash
git add apps/app/src/features/path/components/RoutePreview.tsx apps/app/src/features/path/components/RoutePreview.test.tsx
git commit -m "feat(path): RoutePreview component (Create step 3, read-only)"
```

---

### Task 2: Wire the preview into the wizard (+ SelectStops → Review)

**Files:**
- Modify: `apps/app/src/features/path/components/SelectStops.tsx`
- Modify: `apps/app/src/features/path/components/SelectStops.test.tsx`
- Modify: `apps/app/src/features/path/components/CreatePathWizard.tsx`
- Modify: `apps/app/src/features/path/components/CreatePathWizard.test.tsx`

- [ ] **Step 1: Update the SelectStops tests (red)**

In `apps/app/src/features/path/components/SelectStops.test.tsx`, make these exact replacements.

(a) In `setup(...)`, replace the `onStart` wiring with `onReview`:

Replace:
```tsx
  const onToggle = vi.fn();
  const onStart = vi.fn();
  const onBack = vi.fn();
  render(
    <SelectStops
      pool={POOL} origin={ORIGIN} sortMode="opportunity" onSortChange={vi.fn()}
      selectedIds={selectedIds} onToggle={onToggle} onBack={onBack} onStart={onStart}
      {...props}
    />,
  );
  return { onToggle, onStart, onBack };
```
With:
```tsx
  const onToggle = vi.fn();
  const onReview = vi.fn();
  const onBack = vi.fn();
  render(
    <SelectStops
      pool={POOL} origin={ORIGIN} sortMode="opportunity" onSortChange={vi.fn()}
      selectedIds={selectedIds} onToggle={onToggle} onBack={onBack} onReview={onReview}
      {...props}
    />,
  );
  return { onToggle, onReview, onBack };
```

(b) In the "default" test, replace the Start assertion:

Replace:
```tsx
    expect(screen.getByRole("button", { name: /start path/i })).toBeInTheDocument();
```
With:
```tsx
    expect(screen.getByRole("button", { name: /review route/i })).toBeInTheDocument();
```

(c) In the "0 selected" test, replace:
```tsx
    expect(screen.getByRole("button", { name: /start path/i })).toBeDisabled();
```
With:
```tsx
    expect(screen.getByRole("button", { name: /review route/i })).toBeDisabled();
```

(d) Replace the whole "Start fires onStart NN-ordered; Back calls onBack" test with:
```tsx
  it("Review calls onReview; Back calls onBack", () => {
    const { onReview, onBack } = setup(new Set(["Acme", "Charlie"]));
    fireEvent.click(screen.getByRole("button", { name: /review route/i }));
    expect(onReview).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(onBack).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter app test SelectStops`
Expected: FAIL — `onReview` is not a prop yet; the button still says "Start path".

- [ ] **Step 3: Update SelectStops.tsx**

In `apps/app/src/features/path/components/SelectStops.tsx`:

(a) Replace the import line for icons:
```tsx
import { ChevronDown, Navigation, X } from "lucide-react";
```
with:
```tsx
import { ChevronDown, ChevronRight, X } from "lucide-react";
```

(b) In `SelectStopsProps`, replace:
```tsx
  onStart: (orderedIds: string[]) => void;
```
with:
```tsx
  onReview: () => void;
```

(c) In the destructured params, replace `onStart` with `onReview`:
```tsx
export function SelectStops({
  pool, origin, sortMode, onSortChange, selectedIds, onToggle, onBack, onReview,
}: SelectStopsProps) {
```

(d) Replace the footer primary button:
```tsx
        <Button
          variant="primary" leadingIcon={Navigation} className="flex-1"
          disabled={noStops} onClick={() => onStart(ordered.map((m) => m.id))}
        >
          Start path ({selected.length})
        </Button>
```
with:
```tsx
        <Button
          variant="primary" leadingIcon={ChevronRight} className="flex-1"
          disabled={noStops} onClick={onReview}
        >
          Review route ({selected.length})
        </Button>
```

Note: `ordered` is still computed and used by the map + route accordion above — leave it. Only the Start button stops consuming it.

- [ ] **Step 4: Run SelectStops tests (green)**

Run: `pnpm --filter app test SelectStops`
Expected: PASS.

- [ ] **Step 5: Update CreatePathWizard.tsx**

In `apps/app/src/features/path/components/CreatePathWizard.tsx`:

(a) Add imports for the route math and the new component. After the existing
`import { candidatePool } from "../lib/proposeRoute";` line, change it to:
```tsx
import { candidatePool, orderStops } from "../lib/proposeRoute";
import { routeStats } from "../lib/routeStats";
import { RoutePreview } from "./RoutePreview";
```

(b) Extend the step type:
```tsx
type Step = "filters" | "select";
```
to:
```tsx
type Step = "filters" | "select" | "preview";
```

(c) After the `toggleStop` `useCallback` (just before the `return (`), add the ordered-route
derivation:
```tsx
  // Step 3 (preview) needs the same ordered route + stats SelectStops shows. Derive
  // them here from the curated selection so the preview and the started queue agree.
  const selectedStops = React.useMemo(
    () => pool.filter((m) => selectedIds.has(m.id)),
    [pool, selectedIds],
  );
  const orderedStops = React.useMemo(
    () => orderStops(origin, selectedStops),
    [origin, selectedStops],
  );
  const previewStats = React.useMemo(
    () => routeStats(origin, orderedStops.map((m) => ({ lat: m.lat, lng: m.lng }))),
    [origin, orderedStops],
  );
```

(d) Update the dialog title expression:
```tsx
              {step === "filters" ? "Create path" : "Select stops"}
```
to:
```tsx
              {step === "filters" ? "Create path" : step === "select" ? "Select stops" : "Optimized route preview"}
```

(e) Replace the `step === "select"` render block:
```tsx
          {step === "select" && (
            <SelectStops
              pool={pool}
              origin={origin}
              sortMode={sortMode}
              onSortChange={setSortMode}
              selectedIds={selectedIds}
              onToggle={toggleStop}
              onBack={() => setStep("filters")}
              onStart={onStart}
            />
          )}
```
with:
```tsx
          {step === "select" && (
            <SelectStops
              pool={pool}
              origin={origin}
              sortMode={sortMode}
              onSortChange={setSortMode}
              selectedIds={selectedIds}
              onToggle={toggleStop}
              onBack={() => setStep("filters")}
              onReview={() => setStep("preview")}
            />
          )}

          {step === "preview" && (
            <RoutePreview
              ordered={orderedStops}
              stats={previewStats}
              onBack={() => setStep("select")}
              onStart={() => onStart(orderedStops.map((m) => m.id))}
            />
          )}
```

- [ ] **Step 6: Update CreatePathWizard.test.tsx**

In `apps/app/src/features/path/components/CreatePathWizard.test.tsx`:

(a) In "advances from filters to the Select stops step", replace:
```tsx
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    expect(screen.getByRole("button", { name: /start path/i })).toBeInTheDocument();
```
with:
```tsx
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    expect(screen.getByRole("button", { name: /review route/i })).toBeInTheDocument();
```

(b) In "shows the empty state in Select stops when no businesses match", replace:
```tsx
    expect(screen.getByRole("button", { name: /start path/i })).toBeDisabled();
```
with:
```tsx
    expect(screen.getByRole("button", { name: /review route/i })).toBeDisabled();
```

(c) Add these two tests at the end of the main `describe` block (right after the
"re-seeds the auto-selection when Max stops changes" test, before the closing `});` of the
describe). They reuse the existing `mkAutoMerchant` helper and `renderWizard`:
```tsx
  it("Review route advances from Select stops to the Optimized route preview", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    renderWizard({ merchants: [mkAutoMerchant("a", 0)] });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    fireEvent.click(screen.getByRole("button", { name: /review route/i }));
    expect(screen.getByRole("heading", { name: /optimized route preview/i })).toBeInTheDocument();
  });

  it("preview Start path fires onStart with the ordered ids", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    const onStart = vi.fn();
    renderWizard({ merchants: [mkAutoMerchant("a", 0)], onStart });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    fireEvent.click(screen.getByRole("button", { name: /review route/i }));
    fireEvent.click(screen.getByRole("button", { name: /start path/i }));
    expect(onStart).toHaveBeenCalledWith(["a"]);
  });

  it("Back from the preview returns to Select stops", () => {
    mockPrefs = { automotive: allSubtypes("automotive") };
    renderWizard({ merchants: [mkAutoMerchant("a", 0)] });
    fireEvent.click(screen.getByRole("button", { name: /select stops/i }));
    fireEvent.click(screen.getByRole("button", { name: /review route/i }));
    expect(screen.getByRole("heading", { name: /optimized route preview/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(screen.getByRole("heading", { name: /select stops/i })).toBeInTheDocument();
  });
```

Test-helper facts (verified): `renderWizard(props)` spreads `{...props}` over its defaults,
so passing `onStart` overrides the default `vi.fn()` — `renderWizard({ merchants: [...], onStart })`
works as written. `mkAutoMerchant(id, i)` and `allSubtypes(category)` are existing helpers in
this file (used by the surrounding tests). Do not change `renderWizard`'s defaults.

- [ ] **Step 7: Run the full suite + typecheck**

Run: `pnpm --filter app typecheck && pnpm --filter app test`
Expected: typecheck clean; all tests green (RoutePreview, SelectStops, CreatePathWizard, and the rest).

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/features/path/components/SelectStops.tsx \
        apps/app/src/features/path/components/SelectStops.test.tsx \
        apps/app/src/features/path/components/CreatePathWizard.tsx \
        apps/app/src/features/path/components/CreatePathWizard.test.tsx
git commit -m "feat(path): add Optimized route preview step; SelectStops advances to it"
```

---

## Notes for the implementer

- The wizard already owns the curated selection (`selectedIds`) and the `pool`; the preview
  derivation reuses them. Do not move selection state into SelectStops.
- `bg-brand-primary-10` is a real token (`--color-brand-primary-10`, a ~10% indigo tint) —
  used for the KPI panel. `text-brand-primary`, `bg-brand-primary`,
  `text-brand-primary-foreground` are all valid.
- There is no phone formatter in the codebase; render `m.phone` (E.164) as-is. Formatting is
  out of scope.
- `formatDistance` returns "—" for non-finite input, so the null-nearest/furthest case is
  handled by `?? NaN`.
- Keep `RouteRow`/`AddRow` and the rest of SelectStops untouched — only the props and the
  footer button change.
