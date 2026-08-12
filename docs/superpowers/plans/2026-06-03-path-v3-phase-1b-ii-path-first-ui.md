# Path v3 — Phase 1b-ii: path-first UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Build the visual components (PathEntry, ActivePathView) with the `frontend-design` skill during execution** — the code blocks here are a working, on-system baseline; frontend-design refines spacing/hierarchy/polish against the navigatr design system. Verify with `/design-review` after.

**Goal:** Make the Path page path-first: a two-card entry (Create a Path / Plan a Path) when there's no active path, the current day's path as the main content when there is one, and the existing map+list discovery demoted to an "Add stops" view reached from a path.

**Architecture:** A top-level `pathView` state in `PathPage` (`"entry" | "active" | "discover"`) selects between three views. `PathEntry` (two cards) and `ActivePathView` (list-first home, rendered from the server path's own stop snapshots) are new components. The existing discovery JSX (filters + map + list) is wrapped in the `"discover"` branch and reused as the add-stops surface. Create opens the existing `CreatePathWizard`; Plan and "Add stops" enter `"discover"`. View defaults to `"active"` when today's path has stops, else `"entry"`.

**Tech Stack:** React + TypeScript, the Phase-1a/1b-i path hooks (`useTodayPath`), existing `MerchantMap`/`routeStats`/design-system components, Vitest + Testing Library, `frontend-design` for component polish.

---

## Conventions

- Branch off `main`: `git checkout main && git pull && git checkout -b feat/path-v3-ui`.
- Tests: `pnpm --filter app test <path>`; full gate `cd apps/app && pnpm typecheck && pnpm test`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- "kaboom from Bomb" stderr is expected. No DB/Edge changes; ships via Vercel on push to main.

## Spec

`docs/superpowers/specs/2026-06-03-path-v3-path-first-redesign-design.md` (Phase 1b, the UI half). Phase 1a (tables/hooks) and 1b-i (server-backed today's path behind the current UI) are already on main.

## Building blocks already on main

- `hooks/useTodayPath.ts` → `{ stops: TodayStop[], add(snapshot), remove(merchantId), setStatus(merchantId,status), logVisit, markDealCreated, clear, has, isComplete, pendingCount, isLoading }`. `TodayStop` currently exposes `merchantId/status/disposition/dealCreated/addedAt` (Task 1 adds the snapshot fields). `StopStatus = 'pending'|'visited'|'skipped'`.
- `hooks/usePathOrigin.ts` → `{ origin: {lat,lng}|null, originLabel, ... }`.
- `lib/routeStats.ts` → `routeStats(origin: LatLng, orderedStops: LatLng[])` → `{ stopCount, nearestMeters, furthestMeters, etaMinutes }`; `formatEta(min)`.
- `components/MerchantMap.tsx` → props `{ position, merchants: Merchant[], routePath?: LatLng[], focusedMerchantId?, onMerchantClick? }`.
- `components/CreatePathWizard.tsx`, `components/MerchantDetailSheet.tsx`, `lib/distance.ts` (`formatDistance`), `mockData.ts` (`CATEGORY_LABEL`).
- design system: `@/components/navigatr` (`Button`, `Card`, `Chip`).

## Scope (1b-ii)

IN: the two-card entry, ActivePathView as main content (day header + stats + ordered stop list with per-stop status + remove + a route map + "Add stops"), discovery-as-add-stops, the `pathView` state machine, Create/Plan wiring.
DEFERRED (Phase 1b-iii / 2 / 3, flagged where relevant): drop-in disposition logged *from a path stop* (today it's from the discovery detail sheet), a dedicated map-forward "Start route" running mode, drag-reorder UI, optimistic updates.

## File Structure

- **Modify** `hooks/useTodayPath.ts` (+test) — expose snapshot fields on `TodayStop`.
- **Create** `components/PathEntry.tsx` (+test) — the two entry cards.
- **Create** `components/ActivePathView.tsx` (+test) — list-first home.
- **Modify** `pages/PathPage.tsx` (+test) — `pathView` state machine + wiring.

---

## Task 1: Expose snapshot fields on `TodayStop`

**Files:**
- Modify: `apps/app/src/features/path/hooks/useTodayPath.ts`
- Test: `apps/app/src/features/path/hooks/useTodayPath.test.tsx`

ActivePathView renders stop names + distances + the route line from the path's own snapshot (a path's stops may not be in the current `liveMerchants`). Surface them.

- [ ] **Step 1: Update the failing test**

In `useTodayPath.test.tsx`, the "exposes stops in queue shape" test currently expects only `{ merchantId, status, disposition, dealCreated, addedAt }`. The mocked `useActivePath` stop already carries `prospectId/name/address/lat/lng/category/primaryType` in other tests — extend the stop-shape test's input + expectation. Replace that test with:
```tsx
  it("exposes stops with snapshot fields (merchantId = prospectId)", () => {
    activeState.current = { data: { path: { id: "p1" }, stops: [
      { id: "s1", prospectId: "m1", name: "Uratex", address: "Rd", lat: 1, lng: 2,
        category: "manufacturing", primaryType: null, status: "visited",
        disposition: "met_dm", dealCreated: true, addedAt: "t1", position: 0 },
    ] }, isLoading: false };
    const { result } = renderHook(() => useTodayPath());
    expect(result.current.stops).toEqual([
      { merchantId: "m1", name: "Uratex", address: "Rd", lat: 1, lng: 2,
        category: "manufacturing", primaryType: null, status: "visited",
        disposition: "met_dm", dealCreated: true, addedAt: "t1" },
    ]);
    expect(result.current.has("m1")).toBe(true);
    expect(result.current.isComplete()).toBe(true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/hooks/useTodayPath.test.tsx`
Expected: FAIL — `stops` lacks the snapshot fields.

- [ ] **Step 3: Extend `TodayStop` + the mapping**

In `useTodayPath.ts`, update the interface:
```ts
export interface TodayStop {
  merchantId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  category: string;
  primaryType: string | null;
  status: StopStatus;
  disposition: string | null;
  dealCreated: boolean;
  addedAt: string;
}
```
And the `stops` mapping:
```ts
  const stops: TodayStop[] = React.useMemo(
    () => rawStops.map((s) => ({
      merchantId: s.prospectId, name: s.name, address: s.address, lat: s.lat, lng: s.lng,
      category: s.category, primaryType: s.primaryType, status: s.status,
      disposition: s.disposition, dealCreated: s.dealCreated, addedAt: s.addedAt,
    })),
    [rawStops],
  );
```

- [ ] **Step 4: Run it to verify it passes + full gate**

Run: `pnpm --filter app test src/features/path/hooks/useTodayPath.test.tsx` → PASS.
Run: `cd apps/app && pnpm typecheck && pnpm test` → clean (PathPlanSheet/PathPage read a subset of TodayStop, so adding fields is non-breaking).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/path/hooks/useTodayPath.ts apps/app/src/features/path/hooks/useTodayPath.test.tsx
git commit -m "feat(path): expose stop snapshot fields on TodayStop"
```

---

## Task 2: `PathEntry` — the two entry cards

**Files:**
- Create: `apps/app/src/features/path/components/PathEntry.tsx`
- Test: `apps/app/src/features/path/components/PathEntry.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/app/src/features/path/components/PathEntry.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PathEntry } from "./PathEntry";

describe("PathEntry", () => {
  it("offers Create and Plan, wired to their handlers", () => {
    const onCreate = vi.fn(); const onPlan = vi.fn();
    render(<PathEntry onCreate={onCreate} onPlan={onPlan} />);
    fireEvent.click(screen.getByRole("button", { name: /create a path/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /plan a path/i }));
    expect(onPlan).toHaveBeenCalledTimes(1);
  });

  it("explains each option", () => {
    render(<PathEntry onCreate={vi.fn()} onPlan={vi.fn()} />);
    expect(screen.getByText(/from your current location/i)).toBeInTheDocument();
    expect(screen.getByText(/search by city or zip/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/components/PathEntry.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the component (baseline; frontend-design polishes)**

`apps/app/src/features/path/components/PathEntry.tsx`:
```tsx
import { Sparkles, MapPinned } from "lucide-react";
import { Card } from "@/components/navigatr";

interface PathEntryProps {
  onCreate: () => void;
  onPlan: () => void;
}

/**
 * PathEntry — first thing a rep sees with no active path: pick how to build one.
 * Create = auto-discover from GPS, prospect now. Plan = search a city/ZIP and
 * hand-pick for a day. Built as two large, obviously-tappable cards (buttons).
 */
export function PathEntry({ onCreate, onPlan }: PathEntryProps) {
  return (
    <div className="mt-6 flex flex-col gap-3 self-stretch md:mx-auto md:max-w-2xl">
      <button type="button" onClick={onCreate} className="text-left">
        <Card padding="lg" className="flex items-start gap-4 transition-colors hover:border-border-strong">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-md bg-surface-sunken text-text-default">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-heading-sm text-text-default">Create a Path</p>
            <p className="text-body-md text-text-muted">
              Auto-discover nearby businesses from your current location and start prospecting right now. Best when you&apos;re already in the field.
            </p>
          </div>
        </Card>
      </button>
      <button type="button" onClick={onPlan} className="text-left">
        <Card padding="lg" className="flex items-start gap-4 transition-colors hover:border-border-strong">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-md bg-surface-sunken text-text-default">
            <MapPinned className="h-5 w-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-heading-sm text-text-default">Plan a Path</p>
            <p className="text-body-md text-text-muted">
              Search by city or ZIP, filter by business type, and hand-pick the stops you want to visit later. Best for prepping an upcoming day.
            </p>
          </div>
        </Card>
      </button>
    </div>
  );
}
```
NOTE: confirm `Card` accepts `padding="lg"` + `className` (it does — used in PathPage) and that `border-border-strong` exists (else use `border-border-default`/a hover token from the theme — `grep border- apps/app/tailwind.config.ts`). A `<button>` wrapping a `<Card>` gives the `role="button"` the test queries with the card's text as its accessible name.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test src/features/path/components/PathEntry.test.tsx` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/path/components/PathEntry.tsx apps/app/src/features/path/components/PathEntry.test.tsx
git commit -m "feat(path): PathEntry two-card entry"
```

---

## Task 3: `ActivePathView` — list-first home

**Files:**
- Create: `apps/app/src/features/path/components/ActivePathView.tsx`
- Test: `apps/app/src/features/path/components/ActivePathView.test.tsx`

Renders the current day's path as the main content: a day/stats header, the ordered stop list (each with a status control + remove), a map drawing the route, and an "Add stops" button. Reads `useTodayPath` (stops carry snapshots after Task 1) + the rep `origin` for route math.

- [ ] **Step 1: Write the failing test**

`apps/app/src/features/path/components/ActivePathView.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActivePathView } from "./ActivePathView";

const setStatus = vi.fn(); const remove = vi.fn();
const todayState = { current: {
  stops: [
    { merchantId: "m1", name: "Uratex", address: "Rd", lat: 30.3, lng: -97.7, category: "manufacturing", primaryType: null, status: "pending", disposition: null, dealCreated: false, addedAt: "t1" },
    { merchantId: "m2", name: "Amkor", address: "Rd2", lat: 30.4, lng: -97.7, category: "manufacturing", primaryType: null, status: "visited", disposition: "met_dm", dealCreated: true, addedAt: "t2" },
  ],
  setStatus, remove, isComplete: () => false,
} };
vi.mock("../hooks/useTodayPath", () => ({ useTodayPath: () => todayState.current }));
// MerchantMap is MapLibre — stub it.
vi.mock("./MerchantMap", () => ({ MerchantMap: () => <div data-testid="map" /> }));

beforeEach(() => { setStatus.mockClear(); remove.mockClear(); });

describe("ActivePathView", () => {
  it("lists the stops in order with names and a stop count", () => {
    render(<ActivePathView origin={{ lat: 30, lng: -97 }} onAddStops={vi.fn()} />);
    expect(screen.getByText("Uratex")).toBeInTheDocument();
    expect(screen.getByText("Amkor")).toBeInTheDocument();
    expect(screen.getByText(/2 stops/i)).toBeInTheDocument();
  });

  it("marks a stop visited via setStatus", () => {
    render(<ActivePathView origin={{ lat: 30, lng: -97 }} onAddStops={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: /visited/i })[0]);
    expect(setStatus).toHaveBeenCalledWith("m1", "visited");
  });

  it("fires onAddStops from the Add stops button", () => {
    const onAddStops = vi.fn();
    render(<ActivePathView origin={{ lat: 30, lng: -97 }} onAddStops={onAddStops} />);
    fireEvent.click(screen.getByRole("button", { name: /add stops/i }));
    expect(onAddStops).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/components/ActivePathView.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the component (baseline; frontend-design polishes)**

`apps/app/src/features/path/components/ActivePathView.tsx`:
```tsx
import * as React from "react";
import { Check, X, Plus, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/navigatr";
import { MerchantMap } from "./MerchantMap";
import { useTodayPath } from "../hooks/useTodayPath";
import { routeStats, formatEta } from "../lib/routeStats";
import { formatDistance } from "@/lib/distance";
import { CATEGORY_LABEL, type MerchantCategory } from "../mockData";

interface ActivePathViewProps {
  /** Rep position — route math + map center. */
  origin: { lat: number; lng: number };
  /** Open the discovery / "add stops" view. */
  onAddStops: () => void;
}

/**
 * ActivePathView — the path-first home. The rep's current day's path IS the main
 * content: a stats header, the ordered stops (status + remove), a route map, and
 * Add stops. Reads the path from useTodayPath (stops carry snapshots, so this
 * renders without the discovery list). frontend-design refines the visuals.
 */
export function ActivePathView({ origin, onAddStops }: ActivePathViewProps) {
  const { stops, setStatus, remove } = useTodayPath();
  const orderedCoords = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
  const stats = React.useMemo(() => routeStats(origin, orderedCoords), [origin, stops]); // eslint-disable-line react-hooks/exhaustive-deps
  const routePath = stops.length > 0 ? [origin, ...orderedCoords] : undefined;

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 md:grid md:grid-cols-[1.4fr_1fr]">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 rounded-radius-md bg-surface-sunken p-3 text-center">
          <Stat label="Stops" value={`${stats.stopCount} stops`} />
          <Stat label="Nearest" value={stats.nearestMeters == null ? "—" : formatDistance(stats.nearestMeters)} />
          <Stat label="Est. time" value={formatEta(stats.etaMinutes)} />
        </div>
        <ol className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          {stops.map((s, i) => (
            <li key={s.merchantId} className={cn(
              "flex items-center gap-3 rounded-radius-md border border-border-default p-3",
              s.status === "visited" && "opacity-60",
            )}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-radius-full bg-surface-sunken text-caption font-semibold tabular-nums text-text-muted">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-md font-medium text-text-default">{s.name}</p>
                <p className="truncate text-caption text-text-muted">
                  <MapPin className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden />
                  {CATEGORY_LABEL[s.category as MerchantCategory] ?? s.category}
                  {s.status !== "pending" ? ` · ${s.status}` : ""}
                </p>
              </div>
              <button type="button" aria-label="Mark visited" onClick={() => setStatus(s.merchantId, "visited")}
                className="rounded-radius-sm p-1.5 text-text-muted hover:text-status-on-track">
                <Check className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" aria-label="Remove from path" onClick={() => remove(s.merchantId)}
                className="rounded-radius-sm p-1.5 text-text-muted hover:text-status-danger">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
        <Button variant="secondary" size="sm" leadingIcon={Plus} onClick={onAddStops} className="self-start">
          Add stops
        </Button>
      </div>
      <div className="min-h-[280px]">
        <MerchantMap position={origin} merchants={[]} routePath={routePath} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-body-md font-semibold tabular-nums text-text-default">{value}</p>
      <p className="text-caption text-text-muted">{label}</p>
    </div>
  );
}
```
NOTE: verify the status tokens `text-status-on-track` / `text-status-danger` exist (`grep status- apps/app/tailwind.config.ts`); substitute the project's equivalents if named differently. `setStatus`/`remove` are fire-and-forget (their promises are ignored in the click handlers). The `aria-label="Mark visited"` button is what the test's `/visited/i` query matches.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test src/features/path/components/ActivePathView.test.tsx` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/path/components/ActivePathView.tsx apps/app/src/features/path/components/ActivePathView.test.tsx
git commit -m "feat(path): ActivePathView list-first home"
```

---

## Task 4: PathPage state machine + wiring

**Files:**
- Modify: `apps/app/src/features/path/pages/PathPage.tsx`
- Test: `apps/app/src/features/path/pages/PathPage.test.tsx`

- [ ] **Step 1: Add the `pathView` state + imports**

In `PathPage.tsx`, add imports:
```tsx
import { PathEntry } from "../components/PathEntry";
import { ActivePathView } from "../components/ActivePathView";
```
Add state (near the other `useState`s):
```tsx
  // Path-first view selector. Defaults to the active path when today has stops,
  // else the entry cards. "discover" is the add-stops surface (the old map+list).
  const [pathView, setPathView] = React.useState<"entry" | "active" | "discover">("entry");
```
After `queueStops` is defined, sync the default once stops load:
```tsx
  // When today's path has stops, the active view is home; an empty path shows entry.
  // Only auto-switch out of/into these two — never override an explicit "discover".
  React.useEffect(() => {
    setPathView((v) => (v === "discover" ? v : queueStops.length > 0 ? "active" : "entry"));
  }, [queueStops.length]);
```

- [ ] **Step 2: Wire Create / Plan / Add stops**

- The header "Create path" button already calls `setCreateOpen(true)` — keep it (CreatePathWizard's `onStart` already writes stops via `handleStartPath`, after which the effect flips to "active").
- Add Plan + Add-stops handlers:
```tsx
  const handlePlan = React.useCallback(() => setPathView("discover"), []);
  const handleAddStops = React.useCallback(() => setPathView("discover"), []);
  const handleDoneDiscovering = React.useCallback(
    () => setPathView(queueStops.length > 0 ? "active" : "entry"),
    [queueStops.length],
  );
```

- [ ] **Step 3: Branch the body by `pathView`**

The existing body (the `{!origin && geoStatus === "loading" ? ... : ... }` ladder down through the map+list) is the **discover** view. Wrap the render so:
- `pathView === "entry"` → render `<PathEntry onCreate={() => setCreateOpen(true)} onPlan={handlePlan} />` (instead of the discovery body).
- `pathView === "active"` → render `<ActivePathView origin={origin ?? { lat: 0, lng: 0 }} onAddStops={handleAddStops} />`.
- `pathView === "discover"` → the existing discovery body (filters + map/list + its empty/loading branches), with a "Done" affordance: add a `Button` above the filter chips, only in discover view, `onClick={handleDoneDiscovering}` labeled `queueStops.length > 0 ? "Back to path" : "Done"`.

Concretely, find the top of the returned JSX body (after the header + location bar) and structure it as:
```tsx
      {pathView === "entry" ? (
        <PathEntry onCreate={() => setCreateOpen(true)} onPlan={handlePlan} />
      ) : pathView === "active" ? (
        <ActivePathView origin={origin ?? { lat: 0, lng: 0 }} onAddStops={handleAddStops} />
      ) : (
        <>
          <Button variant="tertiary" size="sm" onClick={handleDoneDiscovering} className="mt-3 self-start">
            {queueStops.length > 0 ? "Back to path" : "Done"}
          </Button>
          {/* ...the existing filter chips + radius/sort/hideChains + body ladder + map/list, unchanged... */}
        </>
      )}
```
Keep the filter chips/radius/sort/hideChains controls and the `{!origin && geoStatus === "loading" ? ...}` ladder inside the `discover` branch only. The `MerchantDetailSheet` / `PathPlanSheet` / `CreatePathWizard` (the sheets at the bottom of the return) stay mounted regardless of `pathView` (they're portals; keep them outside the branch).

- [ ] **Step 4: Typecheck**

Run: `cd apps/app && pnpm typecheck`
Expected: ZERO errors. (The header's "Today's path" button + `setPlanOpen` still open the PathPlanSheet — leave them; the plan sheet remains a valid way to view the route. If `anyGeocoded`-gated chips referenced things now only in the discover branch, they're all inside it.)

- [ ] **Step 5: Update PathPage tests**

`PathPage.test.tsx` mocks `usePathOrigin`. It now also needs `useTodayPath` mocked (the page calls it). Add:
```tsx
const todayState = { current: { stops: [] as unknown[], add: vi.fn(), clear: vi.fn(), has: () => false, isComplete: () => false, setStatus: vi.fn(), remove: vi.fn() } };
vi.mock("../hooks/useTodayPath", () => ({ useTodayPath: () => todayState.current }));
vi.mock("../components/ActivePathView", () => ({ ActivePathView: () => <div data-testid="active-path" /> }));
```
Add/adjust tests:
```tsx
  it("shows the two-card entry when there is no active path", () => {
    todayState.current = { ...todayState.current, stops: [] };
    originState.current = { ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready" };
    render(<PathPage />, { wrapper });
    expect(screen.getByRole("button", { name: /create a path/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /plan a path/i })).toBeInTheDocument();
  });

  it("shows the active path view when today's path has stops", () => {
    todayState.current = { ...todayState.current, stops: [{ merchantId: "m1" }] };
    originState.current = { ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready" };
    render(<PathPage />, { wrapper });
    expect(screen.getByTestId("active-path")).toBeInTheDocument();
  });
```
Keep the existing location-state tests (loading/denied) but note: the entry/active branches only matter once `origin` is set; the no-origin loading/denied empty states should still render (they're inside the discover branch OR gate before pathView — ensure the no-origin states render regardless of pathView, since with no origin there's no useful path view). ADJUST: in Step 3, render the no-origin loading/empty-state ladder BEFORE the `pathView` switch (so a blocked rep still sees the location empty state). I.e. the order is: if `!origin` → (loading | blocked | unavailable) [existing]; else → switch on pathView. Update the test expectations accordingly: the denied test still expects the blocked card.

- [ ] **Step 6: Full gate**

Run: `cd apps/app && pnpm typecheck && pnpm test`
Expected: typecheck clean; all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/features/path/pages/PathPage.tsx apps/app/src/features/path/pages/PathPage.test.tsx
git commit -m "feat(path): path-first PathPage (entry / active / discover)"
```

---

## Task 5: Design pass + ship

- [ ] **Step 1: frontend-design polish.** Invoke `frontend-design` on `PathEntry` and `ActivePathView` (brief: the navigatr dark theme, the approved IA — entry cards + list-first active path; reference the spec). Apply its refinements, keep tests green.
- [ ] **Step 2: `/design-review`** pass on the Path page (entry / active / discover states).
- [ ] **Step 3: Final gate** — `cd apps/app && pnpm typecheck && pnpm test`.
- [ ] **Step 4: Manual smoke (logged in):** no path → two cards; Create → wizard → lands on active path as main content; Add stops → discovery → add → Back to path; Plan → discovery from a searched city. Reload mid-path → still on active path.
- [ ] **Step 5: Finish the branch** (superpowers:finishing-a-development-branch → merge to main + push; Vercel deploys; no DB/Edge).

---

## Self-Review

**Spec coverage (1b-ii):**
- Two-card entry (Create / Plan) → Task 2 + Task 4 (entry branch). ✅
- Active path as main content (list-first) → Task 1 (snapshot fields) + Task 3 + Task 4 (active branch). ✅
- Discovery demoted to "Add stops" → Task 4 (discover branch + Back-to-path). ✅
- Create = wizard → today's path; Plan = discovery → hand-pick → today's path → Task 4 wiring (Plan targets today in Phase 1; multi-day date targeting is Phase 2). ✅
- Deferred (flagged): drop-in-from-path-stop, dedicated Start-route running mode, drag-reorder, optimistic updates — Phase 1b-iii/2/3.

**Placeholder scan:** No TBD/TODO. Each code step shows full code or exact commands. NOTEs are concrete token-verification instructions with fallbacks. Task 5 Steps 1-2 are skill invocations (frontend-design / design-review), not code placeholders.

**Type consistency:** `TodayStop` (extended in Task 1) is what ActivePathView (Task 3) reads (`name/lat/lng/category/status/merchantId`). `PathEntry` props `{ onCreate, onPlan }` and `ActivePathView` props `{ origin, onAddStops }` match how Task 4 renders them. `pathView` union `"entry"|"active"|"discover"` is used consistently. `setStatus(merchantId, "visited")` / `remove(merchantId)` match `useTodayPath`'s signatures. `routeStats(origin, LatLng[])` + `MerchantMap` props match the real signatures.

**Known dependency:** Task 4 reorders the body so the no-origin location states (loading/blocked/unavailable from 1b-i) render BEFORE the pathView switch — preserving the blocked-location UX shipped earlier. Called out explicitly in Task 4 Step 5.
