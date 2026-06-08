import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePathMutations } from "./usePathMutations";

type Call = { table: string; op: string; payload?: unknown; opts?: unknown; filters: [string, unknown][] };
const calls: Call[] = [];
// Controllable result for terminal points that need explicit data/error.
let nextSingle: { data: unknown; error: unknown } = { data: { id: "today-1" }, error: null };
let pendingStops: { id: string }[] = []; // returned by the prev-path pending fetch
let olderPaths: { id: string }[] = []; // returned by the finalizeOlderThan paths fetch
let upsertResult: { data: unknown; error: unknown } = { data: null, error: null };

// A chain recorder. Terminal points (.single(), .order(), thenable) resolve data.
function builder(table: string) {
  const rec: Call = { table, op: "read", filters: [] };
  const api: {
    select: (c?: string) => typeof api;
    upsert: (p: unknown, o?: unknown) => typeof api;
    update: (p: unknown) => typeof api;
    delete: () => typeof api;
    eq: (c: string, v: unknown) => typeof api;
    lt: (c: string, v: unknown) => typeof api;
    neq: (c: string, v: unknown) => typeof api;
    in: (c: string, v: unknown) => typeof api;
    order: (c: string, o?: unknown) => Promise<{ data: unknown; error: unknown }>;
    single: () => Promise<{ data: unknown; error: unknown }>;
    then: (res: (r: { data: unknown; error: unknown }) => void) => void;
  } = {
    select(_c?: string) {
      return api;
    },
    upsert(p: unknown, _o?: unknown) {
      rec.op = "upsert";
      rec.payload = p;
      rec.opts = _o;
      return api;
    },
    update(p: unknown) {
      rec.op = "update";
      rec.payload = p;
      return api;
    },
    delete() {
      rec.op = "delete";
      return api;
    },
    eq(c: string, v: unknown) {
      rec.filters.push([c, v]);
      return api;
    },
    lt(c: string, v: unknown) {
      rec.filters.push([c, v]);
      return api;
    },
    neq(c: string, v: unknown) {
      rec.filters.push([c, v]);
      return api;
    },
    in(c: string, v: unknown) {
      rec.filters.push([c, v]);
      return api;
    },
    order(_c: string, _o?: unknown) {
      calls.push(rec);
      // prev pending fetch (path_stops select ordered) vs older-paths fetch (paths select)
      return Promise.resolve({ data: table === "path_stops" ? pendingStops : olderPaths, error: null });
    },
    single() {
      calls.push(rec);
      return Promise.resolve(upsertResult.data !== null || upsertResult.error !== null ? upsertResult : nextSingle);
    },
    then(res: (r: { data: unknown; error: unknown }) => void) {
      calls.push(rec);
      // Reads (select-only) resolve table-specific rows; writes resolve the upsert/error result.
      if (rec.op === "read") {
        res({ data: table === "path_stops" ? pendingStops : olderPaths, error: null });
      } else {
        res(upsertResult);
      }
    },
  };
  return api;
}
vi.mock("@/lib/supabase", () => ({ supabase: { from: (t: string) => builder(t) } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (s: (x: { user: { id: string } }) => unknown) => s({ user: { id: "user-1" } }),
}));
vi.mock("../lib/today", () => ({ todayISO: () => "2026-06-08", formatPathDate: () => "x" }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  calls.length = 0;
  pendingStops = [];
  olderPaths = [];
  nextSingle = { data: { id: "today-1" }, error: null };
  upsertResult = { data: null, error: null };
});

describe("usePathMutations.createPath", () => {
  it("upserts on (user_id, path_date) and returns the path id", async () => {
    nextSingle = { data: { id: "p1" }, error: null };
    const { result } = renderHook(() => usePathMutations(), { wrapper });
    let id = "";
    await act(async () => {
      id = await result.current.createPath.mutateAsync({
        date: "2026-06-03",
        originLabel: "Current location",
        originLat: 30.27,
        originLng: -97.74,
      });
    });
    const upsert = calls.find((c) => c.table === "paths" && c.op === "upsert");
    expect(upsert?.payload).toEqual({
      user_id: "user-1",
      path_date: "2026-06-03",
      origin_label: "Current location",
      origin_lat: 30.27,
      origin_lng: -97.74,
    });
    expect(upsert?.opts).toEqual({ onConflict: "user_id,path_date" });
    expect(id).toBe("p1");
  });
});

