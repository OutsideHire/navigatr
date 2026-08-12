# Path v3 — Phase 1a: server data foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the server-backed `paths` + `path_stops` data layer (tables, RLS, typed query/mutation hooks) so the Path UI can move off the local `usePathQueue` in Phase 1b.

**Architecture:** Two owner-scoped Supabase tables with RLS keyed on `auth.uid()`. The frontend talks to them directly via `supabase.from(...)` under RLS (no Edge function — these are owner CRUD ops, unlike `discover_prospects`). Data access follows the existing pipeline hooks pattern: TanStack Query, snake_case rows mapped to camelCase types, cache keys tailed with the user id, invalidate-on-mutation.

**Tech Stack:** Supabase Postgres + RLS, supabase-js, TanStack Query, Vitest + Testing Library.

---

## Conventions

- Branch off `main`: `git checkout main && git pull && git checkout -b feat/path-v3-data`.
- Tests: one file → `pnpm --filter app test <path>`; full gate → `cd apps/app && pnpm typecheck && pnpm test`.
- Migration is **hand-applied** to prod with `supabase db query --linked -f <file>` (NOT `db push` — project convention). It also lands as a tracked migration file.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- The intentional "kaboom from Bomb" stderr is expected, not a failure.

## Spec

`docs/superpowers/specs/2026-06-03-path-v3-path-first-redesign-design.md`. This plan implements the **Phase 1a** slice (data model + hooks). The queue migration and all UI are Phase 1b.

## File Structure

- **Create** `supabase/migrations/20260603000001_path_v3_tables.sql` — `paths` + `path_stops` + RLS + indexes.
- **Create** `apps/app/src/features/path/lib/pathTypes.ts` — `Path`/`PathStop` types, row types, row→model mappers.
- **Create** `apps/app/src/features/path/lib/pathTypes.test.ts` — mapper tests.
- **Create** `apps/app/src/features/path/hooks/usePaths.ts` — list the rep's paths.
- **Create** `apps/app/src/features/path/hooks/usePaths.test.tsx`.
- **Create** `apps/app/src/features/path/hooks/useActivePath.ts` — one day's path + ordered stops.
- **Create** `apps/app/src/features/path/hooks/useActivePath.test.tsx`.
- **Create** `apps/app/src/features/path/hooks/usePathMutations.ts` — create/add/remove/reorder/status/disposition/deal mutations.
- **Create** `apps/app/src/features/path/hooks/usePathMutations.test.tsx`.

No existing files change in 1a (`usePathQueue` stays until 1b swaps it).

---

## Task 1: Tables + RLS migration

**Files:**
- Create: `supabase/migrations/20260603000001_path_v3_tables.sql`

No vitest (DB layer). Verified by SQL queries + an RLS rejection check; behavior is covered by the hook tests in later tasks.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260603000001_path_v3_tables.sql`:
```sql
-- 20260603000001_path_v3_tables.sql
--
-- Path v3: server-backed dated paths. One path per (rep, working day); each has
-- ordered stops. Replaces the local-only usePathQueue. Owner-scoped RLS keyed on
-- auth.uid() (no org pivot — a path is personal to the rep). path_stops snapshots
-- the business display fields at add-time so a path renders without re-reading the
-- volatile prospects TTL cache.

create table paths (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  path_date     date not null,
  origin_label  text,
  origin_lat    double precision,
  origin_lng    double precision,
  status        text not null default 'planned' check (status in ('planned', 'completed')),
  created_at    timestamptz not null default now(),
  unique (user_id, path_date)
);

create table path_stops (
  id            uuid primary key default gen_random_uuid(),
  path_id       uuid not null references paths(id) on delete cascade,
  prospect_id   uuid not null references prospects(id),
  name          text not null,
  address       text,
  lat           double precision not null,
  lng           double precision not null,
  category      text not null,
  primary_type  text,
  position      integer not null,
  status        text not null default 'pending' check (status in ('pending', 'visited', 'skipped')),
  disposition   text,
  deal_created  boolean not null default false,
  added_at      timestamptz not null default now(),
  unique (path_id, prospect_id)
);

