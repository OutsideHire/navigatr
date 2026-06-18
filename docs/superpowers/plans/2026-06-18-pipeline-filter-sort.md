# Pipeline advanced Filter + Sort — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Make the Pipeline list's Filter (min value, min probability, follow-up status) and Sort (last activity / value / probability / next follow-up) real — client-side over loaded deals.

**Spec:** `/Users/ryanmeo/navigatr/docs/superpowers/specs/2026-06-18-pipeline-filter-sort-design.md`

Run pnpm from `/Users/ryanmeo/navigatr/.claude/worktrees/filter-sort/apps/app` (worktree-local `pnpm typecheck` / `pnpm test <pattern>`).

---

### Task 1: `sortDeals` + `filterDeals` pure helpers (TDD)

**Files:** create `lib/sortDeals.ts` (+ test), `lib/filterDeals.ts` (+ test) under `apps/app/src/features/pipeline/`.

- [ ] **Step 1: `sortDeals.test.ts`:**
```ts
import { describe, it, expect } from "vitest";
import { sortDeals } from "./sortDeals";
import { MOCK_DEALS, type Deal } from "../mockData";

function d(over: Partial<Deal>): Deal { return { ...MOCK_DEALS[0], ...over }; }

describe("sortDeals", () => {
  it("value: highest first", () => {
    const out = sortDeals([d({ id: "a", valueCents: 100 }), d({ id: "b", valueCents: 900 }), d({ id: "c", valueCents: 500 })], "value");
    expect(out.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("probability: highest first", () => {
    const out = sortDeals([d({ id: "a", probability: 20 }), d({ id: "b", probability: 80 })], "probability");
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("last_activity: most recent first", () => {
    const out = sortDeals([d({ id: "old", lastActivity: "2026-01-01T00:00:00Z" }), d({ id: "new", lastActivity: "2026-06-01T00:00:00Z" })], "last_activity");
    expect(out.map((x) => x.id)).toEqual(["new", "old"]);
  });
  it("followup: soonest first, nulls last", () => {
    const out = sortDeals([
      d({ id: "none", nextFollowup: null }),
      d({ id: "late", nextFollowup: "2026-06-30" }),
      d({ id: "soon", nextFollowup: "2026-06-02" }),
    ], "followup");
    expect(out.map((x) => x.id)).toEqual(["soon", "late", "none"]);
  });
  it("does not mutate the input array", () => {
    const input = [d({ id: "a", valueCents: 1 }), d({ id: "b", valueCents: 2 })];
    const copy = [...input];
    sortDeals(input, "value");
    expect(input).toEqual(copy);
  });
});
```

- [ ] **Step 2: run** `pnpm test sortDeals` → FAIL. **Step 3: `sortDeals.ts`:**
```ts
import type { Deal } from "../mockData";

export type DealSortKey = "last_activity" | "value" | "probability" | "followup";

export const DEAL_SORT_LABEL: Record<DealSortKey, string> = {
  last_activity: "Last activity",
  value: "Value",
  probability: "Probability",
  followup: "Next follow-up",
};

/** Returns a new, sorted array (input never mutated). */
export function sortDeals(deals: Deal[], key: DealSortKey): Deal[] {
  const arr = [...deals];
  switch (key) {
    case "value":
      return arr.sort((a, b) => b.valueCents - a.valueCents);
    case "probability":
      return arr.sort((a, b) => b.probability - a.probability);
    case "followup":
      // soonest first; nulls last
      return arr.sort((a, b) => {
        if (a.nextFollowup === b.nextFollowup) return 0;
        if (!a.nextFollowup) return 1;
        if (!b.nextFollowup) return -1;
        return a.nextFollowup < b.nextFollowup ? -1 : 1;
      });
    case "last_activity":
    default:
      // most recent first
      return arr.sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : a.lastActivity > b.lastActivity ? -1 : 0));
  }
}
```

- [ ] **Step 4: run** `pnpm test sortDeals` → PASS.

- [ ] **Step 5: `filterDeals.test.ts`:**
```ts
import { describe, it, expect } from "vitest";
import { applyDealFilters, activeFilterCount, EMPTY_DEAL_FILTERS } from "./filterDeals";
import { MOCK_DEALS, type Deal } from "../mockData";

function d(over: Partial<Deal>): Deal { return { ...MOCK_DEALS[0], ...over }; }

describe("filterDeals", () => {
  const deals = [
    d({ id: "a", valueCents: 100_00, probability: 20, nextFollowup: null }),
    d({ id: "b", valueCents: 900_00, probability: 80, nextFollowup: "2026-06-30" }),
  ];
  it("EMPTY is a no-op", () => {
    expect(applyDealFilters(deals, EMPTY_DEAL_FILTERS).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("minValueCents", () => {
    expect(applyDealFilters(deals, { ...EMPTY_DEAL_FILTERS, minValueCents: 500_00 }).map((x) => x.id)).toEqual(["b"]);
  });
  it("minProbability", () => {
    expect(applyDealFilters(deals, { ...EMPTY_DEAL_FILTERS, minProbability: 50 }).map((x) => x.id)).toEqual(["b"]);
  });
  it("followUp has / none", () => {
    expect(applyDealFilters(deals, { ...EMPTY_DEAL_FILTERS, followUp: "has" }).map((x) => x.id)).toEqual(["b"]);
    expect(applyDealFilters(deals, { ...EMPTY_DEAL_FILTERS, followUp: "none" }).map((x) => x.id)).toEqual(["a"]);
  });
  it("activeFilterCount", () => {
    expect(activeFilterCount(EMPTY_DEAL_FILTERS)).toBe(0);
    expect(activeFilterCount({ minValueCents: 1, minProbability: 1, followUp: "has" })).toBe(3);
    expect(activeFilterCount({ ...EMPTY_DEAL_FILTERS, minProbability: 50 })).toBe(1);
  });
});
```

