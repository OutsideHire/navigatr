# Unfinished Path Carryover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** When a rep opens the Path page with unfinished work from a previous day, detect the most-recent unfinished path and let them **Continue today** or **Close it out** — never silently losing planned-but-unvisited stops.

**Architecture:** A lazy detection query (`usePreviousUnfinishedPath`) finds the most-recent past path with pending stops. A `ResumePathCard` leads the entry screen. `continuePreviousPath` reparents pending stops onto a fresh today path; `closePreviousPath` finalizes the old path. Both finalize older gap-day paths. The unused `paths.status` column becomes meaningful (`planned` → `completed`). No schema change, no backend cron.

**Tech Stack:** React + TypeScript, TanStack Query v5, supabase-js (PostgREST under RLS), Vitest + Testing Library, navigatr Tailwind tokens.

---

## Conventions

- **Worktree/branch:** `feat/path-carryover` off `main`. Do NOT work on `main` directly.
- **Tests:** from repo root `pnpm --filter app test <relative-path-from-apps/app>`, or `cd apps/app && pnpm test <path>`. Note: cwd persists between Bash calls.
- **Gate:** `cd apps/app && pnpm typecheck && pnpm test`. "kaboom from Bomb" on stderr is an expected fixture, not a failure.
- **Commit trailer:** blank line then `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Run git from the repo root in one Bash call.
- **No migration:** `paths.status` (`'planned'|'completed'`) and `path_stops.status` (`'pending'|'visited'|'skipped'`) already exist. Do not add a migration.
- **Spec:** `docs/superpowers/specs/2026-06-08-unfinished-path-carryover-design.md` (gitignored; on disk).

## Verified building blocks (from current `main`)

- `supabase` from `@/lib/supabase`; `useAuth((s) => s.user?.id)` from `@/stores/auth`.
- `useActivePath.ts`: `ACTIVE_PATH_QUERY_KEY = ["paths","active"]`; query `.from("paths").select(...).eq("path_date", date).maybeSingle()`.
- `usePathMutations.ts`: has `invalidate()` → invalidates `[...PATHS_QUERY_KEY, userId]` and `[...ACTIVE_PATH_QUERY_KEY, userId]`; `PATHS_QUERY_KEY` from `./usePaths`. Mutations follow `useMutation({ mutationFn, onSuccess: invalidate })`. `createPath` upserts on `(user_id,path_date)`.
- `useTodayPath.ts`: defines+exports `todayISO()`; consumed by `useTodayPath.test.tsx` via `import { todayISO }`.
- `PathPage.tsx`: `pathView` state machine; stops-sync effect on `[queueStops.length]`; entry branch `) : pathView === "entry" ? (\n  <PathEntry onCreate={() => setCreateOpen(true)} onPlan={enterDiscover} /> `; `todayPath = useTodayPath()`, `queueStops = todayPath.stops`; `enterDiscover`; `setCreateOpen`.
- `PathEntry.tsx`: props `{ onCreate, onPlan }`; uses `Card` from `@/components/navigatr`.
- Test style: `vi.mock("@/lib/supabase", ...)` with chained mocks; `vi.mock("@/stores/auth", ...)`; `QueryClientProvider` wrapper with `retry:false`; `renderHook`+`waitFor` for queries, `+act` for mutations.
- No shared date formatter; `Date.toLocaleDateString("en-US", {...})` used inline elsewhere.

## File structure

- **Create** `apps/app/src/features/path/lib/today.ts` — `todayISO()` (moved here) + `formatPathDate()`. Leaf module (no hook imports) to avoid an import cycle.
- **Modify** `apps/app/src/features/path/hooks/useTodayPath.ts` — re-export `todayISO` from `lib/today` (back-compat).
- **Create** `apps/app/src/features/path/hooks/usePreviousUnfinishedPath.ts` — detection query + `PREVIOUS_UNFINISHED_QUERY_KEY`.
- **Modify** `apps/app/src/features/path/hooks/usePathMutations.ts` — add `continuePreviousPath`, `closePreviousPath`; invalidate the new key.
- **Create** `apps/app/src/features/path/components/ResumePathCard.tsx` — the mockup-A card.
- **Modify** `apps/app/src/features/path/pages/PathPage.tsx` — render the card in the entry view; wire Continue/Close + implicit-close on Create/Plan.
- Tests next to each.

---

## Task 1: `lib/today.ts` (date utils) + detection hook

**Files:** Create `apps/app/src/features/path/lib/today.ts` (+`.test.ts`); modify `hooks/useTodayPath.ts`; create `hooks/usePreviousUnfinishedPath.ts` (+`.test.tsx`).

- [ ] **Step 1: Write `lib/today.test.ts` (failing)**
```ts
import { describe, it, expect } from "vitest";
import { todayISO, formatPathDate } from "./today";

describe("todayISO", () => {
  it("returns a yyyy-mm-dd string", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatPathDate", () => {
  it("says 'yesterday' when the date is one day before today", () => {
    expect(formatPathDate("2026-06-07", "2026-06-08")).toBe("yesterday");
  });
  it("formats older dates as 'Wkdy, Mon D'", () => {
    // 2026-06-05 is a Friday.
    expect(formatPathDate("2026-06-05", "2026-06-08")).toBe("Fri, Jun 5");
  });
});
```

- [ ] **Step 2: Run → fail** (`pnpm --filter app test src/features/path/lib/today.test.ts`) — module not found.

- [ ] **Step 3: Create `lib/today.ts`**
```ts
/** Local-date helpers for paths. Leaf module (no hook imports) so both
 *  useTodayPath and usePreviousUnfinishedPath can share todayISO without a cycle. */

/** Today's local date as yyyy-mm-dd (path_date is a calendar day, local to the rep). */
export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Human label for a path_date relative to today: "yesterday" or "Fri, Jun 5".
 *  Dates are parsed at local midnight (append T00:00:00) to avoid UTC shifting. */
export function formatPathDate(iso: string, todayIso: string = todayISO()): string {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date(`${todayIso}T00:00:00`);
  const diffDays = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 1) return "yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Point `useTodayPath` at the shared util.** In `hooks/useTodayPath.ts`, replace the local `todayISO` definition:
```ts
/** Today's local date as yyyy-mm-dd (path_date is a calendar day, local to the rep). */
export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
```
with a re-export (keeps existing `import { todayISO } from "./useTodayPath"` working):
```ts
import { todayISO } from "../lib/today";
export { todayISO };
```
Place the `import` with the other imports and the `export { todayISO };` near the top (it can sit right after the imports). Remove the old function body. Verify `pnpm --filter app test src/features/path/hooks/useTodayPath.test.tsx` still passes.

- [ ] **Step 6: Write `hooks/usePreviousUnfinishedPath.test.tsx` (failing)**
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePreviousUnfinishedPath } from "./usePreviousUnfinishedPath";

const orderMock = vi.fn();
const neqMock = vi.fn(() => ({ order: orderMock }));
const ltMock = vi.fn(() => ({ neq: neqMock }));
const selectMock = vi.fn(() => ({ lt: ltMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: selectMock }) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "user-1" } }),
}));
// Pin "today" so date math is deterministic.
vi.mock("../lib/today", () => ({ todayISO: () => "2026-06-08" }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => { orderMock.mockReset(); });

describe("usePreviousUnfinishedPath", () => {
  it("returns the most-recent past path that has pending stops, with the pending count", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        { id: "p7", path_date: "2026-06-07", status: "planned", path_stops: [
          { status: "visited" }, { status: "pending" }, { status: "pending" } ] },
        { id: "p6", path_date: "2026-06-06", status: "planned", path_stops: [
          { status: "pending" } ] },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePreviousUnfinishedPath(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ltMock).toHaveBeenCalledWith("path_date", "2026-06-08");
    expect(neqMock).toHaveBeenCalledWith("status", "completed");
    expect(result.current.data).toEqual({ pathId: "p7", pathDate: "2026-06-07", pendingCount: 2 });
  });

  it("skips the most-recent path if it has no pending stops and falls back to an older one", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        { id: "p7", path_date: "2026-06-07", status: "planned", path_stops: [
          { status: "visited" }, { status: "skipped" } ] },
        { id: "p6", path_date: "2026-06-06", status: "planned", path_stops: [
          { status: "pending" } ] },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePreviousUnfinishedPath(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ pathId: "p6", pathDate: "2026-06-06", pendingCount: 1 });
  });

  it("returns null when no past path has pending stops", async () => {
    orderMock.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => usePreviousUnfinishedPath(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
```

- [ ] **Step 7: Run → fail** — module not found.

- [ ] **Step 8: Create `hooks/usePreviousUnfinishedPath.ts`**
```ts
/**
 * usePreviousUnfinishedPath — detects the rep's most-recent PAST path that still
 * has pending stops, so the Path page can offer to continue or close it. Lazy
 * (runs on render), RLS-scoped to the user. Returns null when nothing qualifies.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { todayISO } from "../lib/today";

export const PREVIOUS_UNFINISHED_QUERY_KEY = ["paths", "previous-unfinished"] as const;

export interface PreviousUnfinishedPath {
  pathId: string;
  pathDate: string;
  pendingCount: number;
}

interface Row {
  id: string;
  path_date: string;
  status: string;
  path_stops: { status: string }[];
}

export function usePreviousUnfinishedPath() {
  const userId = useAuth((s) => s.user?.id);
  const today = todayISO();
  return useQuery({
    queryKey: [...PREVIOUS_UNFINISHED_QUERY_KEY, userId, today],
    enabled: !!userId,
    queryFn: async (): Promise<PreviousUnfinishedPath | null> => {
      const { data, error } = await supabase
        .from("paths")
        .select("id, path_date, status, path_stops(status)")
        .lt("path_date", today)
        .neq("status", "completed")
        .order("path_date", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as Row[];
      // Rows are newest-first; pick the first that has a pending stop.
      const hit = rows.find((r) => (r.path_stops ?? []).some((s) => s.status === "pending"));
      if (!hit) return null;
      const pendingCount = hit.path_stops.filter((s) => s.status === "pending").length;
      return { pathId: hit.id, pathDate: hit.path_date, pendingCount };
    },
  });
}
```

- [ ] **Step 9: Run both new test files → pass.** Then `cd apps/app && pnpm typecheck`.

- [ ] **Step 10: Commit**
```bash
git add apps/app/src/features/path/lib/today.ts apps/app/src/features/path/lib/today.test.ts apps/app/src/features/path/hooks/useTodayPath.ts apps/app/src/features/path/hooks/usePreviousUnfinishedPath.ts apps/app/src/features/path/hooks/usePreviousUnfinishedPath.test.tsx
git commit -m "$(printf 'feat(path): detect the most-recent unfinished past path\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Carryover mutations (`continuePreviousPath`, `closePreviousPath`)

**Files:** Modify `hooks/usePathMutations.ts` (+ its test `usePathMutations.test.tsx` — create if absent).

- [ ] **Step 1: Write the failing test** `hooks/usePathMutations.test.tsx` (add a describe; if the file doesn't exist, create it with this scaffold). The mutations chain several supabase calls, so the mock dispatches by table + the operation requested. Use a flexible mock:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePathMutations } from "./usePathMutations";

// Record calls; each terminal method resolves { data, error }.
const calls: { table: string; op: string; payload?: unknown; filters: [string, unknown][] }[] = [];
function makeBuilder(table: string) {
  const rec = { table, op: "", payload: undefined as unknown, filters: [] as [string, unknown][] };
  const thenable = {
    select: (_c?: string) => ({
      ...thenable,
      eq: (c: string, v: unknown) => { rec.filters.push([c, v]); return chainSingle(); },
      single: () => resolveSingle(),
    }),
    eq: (c: string, v: unknown) => { rec.filters.push([c, v]); return thenable; },
    in: (c: string, v: unknown) => { rec.filters.push([c, v]); return thenable; },
    order: (_c: string, _o?: unknown) => Promise.resolve(orderResult(rec)),
    then: (res: (r: { data: unknown; error: null }) => void) => { calls.push(rec); res({ data: null, error: null }); },
  };
  function chainSingle() { return { single: () => resolveSingle(), then: thenable.then }; }
  function resolveSingle() { calls.push({ ...rec, op: "single" }); return Promise.resolve({ data: { id: "today-1" }, error: null }); }
  function orderResult(r: typeof rec) { calls.push({ ...r, op: "order" }); return pendingForTable(r.table); }
  // upsert/update/delete record the op + payload, return the chain for filters
  return {
    upsert: (p: unknown, _o?: unknown) => { rec.op = "upsert"; rec.payload = p; return { select: thenable.select }; },
    update: (p: unknown) => { rec.op = "update"; rec.payload = p; return thenable; },
    delete: () => { rec.op = "delete"; return thenable; },
    select: thenable.select,
  };
}
// Pending-stop fetch (for reparent) + older-path fetch (for finalize) both go via .order/.eq chains;
// return canned data keyed by what the code asks for.
let pendingStops: { id: string }[] = [];
let olderPaths: { id: string }[] = [];
function pendingForTable(table: string) {
  // path_stops .eq(status,pending).order(position) → pending stops; paths .lt.neq → older paths
  return Promise.resolve({ data: table === "path_stops" ? pendingStops : olderPaths, error: null });
}
vi.mock("@/lib/supabase", () => ({ supabase: { from: (t: string) => makeBuilder(t) } }));
vi.mock("@/stores/auth", () => ({ useAuth: (s: (x: { user: { id: string } }) => unknown) => s({ user: { id: "user-1" } }) }));
vi.mock("../lib/today", () => ({ todayISO: () => "2026-06-08" }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => { calls.length = 0; pendingStops = []; olderPaths = []; });

describe("continuePreviousPath", () => {
  it("upserts today's path, reparents pending stops onto it, and marks the old path completed", async () => {
    pendingStops = [{ id: "ps1" }, { id: "ps2" }];
    const { result } = renderHook(() => usePathMutations(), { wrapper });
    await act(async () => {
      await result.current.continuePreviousPath.mutateAsync({ prevPathId: "p7", prevPathDate: "2026-06-07" });
    });
    // today path upserted
    expect(calls.some((c) => c.table === "paths" && c.op === "upsert")).toBe(true);
    // both pending stops reparented to today-1
    const reparents = calls.filter((c) => c.table === "path_stops" && c.op === "update"
      && (c.payload as { path_id?: string }).path_id === "today-1");
    expect(reparents).toHaveLength(2);
    // old path marked completed
    expect(calls.some((c) => c.table === "paths" && c.op === "update"
      && (c.payload as { status?: string }).status === "completed"
      && c.filters.some(([col, v]) => col === "id" && v === "p7"))).toBe(true);
  });
});

describe("closePreviousPath", () => {
  it("skips the old path's pending stops and marks it completed", async () => {
    const { result } = renderHook(() => usePathMutations(), { wrapper });
    await act(async () => {
      await result.current.closePreviousPath.mutateAsync({ prevPathId: "p7", prevPathDate: "2026-06-07" });
    });
    expect(calls.some((c) => c.table === "path_stops" && c.op === "update"
      && (c.payload as { status?: string }).status === "skipped")).toBe(true);
    expect(calls.some((c) => c.table === "paths" && c.op === "update"
      && (c.payload as { status?: string }).status === "completed")).toBe(true);
  });
});
```
> Note: the mock above is intentionally permissive — assert on the recorded `calls` (table/op/payload/filters), not on exact builder chaining. If the scaffold proves brittle, simplify to spies that record `{table, op, payload}` and resolve `{data, error:null}`; the assertions on `calls` are what matter.

- [ ] **Step 2: Run → fail** — `continuePreviousPath`/`closePreviousPath` undefined.

- [ ] **Step 3: Implement the mutations.** In `usePathMutations.ts`:
  - Add imports at top:
    ```ts
    import { todayISO } from "../lib/today";
    import { PREVIOUS_UNFINISHED_QUERY_KEY } from "./usePreviousUnfinishedPath";
    ```
  - Extend `invalidate()` to also refresh the detection query:
    ```ts
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: [...PATHS_QUERY_KEY, userId] });
      qc.invalidateQueries({ queryKey: [...ACTIVE_PATH_QUERY_KEY, userId] });
      qc.invalidateQueries({ queryKey: [...PREVIOUS_UNFINISHED_QUERY_KEY, userId] });
    };
    ```
  - Add a shared helper + the two mutations (place above the `return {...}`):
    ```ts
    // Mark every still-unfinished path older than `beforeDate` as completed and
    // skip its leftover pending stops. RLS scopes all of this to the current user.
    const finalizeOlderThan = async (beforeDate: string): Promise<void> => {
      const { data, error } = await supabase
        .from("paths").select("id").lt("path_date", beforeDate).neq("status", "completed");
      if (error) throw error;
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      if (ids.length === 0) return;
      const { error: e1 } = await supabase
        .from("path_stops").update({ status: "skipped" }).in("path_id", ids).eq("status", "pending");
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("paths").update({ status: "completed" }).in("id", ids);
      if (e2) throw e2;
    };

    // Finalize a single path: skip its pending stops, mark it completed.
    const finalizeSingle = async (pathId: string): Promise<void> => {
      const { error: e1 } = await supabase
        .from("path_stops").update({ status: "skipped" }).eq("path_id", pathId).eq("status", "pending");
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("paths").update({ status: "completed" }).eq("id", pathId);
      if (e2) throw e2;
    };

    const continuePreviousPath = useMutation({
      mutationFn: async (input: { prevPathId: string; prevPathDate: string }): Promise<void> => {
        if (!userId) throw new Error("Not signed in");
        // 1. Ensure today's path exists.
        const { data: todayRow, error: e0 } = await supabase
          .from("paths")
          .upsert(
            { user_id: userId, path_date: todayISO(), origin_label: null, origin_lat: null, origin_lng: null },
            { onConflict: "user_id,path_date" },
          )
          .select("id").single();
        if (e0) throw e0;
        const todayId = (todayRow as unknown as { id: string }).id;
        // 2. Reparent the old path's pending stops onto today, re-sequenced.
        const { data: pend, error: e1 } = await supabase
          .from("path_stops").select("id")
          .eq("path_id", input.prevPathId).eq("status", "pending")
          .order("position", { ascending: true });
        if (e1) throw e1;
        const pendingIds = ((pend ?? []) as { id: string }[]).map((r) => r.id);
        for (let i = 0; i < pendingIds.length; i++) {
          const { error } = await supabase
            .from("path_stops").update({ path_id: todayId, position: i }).eq("id", pendingIds[i]);
          if (error) throw error;
        }
        // 3. Mark the old path completed; finalize anything older.
        const { error: e2 } = await supabase.from("paths").update({ status: "completed" }).eq("id", input.prevPathId);
        if (e2) throw e2;
        await finalizeOlderThan(input.prevPathDate);
      },
      onSuccess: invalidate,
    });

    const closePreviousPath = useMutation({
      mutationFn: async (input: { prevPathId: string; prevPathDate: string }): Promise<void> => {
        await finalizeSingle(input.prevPathId);
        await finalizeOlderThan(input.prevPathDate);
      },
      onSuccess: invalidate,
    });
    ```
  - Add to the returned object:
    ```ts
    return { createPath, addStops, removeStop, reorderStops, setStopStatus, setStopDisposition, markDealCreated, deletePath, continuePreviousPath, closePreviousPath };
    ```

- [ ] **Step 4: Run the test → pass.** Then `cd apps/app && pnpm typecheck`.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/path/hooks/usePathMutations.ts apps/app/src/features/path/hooks/usePathMutations.test.tsx
git commit -m "$(printf 'feat(path): continue/close carryover mutations (reparent + finalize)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: `ResumePathCard` component

**Files:** Create `components/ResumePathCard.tsx` (+`.test.tsx`).

- [ ] **Step 1: Write the failing test** `components/ResumePathCard.test.tsx`
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResumePathCard } from "./ResumePathCard";

describe("ResumePathCard", () => {
  it("shows the pending count and a human date, and fires the handlers", () => {
    const onContinue = vi.fn();
    const onClose = vi.fn();
    render(
      <ResumePathCard pathDate="2026-06-07" pendingCount={6} todayIso="2026-06-08"
        onContinue={onContinue} onClose={onClose} />,
    );
    expect(screen.getByText(/6 stops left/i)).toBeInTheDocument();
    expect(screen.getByText(/yesterday/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue today/i }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /close it out/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("singularizes one stop", () => {
    render(
      <ResumePathCard pathDate="2026-06-05" pendingCount={1} todayIso="2026-06-08"
        onContinue={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText(/1 stop left/i)).toBeInTheDocument();
    expect(screen.getByText(/Fri, Jun 5/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → fail** — module not found.

- [ ] **Step 3: Create `components/ResumePathCard.tsx`**
```tsx
import { RotateCcw } from "lucide-react";
import { Button, Card } from "@/components/navigatr";
import { formatPathDate } from "../lib/today";

interface ResumePathCardProps {
  /** path_date (yyyy-mm-dd) of the unfinished path. */
  pathDate: string;
  /** Number of still-pending stops on it. */
  pendingCount: number;
  /** Continue the path into today. */
  onContinue: () => void;
  /** Close it out (finalize, don't carry). */
  onClose: () => void;
  /** Override "today" for deterministic tests. */
  todayIso?: string;
}

/**
 * ResumePathCard — leads the Path entry screen when the rep has an unfinished
 * path from a previous day. Brand-coded so it reads as the primary action (the
 * usual reason a rep opens the page in the morning is to keep going). Two explicit
 * choices, no ambiguous "dismiss".
 */
export function ResumePathCard({ pathDate, pendingCount, onContinue, onClose, todayIso }: ResumePathCardProps) {
  const when = formatPathDate(pathDate, todayIso);
  const stops = `${pendingCount} stop${pendingCount === 1 ? "" : "s"} left`;
  return (
    <Card
      padding="lg"
      className="mt-6 flex flex-col gap-3 self-stretch border-brand md:mx-auto md:w-full md:max-w-2xl"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-radius-md bg-brand-10 text-brand">
          <RotateCcw className="h-5 w-5" aria-hidden />
        </span>
        <div className="flex flex-col">
          <p className="text-heading-sm text-text-default">Pick up your last path</p>
          <p className="text-body-md text-text-muted">
            {stops} unvisited · {when}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={onContinue}>Continue today</Button>
        <Button variant="secondary" size="sm" onClick={onClose}>Close it out</Button>
      </div>
    </Card>
  );
}
```
> VERIFY against `PathEntry.tsx`: `Card` import path (`@/components/navigatr`), token names (`border-brand`, `bg-brand-10`, `text-brand`, `text-heading-sm`, `text-body-md`, `rounded-radius-md`), and `Button` variants (`primary`/`secondary`). Adjust to match the actual exports if any differ. Confirm `RotateCcw` is a valid lucide icon (it is).

- [ ] **Step 4: Run → pass.** Then typecheck.

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/path/components/ResumePathCard.tsx apps/app/src/features/path/components/ResumePathCard.test.tsx
git commit -m "$(printf 'feat(path): ResumePathCard for the entry screen\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Wire carryover into PathPage

**Files:** Modify `pages/PathPage.tsx` (+ `pages/PathPage.test.tsx`).

- [ ] **Step 1: Add the failing tests** to `pages/PathPage.test.tsx`. First extend the existing mocks:
  - Add a controllable detection mock + the new mutations on the path-mutations mock:
```tsx
// Detection hook — controllable per test.
const prevUnfinishedState = { current: { data: null as null | { pathId: string; pathDate: string; pendingCount: number } } };
vi.mock("../hooks/usePreviousUnfinishedPath", () => ({
  usePreviousUnfinishedPath: () => prevUnfinishedState.current,
}));
// PathPage now calls usePathMutations directly for continue/close.
const continueMutate = vi.fn();
const closeMutate = vi.fn();
vi.mock("../hooks/usePathMutations", () => ({
  usePathMutations: () => ({
    continuePreviousPath: { mutate: vi.fn(), mutateAsync: continueMutate },
    closePreviousPath: { mutate: closeMutate, mutateAsync: vi.fn() },
  }),
}));
```
  - Reset them in `beforeEach`:
```tsx
  prevUnfinishedState.current = { data: null };
  continueMutate.mockReset();
  closeMutate.mockReset();
```
  - Add tests (new describe block):
```tsx
describe("PathPage carryover", () => {
  const ready = { ...base, origin: { lat: 30, lng: -97 }, originSource: "gps", originLabel: "Current location", geoStatus: "ready" } as PathOrigin;

  it("shows the resume card on the entry screen when there's an unfinished past path", () => {
    originState.current = ready;
    todayState.current = { ...todayState.current, stops: [] };
    prevUnfinishedState.current = { data: { pathId: "p7", pathDate: "2026-06-07", pendingCount: 4 } };
    render(<PathPage />, { wrapper });
    expect(screen.getByText(/4 stops left/i)).toBeInTheDocument();
  });

  it("does not show the resume card when there's no unfinished past path", () => {
    originState.current = ready;
    todayState.current = { ...todayState.current, stops: [] };
    prevUnfinishedState.current = { data: null };
    render(<PathPage />, { wrapper });
    expect(screen.queryByText(/left unvisited|stops left/i)).not.toBeInTheDocument();
  });

  it("Continue today calls continuePreviousPath with the path id + date", async () => {
    originState.current = ready;
    todayState.current = { ...todayState.current, stops: [] };
    prevUnfinishedState.current = { data: { pathId: "p7", pathDate: "2026-06-07", pendingCount: 4 } };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /continue today/i }));
    await waitFor(() => expect(continueMutate).toHaveBeenCalledWith({ prevPathId: "p7", prevPathDate: "2026-06-07" }));
  });

  it("starting a fresh Create path implicitly closes the unfinished path", () => {
    originState.current = ready;
    todayState.current = { ...todayState.current, stops: [] };
    prevUnfinishedState.current = { data: { pathId: "p7", pathDate: "2026-06-07", pendingCount: 4 } };
    render(<PathPage />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /create a path/i }));
    expect(closeMutate).toHaveBeenCalledWith({ prevPathId: "p7", prevPathDate: "2026-06-07" });
  });
});
```
  Add `waitFor` to the testing-library import if not present.

- [ ] **Step 2: Run → fail** (card not rendered; mutations not wired).

- [ ] **Step 3: Wire PathPage.** In `pages/PathPage.tsx`:
  - Imports:
```tsx
import { ResumePathCard } from "../components/ResumePathCard";
import { usePreviousUnfinishedPath } from "../hooks/usePreviousUnfinishedPath";
import { usePathMutations } from "../hooks/usePathMutations";
```
  - Near the other hooks (after `const todayPath = useTodayPath();`):
```tsx
  const prevUnfinished = usePreviousUnfinishedPath();
  const { continuePreviousPath, closePreviousPath } = usePathMutations();