create index paths_user_date_idx     on paths (user_id, path_date desc);
create index path_stops_path_pos_idx on path_stops (path_id, position);

alter table paths enable row level security;
alter table path_stops enable row level security;

-- paths: a rep sees and edits only their own.
create policy paths_select on paths for select using (user_id = auth.uid());
create policy paths_insert on paths for insert with check (user_id = auth.uid());
create policy paths_update on paths for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy paths_delete on paths for delete using (user_id = auth.uid());

-- path_stops: scoped through the parent path's owner.
create policy path_stops_select on path_stops for select
  using (exists (select 1 from paths p where p.id = path_stops.path_id and p.user_id = auth.uid()));
create policy path_stops_insert on path_stops for insert
  with check (exists (select 1 from paths p where p.id = path_stops.path_id and p.user_id = auth.uid()));
create policy path_stops_update on path_stops for update
  using (exists (select 1 from paths p where p.id = path_stops.path_id and p.user_id = auth.uid()))
  with check (exists (select 1 from paths p where p.id = path_stops.path_id and p.user_id = auth.uid()));
create policy path_stops_delete on path_stops for delete
  using (exists (select 1 from paths p where p.id = path_stops.path_id and p.user_id = auth.uid()));
```

- [ ] **Step 2: Apply to prod (hand-applied, not db push)**

Run: `supabase db query --linked -f supabase/migrations/20260603000001_path_v3_tables.sql`
Expected: success (empty rows envelope, no error).

- [ ] **Step 3: Verify tables + RLS are live**

Run:
```bash
supabase db query --linked --output json "select tablename, rowsecurity from pg_tables where tablename in ('paths','path_stops');"
supabase db query --linked --output json "select count(*) as policies from pg_policies where tablename in ('paths','path_stops');"
```
Expected: both tables present with `rowsecurity = true`; `policies = 8`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260603000001_path_v3_tables.sql
git commit -m "feat(path): paths + path_stops tables with owner RLS"
```

---

## Task 2: Path types + mappers

**Files:**
- Create: `apps/app/src/features/path/lib/pathTypes.ts`
- Test: `apps/app/src/features/path/lib/pathTypes.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/app/src/features/path/lib/pathTypes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { rowToPath, rowToStop, type PathRow, type PathStopRow } from "./pathTypes";

describe("pathTypes mappers", () => {
  it("maps a path row to camelCase with a stop count", () => {
    const row: PathRow = {
      id: "p1", path_date: "2026-06-03", origin_label: "Current location",
      origin_lat: 30.27, origin_lng: -97.74, status: "planned",
    };
    const p = rowToPath(row, 8);
    expect(p).toEqual({
      id: "p1", date: "2026-06-03", originLabel: "Current location",
      originLat: 30.27, originLng: -97.74, status: "planned", stopCount: 8,
    });
  });

  it("maps a stop row to camelCase preserving the display snapshot + state", () => {
    const row: PathStopRow = {
      id: "s1", path_id: "p1", prospect_id: "pr1", name: "Uratex Showroom",
      address: "123 Rd", lat: 30.2, lng: -97.7, category: "manufacturing",
      primary_type: "manufacturer", position: 0, status: "visited",
      disposition: "met_dm", deal_created: true, added_at: "2026-06-03T01:00:00Z",
    };
    const s = rowToStop(row);
    expect(s).toEqual({
      id: "s1", pathId: "p1", prospectId: "pr1", name: "Uratex Showroom",
      address: "123 Rd", lat: 30.2, lng: -97.7, category: "manufacturing",
      primaryType: "manufacturer", position: 0, status: "visited",
      disposition: "met_dm", dealCreated: true, addedAt: "2026-06-03T01:00:00Z",
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/lib/pathTypes.test.ts`
Expected: FAIL — module `./pathTypes` does not exist.

- [ ] **Step 3: Write the types + mappers**

