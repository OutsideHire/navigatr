# Path v3 — Phase 1b-i: storage swap (server-backed today's path) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local-only `usePathQueue` with a server-backed "today's path" behind the *current* UI (no visible redesign yet), and migrate any existing local queue once — so today's path becomes durable + multi-device with zero UX change.

**Architecture:** A `useTodayPath()` adapter exposes a `usePathQueue`-shaped interface (stops keyed by `merchantId` = `prospectId`, plus `add`/`remove`/`setStatus`/`logVisit`/`markDealCreated`/`clear`/`has`/`isComplete`) but is backed by the Phase-1a hooks (`useActivePath(today)` for reads, `usePathMutations` for writes). Components swap their import from `usePathQueue` → `useTodayPath`; the only behavioral change is `add` now takes a stop snapshot (the caller has the merchant) and writes are async (UI refreshes via query invalidation). A one-time migration copies a non-empty local queue into today's server path using loaded merchant details for the snapshot.

**Tech Stack:** Supabase (Phase-1a tables/hooks), TanStack Query, React, Vitest + Testing Library.

---

## Conventions

- Branch off `main`: `git checkout main && git pull && git checkout -b feat/path-v3-storage-swap`.
- Tests: `pnpm --filter app test <path>`; full gate `cd apps/app && pnpm typecheck && pnpm test`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- The intentional "kaboom from Bomb" stderr is expected, not a failure.
- No DB migration in 1b-i (tables exist from 1a). No prod deploy beyond the Vercel frontend push at finish.

## Spec

`docs/superpowers/specs/2026-06-03-path-v3-path-first-redesign-design.md` (Phase 1b). 1b-i = the storage swap + queue migration. The path-first IA (PathEntry/ActivePathView/discovery-as-add-stops) is **Phase 1b-ii**.

## Phase-1a building blocks (already on main)

- `lib/pathTypes.ts`: `Path`, `PathStop` (fields: `id, pathId, prospectId, name, address, lat, lng, category, primaryType, position, status: 'pending'|'visited'|'skipped', disposition, dealCreated, addedAt`), `StopStatus`.
- `hooks/useActivePath.ts`: `useActivePath(date)` → `{ path: Path | null, stops: PathStop[] }`; exports `ACTIVE_PATH_QUERY_KEY`.
- `hooks/usePaths.ts`: exports `PATHS_QUERY_KEY`.
- `hooks/usePathMutations.ts`: `createPath`, `addStops`, `removeStop`, `reorderStops`, `setStopStatus`, `setStopDisposition`, `markDealCreated` (each a TanStack `useMutation`). `addStops` dedupes via upsert.

## Consumers being rewired (current `usePathQueue` usage)

- `components/MerchantDetailSheet.tsx`: `has(merchant.id)`, `add`, `remove`.
- `components/DropInSheet.tsx`: `logVisit(merchant.id, disposition)`, `markDealCreated(merchant.id)`.
- `components/PathPlanSheet.tsx`: `stops`, `setStatus`, `remove`, `clear`, `isComplete()`.
- `pages/PathPage.tsx`: `stops`, `add` (wizard hand-off), `clear`.

## File Structure

- **Modify** `hooks/usePathMutations.ts` — add `deletePath` mutation (for `clear`).
- **Create** `hooks/useTodayPath.ts` — the server-backed queue-shaped adapter.
- **Create** `hooks/useTodayPath.test.tsx`.
- **Create** `lib/migrateLocalQueue.ts` — pure migration planner (local stops + merchant lookup → snapshots to insert).
- **Create** `lib/migrateLocalQueue.test.ts`.
- **Modify** `pages/PathPage.tsx` — swap to `useTodayPath`; run the one-time migration.
- **Modify** `components/MerchantDetailSheet.tsx` / `DropInSheet.tsx` / `PathPlanSheet.tsx` — swap to `useTodayPath`.
- `hooks/usePathQueue.ts` stays (read only by `migrateLocalQueue`); retired in a later cleanup once migration is proven in the field.

---