```
  - Add handlers (with the other `useCallback`s):
```tsx
  // Continue the unfinished path into today: reparent its pending stops; the
  // stops-sync effect then moves us to the active home once they land.
  const handleContinuePrevious = React.useCallback(async () => {
    const prev = prevUnfinished.data;
    if (!prev) return;
    try {
      await continuePreviousPath.mutateAsync({ prevPathId: prev.pathId, prevPathDate: prev.pathDate });
    } catch {
      toast.error("Couldn't continue the path. Please try again.");
    }
  }, [prevUnfinished.data, continuePreviousPath]);

  // Close the unfinished path out (finalize, don't carry). Fire-and-forget — the
  // detection query refreshes on success and the card disappears.
  const handleClosePrevious = React.useCallback(() => {
    const prev = prevUnfinished.data;
    if (prev) closePreviousPath.mutate({ prevPathId: prev.pathId, prevPathDate: prev.pathDate });
  }, [prevUnfinished.data, closePreviousPath]);

  // Starting fresh (Create / Plan) implicitly closes any unfinished path so the
  // resume card doesn't reappear every empty morning.
  const finalizePrevImplicitly = React.useCallback(() => {
    const prev = prevUnfinished.data;
    if (prev) closePreviousPath.mutate({ prevPathId: prev.pathId, prevPathDate: prev.pathDate });
  }, [prevUnfinished.data, closePreviousPath]);

  const handleCreate = React.useCallback(() => { finalizePrevImplicitly(); setCreateOpen(true); }, [finalizePrevImplicitly]);
  const handlePlan = React.useCallback(() => { finalizePrevImplicitly(); enterDiscover(); }, [finalizePrevImplicitly, enterDiscover]);