`apps/app/src/features/path/lib/pathTypes.ts`:
```ts
/**
 * Path v3 domain types + row mappers. Mirrors the paths/path_stops tables
 * (migration 20260603000001). Centralizing the snake_case → camelCase mapping
 * keeps the hooks and UI off raw row shapes.
 */
import type { MerchantCategory } from "../mockData";

export type PathStatus = "planned" | "completed";
export type StopStatus = "pending" | "visited" | "skipped";

export interface Path {
  id: string;
  date: string;            // ISO date (yyyy-mm-dd)
  originLabel: string | null;
  originLat: number | null;
  originLng: number | null;
  status: PathStatus;
  stopCount: number;
}

export interface PathStop {
  id: string;
  pathId: string;
  prospectId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  category: MerchantCategory;
  primaryType: string | null;
  position: number;
  status: StopStatus;
  disposition: string | null;
  dealCreated: boolean;
  addedAt: string;
}

export interface PathRow {
  id: string;
  path_date: string;
  origin_label: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  status: PathStatus;
}

export interface PathStopRow {
  id: string;
  path_id: string;
  prospect_id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  category: string;
  primary_type: string | null;
  position: number;
  status: StopStatus;
  disposition: string | null;
  deal_created: boolean;
  added_at: string;
}

export function rowToPath(row: PathRow, stopCount: number): Path {
  return {
    id: row.id,
    date: row.path_date,
    originLabel: row.origin_label,
    originLat: row.origin_lat,
    originLng: row.origin_lng,
    status: row.status,
    stopCount,
  };
}

export function rowToStop(row: PathStopRow): PathStop {
  return {
    id: row.id,
    pathId: row.path_id,
    prospectId: row.prospect_id,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    category: row.category as MerchantCategory,
    primaryType: row.primary_type,
    position: row.position,
    status: row.status,
    disposition: row.disposition,
    dealCreated: row.deal_created,
    addedAt: row.added_at,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test src/features/path/lib/pathTypes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/path/lib/pathTypes.ts apps/app/src/features/path/lib/pathTypes.test.ts
git commit -m "feat(path): path domain types + row mappers"
```

---

## Task 3: `usePaths` — list the rep's paths

**Files:**
- Create: `apps/app/src/features/path/hooks/usePaths.ts`
- Test: `apps/app/src/features/path/hooks/usePaths.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/app/src/features/path/hooks/usePaths.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePaths } from "./usePaths";

const orderMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ order: orderMock }) }) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "user-1" } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => orderMock.mockReset());

describe("usePaths", () => {
  it("returns the rep's paths with a stop count derived from the joined stops", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        { id: "p1", path_date: "2026-06-03", origin_label: "Current location",
          origin_lat: 30.27, origin_lng: -97.74, status: "planned",
          path_stops: [{ count: 8 }] },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePaths(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: "p1", date: "2026-06-03", originLabel: "Current location",
        originLat: 30.27, originLng: -97.74, status: "planned", stopCount: 8 },
    ]);
  });

  it("surfaces an RLS / query error", async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    const { result } = renderHook(() => usePaths(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/hooks/usePaths.test.tsx`
Expected: FAIL — module `./usePaths` does not exist.

- [ ] **Step 3: Write the hook**

`apps/app/src/features/path/hooks/usePaths.ts`:
```ts
/**
 * usePaths — the signed-in rep's paths (newest day first), each with a stop
 * count. RLS scopes rows to the user, so no explicit user filter is needed; the
 * cache key is tailed with the user id so sign-out/in invalidates cleanly.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { rowToPath, type Path, type PathRow } from "../lib/pathTypes";

export const PATHS_QUERY_KEY = ["paths", "list"] as const;

/** Row shape with the embedded aggregate count PostgREST returns. */
type PathListRow = PathRow & { path_stops: { count: number }[] };

export function usePaths() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: [...PATHS_QUERY_KEY, userId],
    enabled: !!userId,
    queryFn: async (): Promise<Path[]> => {
      const { data, error } = await supabase
        .from("paths")
        .select("id, path_date, origin_label, origin_lat, origin_lng, status, path_stops(count)")
        .order("path_date", { ascending: false });
      if (error) throw error;
      return (data as PathListRow[] | null ?? []).map((r) =>
        rowToPath(r, r.path_stops?.[0]?.count ?? 0),
      );
    },
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test src/features/path/hooks/usePaths.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/path/hooks/usePaths.ts apps/app/src/features/path/hooks/usePaths.test.tsx
git commit -m "feat(path): usePaths list query"
```