## Task 1: `deletePath` mutation (for `clear`)

**Files:**
- Modify: `apps/app/src/features/path/hooks/usePathMutations.ts`
- Test: `apps/app/src/features/path/hooks/usePathMutations.test.tsx`

- [ ] **Step 1: Add the failing test**

Append inside `usePathMutations.test.tsx` (the table-aware mock already stubs `paths`/`path_stops`; extend it for `delete().eq()`). First extend the mock — find:
```tsx
const fromMock = vi.fn((table: string) =>
  table === "paths" ? { upsert: pathsUpsertMock } : { upsert: stopsUpsertMock },
);
```
Replace with:
```tsx
const deleteEqMock = vi.fn(() => Promise.resolve(result.current));
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }));
const fromMock = vi.fn((table: string) =>
  table === "paths" ? { upsert: pathsUpsertMock, delete: deleteMock } : { upsert: stopsUpsertMock },
);
```
Add `deleteMock.mockClear(); deleteEqMock.mockReset();` to `beforeEach`. Then add this test:
```tsx
describe("usePathMutations.deletePath", () => {
  it("deletes the path by id (cascade removes its stops)", async () => {
    const { result: hook } = renderHook(() => usePathMutations(), { wrapper: wrap(makeClient()) });
    await hook.current.deletePath.mutateAsync("p1");
    expect(fromMock).toHaveBeenCalledWith("paths");
    expect(deleteMock).toHaveBeenCalled();
    expect(deleteEqMock).toHaveBeenCalledWith("id", "p1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/hooks/usePathMutations.test.tsx`
Expected: FAIL — `deletePath` is undefined.

- [ ] **Step 3: Add the mutation**

In `usePathMutations.ts`, add (before the `return {...}`):
```ts
  const deletePath = useMutation({
    mutationFn: async (pathId: string): Promise<void> => {
      const { error } = await supabase.from("paths").delete().eq("id", pathId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
```
And add `deletePath` to the returned object:
```ts
  return { createPath, addStops, removeStop, reorderStops, setStopStatus, setStopDisposition, markDealCreated, deletePath };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test src/features/path/hooks/usePathMutations.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/path/hooks/usePathMutations.ts apps/app/src/features/path/hooks/usePathMutations.test.tsx
git commit -m "feat(path): deletePath mutation"
```

---

## Task 2: `migrateLocalQueue` planner (pure)

**Files:**
- Create: `apps/app/src/features/path/lib/migrateLocalQueue.ts`
- Test: `apps/app/src/features/path/lib/migrateLocalQueue.test.ts`

A pure function that turns the local queue stops + a merchant lookup into the stop snapshots to insert. Keeping it pure makes the one-time migration testable without mocking storage or the network.

- [ ] **Step 1: Write the failing test**

