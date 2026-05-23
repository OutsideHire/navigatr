// Covers RPC payload shape, return value pass-through, cache
// invalidation on success, auth refusal + error surfacing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useReassignDeals } from "./useReassignDeals";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

// DEALS_QUERY_KEY is used in onSuccess — mock the module to avoid real imports.
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  DEALS_QUERY_KEY: (userId: string | undefined) => ["deals", "list", userId ?? "anon"],
}));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  authUserId = "user-1";
});

describe("useReassignDeals", () => {
  it("calls admin_reassign_deals with the right payload and returns the count", async () => {
    rpcMock.mockResolvedValueOnce({ data: 23, error: null });
    const { result } = renderHook(() => useReassignDeals(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    const count = await result.current.mutateAsync({
      fromProfile: "from-uuid",
      toProfile: "to-uuid",
    });
    expect(rpcMock).toHaveBeenCalledWith("admin_reassign_deals", {
      p_from_profile: "from-uuid",
      p_to_profile: "to-uuid",
    });
    expect(count).toBe(23);
  });

  it("invalidates leaderboard and deals caches on success", async () => {
    rpcMock.mockResolvedValueOnce({ data: 5, error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useReassignDeals(), {
      wrapper: makeWrapper(client),
    });
    await result.current.mutateAsync({ fromProfile: "from-uuid", toProfile: "to-uuid" });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["admin", "leaderboard"]);
    expect(keys).toContainEqual(["deals", "list", "user-1"]);
  });

  it("refuses when not signed in and surfaces the error", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useReassignDeals(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ fromProfile: "from-uuid", toProfile: "to-uuid" }),
    ).rejects.toThrow(/not signed in/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