describe("usePathMutations.addStops", () => {
  it("inserts stop snapshots starting at the given base position", async () => {
    const { result } = renderHook(() => usePathMutations(), { wrapper });
    await act(async () => {
      await result.current.addStops.mutateAsync({
        pathId: "p1",
        basePosition: 2,
        stops: [
          { prospectId: "pr1", name: "A", address: null, phone: null, lat: 1, lng: 2, category: "automotive", primaryType: "car_repair" },
        ],
      });
    });
    const upsert = calls.find((c) => c.table === "path_stops" && c.op === "upsert");
    expect(upsert?.payload).toEqual([
      { path_id: "p1", prospect_id: "pr1", name: "A", address: null, phone: null, lat: 1, lng: 2, category: "automotive", primary_type: "car_repair", position: 2 },
    ]);
    expect(upsert?.opts).toEqual({ onConflict: "path_id,prospect_id", ignoreDuplicates: true });
  });

  it("uses ignoreDuplicates so re-adding a prospect already on the path is a no-op (no 23505)", async () => {
    const { result } = renderHook(() => usePathMutations(), { wrapper });
    await act(async () => {
      await result.current.addStops.mutateAsync({
        pathId: "p1",
        basePosition: 0,
        stops: [
          { prospectId: "pr1", name: "A", address: null, phone: null, lat: 1, lng: 2, category: "automotive", primaryType: null },
        ],
      });
    });
    const upsert = calls.find((c) => c.table === "path_stops" && c.op === "upsert");
    expect(upsert?.opts).toMatchObject({ onConflict: "path_id,prospect_id", ignoreDuplicates: true });
  });

  it("surfaces an insert error", async () => {
    upsertResult = { data: null, error: { message: "permission denied" } };
    const { result } = renderHook(() => usePathMutations(), { wrapper });
    await expect(
      result.current.addStops.mutateAsync({ pathId: "p1", basePosition: 0, stops: [] }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });
});

describe("usePathMutations.deletePath", () => {
  it("deletes the path by id (cascade removes its stops)", async () => {
    const { result } = renderHook(() => usePathMutations(), { wrapper });
    await act(async () => {
      await result.current.deletePath.mutateAsync("p1");
    });
    const del = calls.find((c) => c.table === "paths" && c.op === "delete");
    expect(del).toBeTruthy();
    expect(del?.filters).toContainEqual(["id", "p1"]);
  });
});

describe("continuePreviousPath", () => {
  it("upserts today's path, reparents pending stops onto it, marks the old path completed", async () => {
    pendingStops = [{ id: "ps1" }, { id: "ps2" }];
    const { result } = renderHook(() => usePathMutations(), { wrapper });
    await act(async () => {
      await result.current.continuePreviousPath.mutateAsync({ prevPathId: "p7", prevPathDate: "2026-06-07" });
    });
    expect(calls.some((c) => c.table === "paths" && c.op === "upsert")).toBe(true);
    const reparents = calls.filter(
      (c) => c.table === "path_stops" && c.op === "update" && (c.payload as { path_id?: string }).path_id === "today-1",
    );
    expect(reparents).toHaveLength(2);
    expect(
      calls.some(
        (c) =>
          c.table === "paths" &&
          c.op === "update" &&
          (c.payload as { status?: string }).status === "completed" &&
          c.filters.some(([col, v]) => col === "id" && v === "p7"),
      ),
    ).toBe(true);
  });
});

describe("closePreviousPath", () => {
  it("skips the old path's pending stops and marks it completed", async () => {
    const { result } = renderHook(() => usePathMutations(), { wrapper });
    await act(async () => {
      await result.current.closePreviousPath.mutateAsync({ prevPathId: "p7", prevPathDate: "2026-06-07" });
    });
    expect(
      calls.some(
        (c) => c.table === "path_stops" && c.op === "update" && (c.payload as { status?: string }).status === "skipped",
      ),
    ).toBe(true);
    expect(
      calls.some(
        (c) => c.table === "paths" && c.op === "update" && (c.payload as { status?: string }).status === "completed",
      ),
    ).toBe(true);
  });
});