`apps/app/src/features/path/lib/migrateLocalQueue.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { planQueueMigration, type LocalStop } from "./migrateLocalQueue";
import type { Merchant } from "../mockData";

const merchant = (over: Partial<Merchant> & { id: string }): Merchant => ({
  id: over.id, name: over.name ?? "Biz", address: over.address ?? "Addr",
  lat: over.lat ?? 1, lng: over.lng ?? 2, category: over.category ?? "manufacturing",
  primaryType: over.primaryType ?? "manufacturer",
  // other Merchant fields are irrelevant to the planner:
} as Merchant);

describe("planQueueMigration", () => {
  it("maps resolvable local stops to snapshots in order", () => {
    const local: LocalStop[] = [{ merchantId: "a" }, { merchantId: "b" }];
    const byId = new Map([["a", merchant({ id: "a", name: "A" })], ["b", merchant({ id: "b", name: "B", lat: 3, lng: 4 })]]);
    const { snapshots, unresolved } = planQueueMigration(local, byId);
    expect(unresolved).toEqual([]);
    expect(snapshots).toEqual([
      { prospectId: "a", name: "A", address: "Addr", lat: 1, lng: 2, category: "manufacturing", primaryType: "manufacturer" },
      { prospectId: "b", name: "B", address: "Addr", lat: 3, lng: 4, category: "manufacturing", primaryType: "manufacturer" },
    ]);
  });

  it("skips (and reports) local stops whose merchant details aren't loaded", () => {
    const local: LocalStop[] = [{ merchantId: "a" }, { merchantId: "ghost" }];
    const byId = new Map([["a", merchant({ id: "a" })]]);
    const { snapshots, unresolved } = planQueueMigration(local, byId);
    expect(snapshots.map((s) => s.prospectId)).toEqual(["a"]);
    expect(unresolved).toEqual(["ghost"]);
  });

  it("returns empty for an empty queue", () => {
    expect(planQueueMigration([], new Map())).toEqual({ snapshots: [], unresolved: [] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/lib/migrateLocalQueue.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the planner**

`apps/app/src/features/path/lib/migrateLocalQueue.ts`:
```ts
/**
 * planQueueMigration — pure planner for the one-time local-queue → server-path
 * migration. The local queue stores only merchant ids; path_stops needs the
 * display snapshot, so we resolve each id against the currently-loaded merchants
 * (from useMerchants). Stops whose merchant isn't loaded are reported as
 * `unresolved` and skipped (best-effort: the local queue is ephemeral
 * today-only data, and the rep is normally near the queued businesses on first
 * v3 load). The caller (PathPage) feeds these snapshots into addStops.
 */
import type { Merchant } from "../mockData";
import type { StopSnapshot } from "../hooks/usePathMutations";

/** Minimal shape we read from a persisted usePathQueue stop. */
export interface LocalStop {
  merchantId: string;
}

export interface QueueMigrationPlan {
  snapshots: StopSnapshot[];
  unresolved: string[];
}

export function planQueueMigration(
  localStops: LocalStop[],
  merchantsById: Map<string, Merchant>,
): QueueMigrationPlan {
  const snapshots: StopSnapshot[] = [];
  const unresolved: string[] = [];
  for (const stop of localStops) {
    const m = merchantsById.get(stop.merchantId);
    if (!m) {
      unresolved.push(stop.merchantId);
      continue;
    }
    snapshots.push({
      prospectId: m.id,
      name: m.name,
      address: m.address ?? null,
      lat: m.lat,
      lng: m.lng,
      category: m.category,
      primaryType: m.primaryType ?? null,
    });
  }
  return { snapshots, unresolved };
}
```
NOTE: verify `Merchant`'s field names before running — `grep -n "primaryType\|address\|category\|lat" apps/app/src/features/path/mockData.ts`. If `Merchant.primaryType` is named differently (e.g. `primary_type`), match it. Adjust the test's `merchant()` helper + the planner together so the snapshot fields are correct.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test src/features/path/lib/migrateLocalQueue.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/path/lib/migrateLocalQueue.ts apps/app/src/features/path/lib/migrateLocalQueue.test.ts
git commit -m "feat(path): pure planner for local-queue migration"
```

---

## Task 3: `useTodayPath` adapter

**Files:**
- Create: `apps/app/src/features/path/hooks/useTodayPath.ts`
- Test: `apps/app/src/features/path/hooks/useTodayPath.test.tsx`

