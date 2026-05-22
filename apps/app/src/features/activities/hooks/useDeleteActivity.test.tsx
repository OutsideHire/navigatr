// Delete by id, cache invalidation (per-deal + org + deals list),
// auth refusal, RLS denial (the policy is manager/admin only).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useDeleteActivity } from "./useDeleteActivity";

const eqMock = vi.fn();
const deleteMock = vi.fn(() => ({ eq: eqMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ delete: deleteMock }) },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  deleteMock.mockClear();
  eqMock.mockReset();
  authUserId = "user-1";
});

describe("useDeleteActivity", () => {
  it("deletes by activity id", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useDeleteActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({ id: "act-1", dealId: "deal-1" });

    expect(deleteMock).toHaveBeenCalled();
    expect(eqMock).toHaveBeenCalledWith("id", "act-1");
  });

  it("invalidates per-deal, org-wide, and deals list caches", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDeleteActivity(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({ id: "act-1", dealId: "deal-1" });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["activities", "byDeal", "user-1", "deal-1"]);
    expect(invalidatedKeys).toContainEqual(["activities", "list", "user-1"]);
    expect(invalidatedKeys).toContainEqual(["deals", "list", "user-1"]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useDeleteActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ id: "act-1", dealId: "deal-1" }),
    ).rejects.toThrow(/not signed in/i);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("surfaces RLS denial (rep trying to delete; policy is manager/admin only)", async () => {
    eqMock.mockResolvedValueOnce({
      error: { message: "permission denied for table activities" },
    });
    const { result } = renderHook(() => useDeleteActivity(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ id: "act-1", dealId: "deal-1" }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });
});
