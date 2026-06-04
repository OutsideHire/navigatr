import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePathMutations } from "./usePathMutations";

const result = { current: { data: null as unknown, error: null as unknown } };
// paths.upsert(...).select("id").single() — chainable
const pathsUpsertMock = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve(result.current) }) }));
// path_stops.upsert(rows, opts) — awaited directly
const stopsUpsertMock = vi.fn(() => Promise.resolve(result.current));
const deleteEqMock = vi.fn(() => Promise.resolve(result.current));
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }));
const fromMock = vi.fn((table: string) =>
  table === "paths" ? { upsert: pathsUpsertMock, delete: deleteMock } : { upsert: stopsUpsertMock },
);
vi.mock("@/lib/supabase", () => ({ supabase: { from: (t: string) => fromMock(t) } }));
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
  fromMock.mockClear(); pathsUpsertMock.mockClear(); stopsUpsertMock.mockClear();
  deleteMock.mockClear(); deleteEqMock.mockReset();
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
    expect(pathsUpsertMock).toHaveBeenCalledWith(
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
      stops: [{ prospectId: "pr1", name: "A", address: null, phone: null, lat: 1, lng: 2, category: "automotive", primaryType: "car_repair" }],
    });
    expect(fromMock).toHaveBeenCalledWith("path_stops");
    expect(stopsUpsertMock).toHaveBeenCalledWith(
      [{ path_id: "p1", prospect_id: "pr1", name: "A", address: null, phone: null, lat: 1, lng: 2,
         category: "automotive", primary_type: "car_repair", position: 2 }],
      { onConflict: "path_id,prospect_id", ignoreDuplicates: true },
    );
  });

  it("surfaces an insert error", async () => {
    result.current = { data: null, error: { message: "permission denied" } };
    const { result: hook } = renderHook(() => usePathMutations(), { wrapper: wrap(makeClient()) });
    await expect(hook.current.addStops.mutateAsync({ pathId: "p1", basePosition: 0, stops: [] }))
      .rejects.toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });

  it("uses ignoreDuplicates so re-adding a prospect already on the path is a no-op (no 23505)", async () => {
    const { result: hook } = renderHook(() => usePathMutations(), { wrapper: wrap(makeClient()) });
    await hook.current.addStops.mutateAsync({
      pathId: "p1", basePosition: 0,
      stops: [{ prospectId: "pr1", name: "A", address: null, phone: null, lat: 1, lng: 2, category: "automotive", primaryType: null }],
    });
    expect(stopsUpsertMock).toHaveBeenCalledWith(expect.any(Array), { onConflict: "path_id,prospect_id", ignoreDuplicates: true });
  });
});

describe("usePathMutations.deletePath", () => {
  it("deletes the path by id (cascade removes its stops)", async () => {
    const { result: hook } = renderHook(() => usePathMutations(), { wrapper: wrap(makeClient()) });
    await hook.current.deletePath.mutateAsync("p1");
    expect(fromMock).toHaveBeenCalledWith("paths");
    expect(deleteMock).toHaveBeenCalled();
    expect(deleteEqMock).toHaveBeenCalledWith("id", "p1");
  });
});