```
  - Replace the entry-view branch:
```tsx
      ) : pathView === "entry" ? (
        <PathEntry onCreate={() => setCreateOpen(true)} onPlan={enterDiscover} />
```
    with:
```tsx
      ) : pathView === "entry" ? (
        <>
          {prevUnfinished.data && (
            <ResumePathCard
              pathDate={prevUnfinished.data.pathDate}
              pendingCount={prevUnfinished.data.pendingCount}
              onContinue={handleContinuePrevious}
              onClose={handleClosePrevious}
            />
          )}
          <PathEntry onCreate={handleCreate} onPlan={handlePlan} />
        </>
```

- [ ] **Step 4: Run the PathPage test → pass.** Then `cd apps/app && pnpm typecheck && pnpm test` (full suite).

- [ ] **Step 5: Commit**
```bash
git add apps/app/src/features/path/pages/PathPage.tsx apps/app/src/features/path/pages/PathPage.test.tsx
git commit -m "$(printf 'feat(path): surface unfinished-path carryover on the entry screen\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Ship

- [ ] **Step 1: Final gate** — `cd apps/app && pnpm typecheck && pnpm test` (clean; full suite green).
- [ ] **Step 2: Manual smoke (Vercel after merge+push; hard-refresh for the SW).** Leave a path with pending stops; next calendar day open Path → resume card shows "N stops left · yesterday". **Continue today** → lands on the active home with exactly the pending stops (visited/skipped from yesterday not present). Re-open next day with a fresh leftover → **Close it out** → card gone, normal entry. With a card showing, tapping **Create a path** / **Plan a path** → card doesn't reappear next open (old path finalized). Multi-day gap: only the most-recent unfinished is offered.
- [ ] **Step 3: Finish the branch** (superpowers:finishing-a-development-branch → merge to `main` + push so Vercel deploys).

---

## Self-Review

**Spec coverage:**
- Detect + ask, lazy on open → Task 1 (`usePreviousUnfinishedPath`) + Task 4 (render in entry) ✅
- Resume card (mockup A), explicit Continue / Close, non-modal → Task 3 + Task 4 ✅
- Pending only carries → Task 2 `continuePreviousPath` reparents only `status='pending'` ✅
- Most-recent unfinished; older auto-finalized → Task 1 (find first with pending) + Task 2 `finalizeOlderThan` ✅
- `paths.status` planned→completed → Task 2 (all flows set `completed`) ✅
- Implicit close on Create/Plan → Task 4 `finalizePrevImplicitly` ✅
- Scope guard (no future-day planner) → nothing here touches the wizard's date; ✅
- Error handling toast on continue failure → Task 4 ✅
- No schema change → confirmed (`status` exists) ✅

**Placeholder scan:** No TBD/TODO. Every code step has complete code. The mutations-test mock is flagged as permissive with an explicit fallback instruction (not a placeholder — concrete assertions on `calls`).

**Type consistency:** `PreviousUnfinishedPath { pathId, pathDate, pendingCount }` used identically in the hook, the mutations' input `{ prevPathId, prevPathDate }`, `ResumePathCardProps`, and PathPage handlers. `PREVIOUS_UNFINISHED_QUERY_KEY` defined in `usePreviousUnfinishedPath.ts`, imported by `usePathMutations.ts` (no cycle: detection hook imports only `lib/today` + supabase + auth + react-query). `todayISO` single source in `lib/today.ts`, re-exported from `useTodayPath` for back-compat. `formatPathDate(iso, todayIso?)` signature consistent across `today.ts`, its test, and `ResumePathCard`.