- [ ] **Step 6: run** `pnpm test filterDeals` → FAIL. **Step 7: `filterDeals.ts`:**
```ts
import type { Deal } from "../mockData";

export interface DealFilters {
  minValueCents: number | null;
  minProbability: number | null;
  followUp: "any" | "has" | "none";
}

export const EMPTY_DEAL_FILTERS: DealFilters = {
  minValueCents: null,
  minProbability: null,
  followUp: "any",
};

export function applyDealFilters(deals: Deal[], f: DealFilters): Deal[] {
  return deals.filter((d) => {
    if (f.minValueCents != null && d.valueCents < f.minValueCents) return false;
    if (f.minProbability != null && d.probability < f.minProbability) return false;
    if (f.followUp === "has" && d.nextFollowup == null) return false;
    if (f.followUp === "none" && d.nextFollowup != null) return false;
    return true;
  });
}

export function activeFilterCount(f: DealFilters): number {
  return (f.minValueCents != null ? 1 : 0) + (f.minProbability != null ? 1 : 0) + (f.followUp !== "any" ? 1 : 0);
}
```

- [ ] **Step 8: run** `pnpm test filterDeals` → PASS. Then `pnpm typecheck` → clean. **Commit:**
```bash
git add apps/app/src/features/pipeline/lib/sortDeals.ts apps/app/src/features/pipeline/lib/sortDeals.test.ts apps/app/src/features/pipeline/lib/filterDeals.ts apps/app/src/features/pipeline/lib/filterDeals.test.ts
git commit -m "feat(pipeline): sortDeals + filterDeals pure helpers"
```

---

### Task 2: `PipelineFilterPopover` (+ popover dep) (TDD)

**Files:** `apps/app/package.json` (add dep); create `components/PipelineFilterPopover.tsx` (+ test).

- [ ] **Step 1: add dep.** From the worktree app dir: `pnpm add @radix-ui/react-popover`. Confirm it lands in `apps/app/package.json`.

- [ ] **Step 2: `PipelineFilterPopover.test.tsx`:**
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PipelineFilterPopover } from "./PipelineFilterPopover";
import { EMPTY_DEAL_FILTERS } from "../lib/filterDeals";