---

## Task 4: `useActivePath` — one day's path + ordered stops

**Files:**
- Create: `apps/app/src/features/path/hooks/useActivePath.ts`
- Test: `apps/app/src/features/path/hooks/useActivePath.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/app/src/features/path/hooks/useActivePath.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useActivePath } from "./useActivePath";

const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ eq: eqMock }) }) },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "user-1" } }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => { maybeSingleMock.mockReset(); eqMock.mockClear(); });

describe("useActivePath", () => {
  it("returns the day's path with stops ordered by position", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "p1", path_date: "2026-06-03", origin_label: "Current location",
        origin_lat: 30.27, origin_lng: -97.74, status: "planned",
        path_stops: [
          { id: "s2", path_id: "p1", prospect_id: "pr2", name: "B", address: null, lat: 1, lng: 2,
            category: "automotive", primary_type: "car_repair", position: 1, status: "pending",
            disposition: null, deal_created: false, added_at: "t2" },
          { id: "s1", path_id: "p1", prospect_id: "pr1", name: "A", address: null, lat: 3, lng: 4,
            category: "manufacturing", primary_type: null, position: 0, status: "pending",
            disposition: null, deal_created: false, added_at: "t1" },
        ],
      },
      error: null,
    });
    const { result } = renderHook(() => useActivePath("2026-06-03"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqMock).toHaveBeenCalledWith("path_date", "2026-06-03");
    expect(result.current.data?.path?.id).toBe("p1");
    expect(result.current.data?.stops.map((s) => s.id)).toEqual(["s1", "s2"]); // sorted by position
  });

  it("returns null path when the day has none", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useActivePath("2026-06-04"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ path: null, stops: [] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/hooks/useActivePath.test.tsx`
Expected: FAIL — module `./useActivePath` does not exist.

- [ ] **Step 3: Write the hook**

`apps/app/src/features/path/hooks/useActivePath.ts`:
```ts
/**
 * useActivePath — a single working day's path plus its stops, ordered by
 * position. Returns { path: null, stops: [] } when the rep has no path that day.
 * RLS scopes to the user; the cache key carries user id + date.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { rowToPath, rowToStop, type Path, type PathRow, type PathStop, type PathStopRow } from "../lib/pathTypes";

export const ACTIVE_PATH_QUERY_KEY = ["paths", "active"] as const;

type PathWithStopsRow = PathRow & { path_stops: PathStopRow[] };

export interface ActivePathResult {
  path: Path | null;
  stops: PathStop[];
}

export function useActivePath(date: string) {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: [...ACTIVE_PATH_QUERY_KEY, userId, date],
    enabled: !!userId && !!date,
    queryFn: async (): Promise<ActivePathResult> => {
      const { data, error } = await supabase
        .from("paths")
        .select(
          "id, path_date, origin_label, origin_lat, origin_lng, status, " +
          "path_stops(id, path_id, prospect_id, name, address, lat, lng, category, primary_type, position, status, disposition, deal_created, added_at)",
        )
        .eq("path_date", date)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { path: null, stops: [] };
      const row = data as PathWithStopsRow;
      const stops = (row.path_stops ?? []).map(rowToStop).sort((a, b) => a.position - b.position);
      return { path: rowToPath(row, stops.length), stops };
    },
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test src/features/path/hooks/useActivePath.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/features/path/hooks/useActivePath.ts apps/app/src/features/path/hooks/useActivePath.test.tsx
git commit -m "feat(path): useActivePath day query"
```

---

## Task 5: `usePathMutations` — create / add / remove / reorder / status / disposition

**Files:**
- Create: `apps/app/src/features/path/hooks/usePathMutations.ts`
- Test: `apps/app/src/features/path/hooks/usePathMutations.test.tsx`

- [ ] **Step 1: Write the failing test**

