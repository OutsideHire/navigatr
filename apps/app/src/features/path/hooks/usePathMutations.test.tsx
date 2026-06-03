import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { usePathMutations } from "./usePathMutations";

const result = { current: { data: null as unknown, error: null as unknown } };
const upsertMock = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve(result.current) }) }));
const insertMock = vi.fn(() => Promise.resolve(result.current));
const fromMock = vi.fn(() => ({ upsert: upsertMock, insert: insertMock }));
vi.mock("@/lib/supabase", () => ({ supabase: { from: (...a: unknown[]) => fromMock(...(a as [])) } }));
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

  it("surfaces an insert error", async () => {
    result.current = { data: null, error: { message: "permission denied" } };
    const { result: hook } = renderHook(() => usePathMutations(), { wrapper: wrap(makeClient()) });
    await expect(hook.current.addStops.mutateAsync({ pathId: "p1", basePosition: 0, stops: [] }))
      .rejects.toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });
});