describe("PipelineFilterPopover", () => {
  it("shows a count badge when filters are active and none when empty", () => {
    const { rerender } = render(<PipelineFilterPopover filters={EMPTY_DEAL_FILTERS} onChange={vi.fn()} />);
    expect(screen.queryByTestId("filter-count")).toBeNull();
    rerender(<PipelineFilterPopover filters={{ ...EMPTY_DEAL_FILTERS, minProbability: 50 }} onChange={vi.fn()} />);
    expect(screen.getByTestId("filter-count")).toHaveTextContent("1");
  });
  it("opening the popover and changing follow-up calls onChange", () => {
    const onChange = vi.fn();
    render(<PipelineFilterPopover filters={EMPTY_DEAL_FILTERS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    // Follow-up "Has follow-up" option — drive however the control is built (see note)
    fireEvent.click(screen.getByRole("button", { name: /has follow-up/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ followUp: "has" }));
  });
  it("Clear resets to empty and is disabled when already empty", () => {
    const onChange = vi.fn();
    render(<PipelineFilterPopover filters={{ ...EMPTY_DEAL_FILTERS, minProbability: 50 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith(EMPTY_DEAL_FILTERS);
  });
});
```
Note: build the **Follow-up** control as three small toggle buttons (Any / Has follow-up / None) so the test can click by name; Min probability as the navigatr `Select` (Any/25%+/50%+/75%+); Min value as a numeric `Input` (prefix "$", dollars → store `minValueCents = dollars*100`, blank → null). If a control's accessible name differs, adjust ONLY the test query (report it). Add `@radix-ui/react-popover` polyfills if jsdom needs pointer-capture (mirror `DealDetailPage.stage-picker.test.tsx`).

- [ ] **Step 3: run** `pnpm test PipelineFilterPopover` → FAIL. **Step 4: implement `PipelineFilterPopover.tsx`** using `@radix-ui/react-popover` (`Popover.Root`/`Trigger`/`Portal`/`Content`). Trigger = the existing-style `Button` (variant secondary, `SlidersHorizontal` leading icon, "Filter") with a count badge (`activeFilterCount(filters)`, `data-testid="filter-count"`, hidden when 0). Content panel: Min value `Input`, Min probability `Select`, Follow-up tri-toggle, and a "Clear" text button (`disabled` when `activeFilterCount === 0`) that calls `onChange(EMPTY_DEAL_FILTERS)`. Each control calls `onChange({ ...filters, <field>: <next> })`. Import `Button`, `Input`, `Select` from `@/components/navigatr`, `SlidersHorizontal` from lucide, and `DealFilters`/`EMPTY_DEAL_FILTERS`/`activeFilterCount` from `../lib/filterDeals`.

- [ ] **Step 5: run** `pnpm test PipelineFilterPopover` → PASS. `pnpm typecheck` → clean. **Commit:**
```bash
git add apps/app/package.json ../../pnpm-lock.yaml apps/app/src/features/pipeline/components/PipelineFilterPopover.tsx apps/app/src/features/pipeline/components/PipelineFilterPopover.test.tsx 2>/dev/null; git add pnpm-lock.yaml 2>/dev/null
git commit -m "feat(pipeline): PipelineFilterPopover (min value, min probability, follow-up) with active-count badge"
```

---

### Task 3: Wire Filter + Sort into `PipelinePage`

**Files:** modify `apps/app/src/features/pipeline/pages/PipelinePage.tsx` (+ add/extend a page test).

READ the file first. The desktop action row in `PageHeader` (`hidden ... sm:flex`) has the stub "Filter" and "Sort: Last activity" `Button`s; the page has a `filtered` memo (owner+stage+search) and `headerKpis` derived from it.

- [ ] **Step 1: page state + derived `visible`.** In `PipelinePage`, add:
```tsx
const [filters, setFilters] = React.useState(EMPTY_DEAL_FILTERS);
const [sortKey, setSortKey] = React.useState<DealSortKey>("last_activity");
```
After the existing `filtered` memo, add:
```tsx
const visible = React.useMemo(() => sortDeals(applyDealFilters(filtered, filters), sortKey), [filtered, filters, sortKey]);
```
Leave `headerKpis` using `filtered`/`deals` (advanced filters must NOT change the KPIs). Import `sortDeals`, `DealSortKey` from `../lib/sortDeals`; `applyDealFilters`, `EMPTY_DEAL_FILTERS` from `../lib/filterDeals`.

- [ ] **Step 2: render `visible` instead of `filtered`** in the three card-render spots — the `<KanbanBoard deals={...} />`, the kanban-fallback list `.map`, and the pure list `.map`. (Keep `isLoading`/`EmptyState` keyed on `visible.length` so an over-filtered set shows the empty state.)

- [ ] **Step 3: PageHeader props + controls.** Extend `PageHeader`'s props with `filters`, `onFiltersChange`, `sortKey`, `onSortChange`. Replace the stub Filter `Button` with `<PipelineFilterPopover filters={filters} onChange={onFiltersChange} />` and the stub Sort `Button` with the navigatr `Select` (options from `DEAL_SORT_LABEL`, value `sortKey`, onValueChange → `onSortChange`, rendered with a "Sort: " visual prefix or a leading label). Pass the four new props from `PipelinePage` into `<PageHeader …>`. Remove now-unused `SlidersHorizontal`/`ChevronDown` imports if the popover/Select absorb them (let typecheck guide).

- [ ] **Step 4: page test.** Add to (or create) `PipelinePage.test.tsx`: with `useDeals` mocked to a small set spanning probabilities, assert (a) default render shows all; (b) setting min-probability via the filter reduces the rendered cards; (c) the Sort control offers the four labels. (Drive the Radix Popover/Select with the pointer-capture polyfills as other tests do; if too brittle, assert the helper-level behavior is wired by checking `visible` indirectly through rendered company names after interacting.) Keep existing PipelinePage tests green.

- [ ] **Step 5:** `pnpm typecheck && pnpm test` (full) → clean/green. **Commit:**
```bash
git add apps/app/src/features/pipeline/pages/PipelinePage.tsx apps/app/src/features/pipeline/pages/PipelinePage.test.tsx
git commit -m "feat(pipeline): wire advanced Filter + Sort into the pipeline list/Kanban"
```

---

## Notes for the implementer

- Advanced filters feed `visible` (rendered cards), NOT `headerKpis`/subhead — keep KPIs on the
  existing `filtered`/`deals` basis.
- `visible` flows to both the list and `<KanbanBoard deals={visible}>`, so Kanban columns get
  filtered + sorted-within-column for free.
- In-memory state only — no URL/localStorage.
- Min value input is in dollars; store `minValueCents = Math.max(0, dollars) * 100`; blank → null.
- Keep the existing stage chips, search, owner banner, view toggle untouched.