`apps/app/src/features/path/hooks/usePathMutations.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePathMutations } from "./usePathMutations";

// Chainable supabase mock: capture the last op + resolve a configurable result.
const result = { current: { data: null as unknown, error: null as unknown } };
const upsertMock = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve(result.current) }) }));
const insertMock = vi.fn(() => Promise.resolve(result.current));
const fromMock = vi.fn(() => ({ upsert: upsertMock, insert: insertMock }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: (...a: unknown[]) => fromMock(...a) } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: { id: "user-1" } }),
}));

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fromMock.mockClear(); upsertMock.mockClear(); insertMock.mockClear();
  result.current = { data: null, error: null };
});

describe("usePathMutations.createPath", () => {
  it("upserts on (user_id, path_date) and returns the path id", async () => {
    result.current = { data: { id: "p1" }, error: null };
    const { result: hook } = renderHook(() => usePathMutations(), { wrapper: wrap(makeClient()) });
    const id = await hook.current.createPath.mutateAsync({
      date: "2026-06-03", originLabel: "Current location", originLat: 30.27, originLng: -97.74,
    });
    expect(fromMock).toHaveBeenCalledWith("paths");
    expect(upsertMock).toHaveBeenCalledWith(
      { user_id: "user-1", path_date: "2026-06-03", origin_label: "Current location", origin_lat: 30.27, origin_lng: -97.74 },
      { onConflict: "user_id,path_date" },
    );
    expect(id).toBe("p1");
  });
});

describe("usePathMutations.addStops", () => {
  it("inserts stop snapshots starting at the given base position", async () => {
    const { result: hook } = renderHook(() => usePathMutations(), { wrapper: wrap(makeClient()) });
    await hook.current.addStops.mutateAsync({
      pathId: "p1",
      basePosition: 2,
      stops: [{ prospectId: "pr1", name: "A", address: null, lat: 1, lng: 2, category: "automotive", primaryType: "car_repair" }],
    });
    expect(fromMock).toHaveBeenCalledWith("path_stops");
    expect(insertMock).toHaveBeenCalledWith([
      { path_id: "p1", prospect_id: "pr1", name: "A", address: null, lat: 1, lng: 2,
        category: "automotive", primary_type: "car_repair", position: 2 },
    ]);
  });

  it("refuses when not signed in is irrelevant here, but surfaces an insert error", async () => {
    result.current = { data: null, error: { message: "permission denied" } };
    const { result: hook } = renderHook(() => usePathMutations(), { wrapper: wrap(makeClient()) });
    await expect(hook.current.addStops.mutateAsync({ pathId: "p1", basePosition: 0, stops: [] }))
      .rejects.toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter app test src/features/path/hooks/usePathMutations.test.tsx`
Expected: FAIL — module `./usePathMutations` does not exist.

- [ ] **Step 3: Write the hook**