The adapter mirrors the `usePathQueue` interface so consumers change only their import (and `add`'s argument). Reads come from `useActivePath(today)`; writes go through `usePathMutations`. Stops are mapped to a queue-compatible shape keyed by `merchantId` (= `prospectId`).

- [ ] **Step 1: Write the failing test**

`apps/app/src/features/path/hooks/useTodayPath.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTodayPath, todayISO } from "./useTodayPath";
import type { StopSnapshot } from "./usePathMutations";

// Control the active-path read + the mutations.
const activeState = { current: { data: { path: null, stops: [] } as unknown, isLoading: false } };
vi.mock("./useActivePath", () => ({
  useActivePath: (date: string) => { lastDate.current = date; return activeState.current; },
  ACTIVE_PATH_QUERY_KEY: ["paths", "active"],
}));
const lastDate = { current: "" };

const createPath = vi.fn(async () => "p1");
const addStops = vi.fn(async () => {});
const removeStop = vi.fn(async () => {});
const setStopStatus = vi.fn(async () => {});
const setStopDisposition = vi.fn(async () => {});
const markDealCreatedM = vi.fn(async () => {});
const deletePath = vi.fn(async () => {});
vi.mock("./usePathMutations", () => ({
  usePathMutations: () => ({
    createPath: { mutateAsync: createPath },
    addStops: { mutateAsync: addStops },
    removeStop: { mutateAsync: removeStop },
    setStopStatus: { mutateAsync: setStopStatus },
    setStopDisposition: { mutateAsync: setStopDisposition },
    markDealCreated: { mutateAsync: markDealCreatedM },
    deletePath: { mutateAsync: deletePath },
  }),
}));

const SNAP: StopSnapshot = { prospectId: "m1", name: "A", address: null, lat: 1, lng: 2, category: "manufacturing", primaryType: null };

beforeEach(() => {
  [createPath, addStops, removeStop, setStopStatus, setStopDisposition, markDealCreatedM, deletePath].forEach((m) => m.mockClear());
  activeState.current = { data: { path: null, stops: [] }, isLoading: false };
});

describe("useTodayPath", () => {
  it("queries the active path for today's date", () => {
    renderHook(() => useTodayPath());
    expect(lastDate.current).toBe(todayISO());
  });

  it("exposes stops in queue shape (merchantId = prospectId)", () => {
    activeState.current = { data: { path: { id: "p1" }, stops: [
      { id: "s1", prospectId: "m1", status: "visited", disposition: "met_dm", dealCreated: true, addedAt: "t1", position: 0 },
    ] }, isLoading: false };
    const { result } = renderHook(() => useTodayPath());
    expect(result.current.stops).toEqual([
      { merchantId: "m1", status: "visited", disposition: "met_dm", dealCreated: true, addedAt: "t1" },
    ]);
    expect(result.current.has("m1")).toBe(true);
    expect(result.current.has("nope")).toBe(false);
    expect(result.current.isComplete()).toBe(true);
  });

  it("add: creates today's path then appends the snapshot at the end", async () => {
    activeState.current = { data: { path: { id: "p1" }, stops: [
      { id: "s1", prospectId: "x", status: "pending", disposition: null, dealCreated: false, addedAt: "t1", position: 0 },
    ] }, isLoading: false };
    const { result } = renderHook(() => useTodayPath());
    await act(async () => { await result.current.add(SNAP); });
    expect(createPath).toHaveBeenCalledWith({ date: todayISO(), originLabel: null, originLat: null, originLng: null });
    expect(addStops).toHaveBeenCalledWith({ pathId: "p1", basePosition: 1, stops: [SNAP] });
  });

  it("remove / setStatus / logVisit / markDealCreated resolve merchantId → stop id", async () => {
    activeState.current = { data: { path: { id: "p1" }, stops: [
      { id: "s1", prospectId: "m1", status: "pending", disposition: null, dealCreated: false, addedAt: "t1", position: 0 },
    ] }, isLoading: false };
    const { result } = renderHook(() => useTodayPath());
    await act(async () => { await result.current.remove("m1"); });
    expect(removeStop).toHaveBeenCalledWith("s1");
    await act(async () => { await result.current.setStatus("m1", "skipped"); });
    expect(setStopStatus).toHaveBeenCalledWith({ stopId: "s1", status: "skipped" });
    await act(async () => { await result.current.logVisit("m1", "met_dm"); });
    expect(setStopDisposition).toHaveBeenCalledWith({ stopId: "s1", disposition: "met_dm" });
    expect(setStopStatus).toHaveBeenCalledWith({ stopId: "s1", status: "visited" });
    await act(async () => { await result.current.markDealCreated("m1"); });
    expect(markDealCreatedM).toHaveBeenCalledWith("s1");
  });

  it("clear deletes today's path when one exists", async () => {
    activeState.current = { data: { path: { id: "p1" }, stops: [] }, isLoading: false };
    const { result } = renderHook(() => useTodayPath());
    await act(async () => { await result.current.clear(); });
    expect(deletePath).toHaveBeenCalledWith("p1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/hooks/useTodayPath.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the adapter**

`apps/app/src/features/path/hooks/useTodayPath.ts`:
```ts
/**
 * useTodayPath — server-backed "today's path" with a usePathQueue-shaped surface.
 *
 * Drop-in for the old local queue: stops are keyed by `merchantId` (= the
 * prospect id), and the ops mirror the queue's. Reads come from
 * useActivePath(today); writes go through usePathMutations and refresh via query
 * invalidation. `add` takes a full snapshot (the caller has the merchant) and
 * lazily creates today's path. Writes are fire-and-forget from the UI's view
 * (they return promises for tests/sequencing but callers needn't await).
 */
import * as React from "react";
import type { Disposition } from "@/lib/followUpScheduling";
import { useActivePath } from "./useActivePath";
import { usePathMutations, type StopSnapshot } from "./usePathMutations";
import type { StopStatus } from "../lib/pathTypes";

/** Today's local date as yyyy-mm-dd (path_date is a calendar day, local to the rep). */
export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Queue-compatible stop shape the existing components read. */
export interface TodayStop {
  merchantId: string;
  status: StopStatus;
  disposition: string | null;
  dealCreated: boolean;
  addedAt: string;
}

export function useTodayPath() {
  const date = todayISO();
  const { data } = useActivePath(date);
  const m = usePathMutations();

  const path = data?.path ?? null;
  const rawStops = data?.stops ?? [];

  const stops: TodayStop[] = React.useMemo(
    () => rawStops.map((s) => ({
      merchantId: s.prospectId, status: s.status, disposition: s.disposition,
      dealCreated: s.dealCreated, addedAt: s.addedAt,
    })),
    [rawStops],
  );

  const stopIdFor = (merchantId: string): string | undefined =>
    rawStops.find((s) => s.prospectId === merchantId)?.id;

  const ensurePathId = async (): Promise<string> =>
    path?.id ?? (await m.createPath.mutateAsync({ date, originLabel: null, originLat: null, originLng: null }));

  const add = async (snapshot: StopSnapshot): Promise<void> => {
    const pathId = await ensurePathId();
    await m.addStops.mutateAsync({ pathId, basePosition: rawStops.length, stops: [snapshot] });
  };
  const remove = async (merchantId: string): Promise<void> => {
    const id = stopIdFor(merchantId);
    if (id) await m.removeStop.mutateAsync(id);
  };
  const setStatus = async (merchantId: string, status: StopStatus): Promise<void> => {
    const id = stopIdFor(merchantId);
    if (id) await m.setStopStatus.mutateAsync({ stopId: id, status });
  };
  const logVisit = async (merchantId: string, disposition: Disposition): Promise<void> => {
    const id = stopIdFor(merchantId);
    if (!id) return;
    await m.setStopDisposition.mutateAsync({ stopId: id, disposition });
    await m.setStopStatus.mutateAsync({ stopId: id, status: "visited" });
  };
  const markDealCreated = async (merchantId: string): Promise<void> => {
    const id = stopIdFor(merchantId);
    if (id) await m.markDealCreated.mutateAsync(id);
  };
  const clear = async (): Promise<void> => {
    if (path?.id) await m.deletePath.mutateAsync(path.id);
  };

  const has = (merchantId: string): boolean => rawStops.some((s) => s.prospectId === merchantId);
  const isComplete = (): boolean => rawStops.length > 0 && rawStops.every((s) => s.status !== "pending");
  const pendingCount = (): number => rawStops.filter((s) => s.status === "pending").length;

  return { pathId: path?.id ?? null, stops, add, remove, setStatus, logVisit, markDealCreated, clear, has, isComplete, pendingCount };
}
```
NOTE: confirm `Disposition` is importable from `@/lib/followUpScheduling` (it's what `usePathQueue.logVisit` used) and that `StopSnapshot` is exported from `usePathMutations` (it is, per 1a). If `tsc` flags the `setStopDisposition` signature (it takes `{ stopId, disposition }` where disposition is `string`), pass `disposition` through as-is (Disposition is a string union).

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test src/features/path/hooks/useTodayPath.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `cd apps/app && pnpm typecheck 2>&1 | grep useTodayPath`
Expected: NO output.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/path/hooks/useTodayPath.ts apps/app/src/features/path/hooks/useTodayPath.test.tsx
git commit -m "feat(path): useTodayPath server-backed queue adapter"
```

---

## Task 4: Rewire MerchantDetailSheet

**Files:**
- Modify: `apps/app/src/features/path/components/MerchantDetailSheet.tsx`

- [ ] **Step 1: Swap the hook**

Find:
```tsx
import { usePathQueue } from "../hooks/usePathQueue";
```
Replace with:
```tsx
import { useTodayPath } from "../hooks/useTodayPath";
```
Find:
```tsx
  const inQueue = usePathQueue((s) => (merchant ? s.has(merchant.id) : false));
  const addToQueue = usePathQueue((s) => s.add);
  const removeFromQueue = usePathQueue((s) => s.remove);
```
Replace with:
```tsx
  const todayPath = useTodayPath();
  const inQueue = merchant ? todayPath.has(merchant.id) : false;
```

- [ ] **Step 2: Update the add/remove call sites**

Find where `addToQueue` and `removeFromQueue` are called (the add/remove button handler — `grep -n "addToQueue\|removeFromQueue" MerchantDetailSheet.tsx`). The add must now pass a snapshot built from `merchant`. Replace the handler body so it calls:
```tsx
// remove:
todayPath.remove(merchant.id);
// add (build the snapshot from the merchant in scope):
todayPath.add({
  prospectId: merchant.id,
  name: merchant.name,
  address: merchant.address ?? null,
  lat: merchant.lat,
  lng: merchant.lng,
  category: merchant.category,
  primaryType: merchant.primaryType ?? null,
});
```
(Keep the existing toggle logic — if `inQueue` call remove, else add. The calls are fire-and-forget; do not `await` in the click handler.)

- [ ] **Step 3: Typecheck + commit**

Run: `cd apps/app && pnpm typecheck 2>&1 | grep MerchantDetailSheet` → no output.
```bash
git add apps/app/src/features/path/components/MerchantDetailSheet.tsx
git commit -m "feat(path): MerchantDetailSheet add/remove via useTodayPath"
```

---

## Task 5: Rewire DropInSheet

**Files:**
- Modify: `apps/app/src/features/path/components/DropInSheet.tsx`

- [ ] **Step 1: Swap the hook**

Find:
```tsx
import { usePathQueue } from "../hooks/usePathQueue";
```
Replace with:
```tsx
import { useTodayPath } from "../hooks/useTodayPath";
```
Find:
```tsx
  const logVisit = usePathQueue((s) => s.logVisit);
  const markDealCreated = usePathQueue((s) => s.markDealCreated);
```
Replace with:
```tsx
  const todayPath = useTodayPath();
  const logVisit = todayPath.logVisit;
  const markDealCreated = todayPath.markDealCreated;
```
The existing calls `logVisit(merchant.id, selected)` and `markDealCreated(merchant.id)` keep working (same signatures). They are now async — the surrounding `handleSave` is already `async`; change the bare `logVisit(merchant.id, selected)` line to `await logVisit(merchant.id, selected);` so the disposition write lands before the deal-create branch, and `markDealCreated(merchant.id)` to `await markDealCreated(merchant.id);`.

- [ ] **Step 2: Typecheck + commit**

Run: `cd apps/app && pnpm typecheck 2>&1 | grep DropInSheet` → no output.
```bash
git add apps/app/src/features/path/components/DropInSheet.tsx
git commit -m "feat(path): DropInSheet disposition/deal via useTodayPath"
```

---

## Task 6: Rewire PathPlanSheet

**Files:**
- Modify: `apps/app/src/features/path/components/PathPlanSheet.tsx`

- [ ] **Step 1: Swap the hook**

Find:
```tsx
import { usePathQueue, type StopStatus } from "../hooks/usePathQueue";
```
Replace with:
```tsx
import { useTodayPath } from "../hooks/useTodayPath";
import type { StopStatus } from "../lib/pathTypes";
```
Find:
```tsx
  const stops = usePathQueue((s) => s.stops);
  const setStatus = usePathQueue((s) => s.setStatus);
  const remove = usePathQueue((s) => s.remove);
  const clear = usePathQueue((s) => s.clear);
  const isComplete = usePathQueue((s) => s.isComplete());
```
Replace with:
```tsx
  const todayPath = useTodayPath();
  const stops = todayPath.stops;
  const setStatus = todayPath.setStatus;
  const remove = todayPath.remove;
  const clear = todayPath.clear;
  const isComplete = todayPath.isComplete();
```
The component reads `stops.find((s) => s.merchantId === id)`, `s.status`, `s.dealCreated` — all present on `TodayStop`, so no further changes. The `setStatus`/`remove`/`clear` calls are fire-and-forget (don't `await` in handlers).

- [ ] **Step 2: Typecheck + commit**

Run: `cd apps/app && pnpm typecheck 2>&1 | grep PathPlanSheet` → no output.
```bash
git add apps/app/src/features/path/components/PathPlanSheet.tsx
git commit -m "feat(path): PathPlanSheet via useTodayPath"
```

---

## Task 7: Rewire PathPage + run the one-time migration

**Files:**
- Modify: `apps/app/src/features/path/pages/PathPage.tsx`

- [ ] **Step 1: Swap the queue hook**

Find:
```tsx
import { usePathQueue } from "../hooks/usePathQueue";
```
Replace with:
```tsx
import { usePathQueue } from "../hooks/usePathQueue";
import { useTodayPath } from "../hooks/useTodayPath";
import { planQueueMigration } from "../lib/migrateLocalQueue";
```
(Keep the `usePathQueue` import — it's the migration source now.)

Find:
```tsx
  const queueStops = usePathQueue((s) => s.stops);
  const addStop = usePathQueue((s) => s.add);
  const clearQueue = usePathQueue((s) => s.clear);
```
Replace with:
```tsx
  const todayPath = useTodayPath();
  const queueStops = todayPath.stops;
```

- [ ] **Step 2: Update the wizard hand-off**

Find `handleStartPath` (the `onStart` for CreatePathWizard) — currently `clearQueue()` then `addStop(id)` per id. Replace its body so it builds snapshots from `liveMerchants` and writes them to today's path:
```tsx
  const handleStartPath = React.useCallback(
    async (orderedIds: string[]) => {
      const byId = new Map(liveMerchants.map((m) => [m.id, m]));
      const snapshots = orderedIds
        .map((id) => byId.get(id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .map((m) => ({
          prospectId: m.id, name: m.name, address: m.address ?? null,
          lat: m.lat, lng: m.lng, category: m.category, primaryType: m.primaryType ?? null,
        }));
      await todayPath.clear();
      for (const snap of snapshots) await todayPath.add(snap);
      setCreateOpen(false);
      setPlanOpen(true);
    },
    [liveMerchants, todayPath],
  );
```
(If the existing `handleStartPath` referenced `clearQueue`/`addStop`, those are now gone — this replaces them.)

- [ ] **Step 3: One-time local-queue migration**

Add a migration effect after `liveMerchants` is available (near the other hooks in `PathPage`):
```tsx
  // One-time migration: an existing local queue → today's server path. Runs once
  // per device when merchants are loaded (snapshots need their display fields).
  const migratedRef = React.useRef(false);
  React.useEffect(() => {
    if (migratedRef.current) return;
    const local = usePathQueue.getState().stops;
    if (local.length === 0 || liveMerchants.length === 0) return;
    migratedRef.current = true;
    const byId = new Map(liveMerchants.map((m) => [m.id, m]));
    const { snapshots } = planQueueMigration(local, byId);
    void (async () => {
      for (const snap of snapshots) await todayPath.add(snap);
      usePathQueue.getState().clear(); // retire the local queue once copied
    })();
  }, [liveMerchants, todayPath]);
```

- [ ] **Step 4: Typecheck + full gate**

Run: `cd apps/app && pnpm typecheck`
Expected: ZERO errors. (If any `clearQueue`/`addStop` references remain, replace them per Steps 1-2.)
Run: `cd apps/app && pnpm test`
Expected: all pass. NOTE: the existing `DropInSheet.test.tsx` exercises the real `usePathQueue` store — it will now fail because DropInSheet no longer uses `usePathQueue`. UPDATE that test to mock `../hooks/useTodayPath` instead (a `logVisit`/`markDealCreated` spy object), asserting the same drop-in→deal behavior. Show the updated mock:
```tsx
const logVisit = vi.fn(); const markDealCreated = vi.fn();
vi.mock("../hooks/useTodayPath", () => ({ useTodayPath: () => ({ logVisit, markDealCreated }) }));
```
Adjust the test's assertions that previously read `usePathQueue.getState().stops` to instead assert `logVisit`/`markDealCreated` were called with the merchant id (+ disposition). Keep the deal-creation assertions (those hit `useCreateDeal`/`useLogActivity`, unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/path/pages/PathPage.tsx apps/app/src/features/path/components/DropInSheet.test.tsx
git commit -m "feat(path): PathPage on useTodayPath + one-time queue migration"
```

---

## Task 8: Ship

- [ ] **Step 1: Final gate** — `cd apps/app && pnpm typecheck && pnpm test` (clean).
- [ ] **Step 2: Manual smoke (logged in, deployed or local):** add a business to today's path from the detail sheet → reload the page → it's still there (server-backed). Open the plan sheet → mark visited/skipped → reload → status persists. Log a drop-in with an engaged disposition → a Pipeline deal is created and the stop shows deal-created. Clear the path → empty.
- [ ] **Step 3: Finish the branch** — controller uses superpowers:finishing-a-development-branch (merge to main + push; no DB/Edge deploy — tables already exist).

---

## Self-Review

**Spec coverage (1b-i scope):**
- Server-backed today's path replacing the local queue → Tasks 3–7 (adapter + 4 rewires). ✅
- One-time local-queue migration → Task 2 (planner) + Task 7 Step 3 (effect). ✅
- `clear` needs a server delete → Task 1 (`deletePath`). ✅
- Drop-in → Pipeline still works on server stops → Task 5 + Task 7 Step 4 (DropInSheet test update). ✅
- Path-first IA (entry cards, list-first home, discovery-as-add-stops) → **Phase 1b-ii** (out of scope here, by design). ✅

**Placeholder scan:** No TBD/TODO. Every step shows code or an exact command. The two NOTEs (verify `Merchant` field names; `Disposition` import) are concrete verification instructions with a stated fallback, not placeholders.

**Type consistency:** `StopSnapshot` (from 1a `usePathMutations`) is the add/migration currency throughout. `TodayStop` (Task 3) carries `merchantId`/`status`/`disposition`/`dealCreated`/`addedAt` — exactly the fields PathPlanSheet/PathPage read. `StopStatus` imported from `pathTypes` in PathPlanSheet (was from `usePathQueue`). `deletePath` added in Task 1 is consumed by `useTodayPath.clear` in Task 3. The adapter ops' signatures (`add(snapshot)`, `remove(merchantId)`, `setStatus(merchantId,status)`, `logVisit(merchantId,disposition)`, `markDealCreated(merchantId)`, `clear()`) match how Tasks 4–7 call them.

**Known 1b-i limitation (documented, deferred to 1b-ii):** writes refresh via query invalidation, not optimistic updates — a brief round-trip delay before the UI reflects an add/status change. Acceptable for the swap; optimistic updates are a 1b-ii polish. Also: ad-hoc `add` creates today's path with a null origin (the live origin prop still drives route math); Create-path sets stops but not the path origin in 1b-i.