`apps/app/src/features/path/hooks/usePathMutations.ts`:
```ts
/**
 * usePathMutations — write side of the path data layer. Each mutation invalidates
 * the affected queries (the list + the day's active path) so the UI refreshes.
 * RLS enforces ownership server-side; createPath upserts on (user_id, path_date)
 * to keep the one-path-per-day invariant.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { MerchantCategory } from "../mockData";
import type { StopStatus } from "../lib/pathTypes";
import { PATHS_QUERY_KEY } from "./usePaths";
import { ACTIVE_PATH_QUERY_KEY } from "./useActivePath";

export interface CreatePathInput {
  date: string;
  originLabel: string | null;
  originLat: number | null;
  originLng: number | null;
}
export interface StopSnapshot {
  prospectId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  category: MerchantCategory;
  primaryType: string | null;
}
export interface AddStopsInput { pathId: string; basePosition: number; stops: StopSnapshot[]; }

export function usePathMutations() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [...PATHS_QUERY_KEY, userId] });
    qc.invalidateQueries({ queryKey: [...ACTIVE_PATH_QUERY_KEY, userId] });
  };

  const createPath = useMutation({
    mutationFn: async (input: CreatePathInput): Promise<string> => {
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("paths")
        .upsert(
          { user_id: userId, path_date: input.date, origin_label: input.originLabel,
            origin_lat: input.originLat, origin_lng: input.originLng },
          { onConflict: "user_id,path_date" },
        )
        .select("id")
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: invalidate,
  });

  const addStops = useMutation({
    mutationFn: async (input: AddStopsInput): Promise<void> => {
      const rows = input.stops.map((s, i) => ({
        path_id: input.pathId, prospect_id: s.prospectId, name: s.name, address: s.address,
        lat: s.lat, lng: s.lng, category: s.category, primary_type: s.primaryType,
        position: input.basePosition + i,
      }));
      const { error } = await supabase.from("path_stops").insert(rows);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const removeStop = useMutation({
    mutationFn: async (stopId: string): Promise<void> => {
      const { error } = await supabase.from("path_stops").delete().eq("id", stopId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reorderStops = useMutation({
    mutationFn: async (input: { orderedStopIds: string[] }): Promise<void> => {
      // Persist new positions one update per stop (lists are small, <100).
      for (let i = 0; i < input.orderedStopIds.length; i++) {
        const { error } = await supabase.from("path_stops").update({ position: i }).eq("id", input.orderedStopIds[i]);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const setStopStatus = useMutation({
    mutationFn: async (input: { stopId: string; status: StopStatus }): Promise<void> => {
      const { error } = await supabase.from("path_stops").update({ status: input.status }).eq("id", input.stopId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const setStopDisposition = useMutation({
    mutationFn: async (input: { stopId: string; disposition: string }): Promise<void> => {
      const { error } = await supabase.from("path_stops").update({ disposition: input.disposition }).eq("id", input.stopId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const markDealCreated = useMutation({
    mutationFn: async (stopId: string): Promise<void> => {
      const { error } = await supabase.from("path_stops").update({ deal_created: true }).eq("id", stopId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { createPath, addStops, removeStop, reorderStops, setStopStatus, setStopDisposition, markDealCreated };
}
```
NOTE on the test mock: the chainable shape above only stubs `from().upsert()...` and `from().insert()`. The two tests exercise `createPath` and `addStops`; `delete`/`update` chains aren't exercised in this task's tests (they'd need `.eq()` stubs). If you add tests for remove/reorder/status later, extend the mock with `delete: () => ({ eq })` and `update: () => ({ eq })` like `useDeleteDeal.test.tsx` does. Do not add unused stubs now (keeps the test honest about what's covered).

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter app test src/features/path/hooks/usePathMutations.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + full gate**

Run: `cd apps/app && pnpm typecheck && pnpm test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/features/path/hooks/usePathMutations.ts apps/app/src/features/path/hooks/usePathMutations.test.tsx
git commit -m "feat(path): path mutations (create/add/remove/reorder/status/disposition)"
```

---

## Task 6: Ship 1a

**Files:** none.

- [ ] **Step 1: Final gate** — `cd apps/app && pnpm typecheck && pnpm test` (clean).
- [ ] **Step 2: Finish the branch** — controller uses superpowers:finishing-a-development-branch (merge to main + push; the migration is already applied to prod from Task 1, so no extra deploy). The new tables/hooks are dormant until Phase 1b wires the UI — shipping 1a alone is safe (nothing imports the hooks yet).

---

## Self-Review

**Spec coverage (Phase 1a scope):**
- `paths` + `path_stops` tables, RLS, one-per-day, snapshot fields → Task 1. ✅
- Domain types + mappers → Task 2. ✅
- `usePaths` (day list w/ stop count) → Task 3. ✅
- `useActivePath` (day + ordered stops) → Task 4. ✅
- Mutations (create/add/remove/reorder/status/disposition/deal) → Task 5. ✅
- Queue migration + all UI (`PathEntry`/`ActivePathView`/discovery-as-add-stops) → **Phase 1b** (out of this plan, by design). ✅

**Placeholder scan:** No TBD/TODO. Every step has complete code or an exact command. The Task 5 NOTE is a real instruction (how to extend the mock if tests grow), not a placeholder.

**Type consistency:** `Path`/`PathStop`/`PathStatus`/`StopStatus` defined in Task 2 are imported unchanged in Tasks 3–5. Cache keys `PATHS_QUERY_KEY` / `ACTIVE_PATH_QUERY_KEY` are defined in their hooks and reused in `usePathMutations` invalidation. Row column names match the migration (Task 1) exactly: `path_date`, `origin_*`, `prospect_id`, `primary_type`, `deal_created`, `position`. `createPath` upserts on `user_id,path_date` matching the table's `unique (user_id, path_date)`.
