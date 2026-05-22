// Tests the delete path: .from('deals').delete().eq('id', x), cache
// invalidation for both deals + stage_history, auth refusal, and RLS
// surface-up.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useDeleteDeal } from "./useDeleteDeal";

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

describe("useDeleteDeal", () => {
  it("deletes by deal id", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useDeleteDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync("deal-1");

    expect(deleteMock).toHaveBeenCalled();
    expect(eqMock).toHaveBeenCalledWith("id", "deal-1");
  });

  it("invalidates deals list AND stage history on success", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDeleteDeal(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync("deal-1");
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["deals", "list", "user-1"]);
    expect(invalidatedKeys).toContainEqual(["stage-history", "list", "user-1"]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useDeleteDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync("deal-1")).rejects.toThrow(/not signed in/i);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("surfaces RLS denial (rep deleting somebody else's deal)", async () => {
    eqMock.mockResolvedValueOnce({
      error: { message: "permission denied for table deals" },
    });
    const { result } = renderHook(() => useDeleteDeal(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync("deal-1")).rejects.toMatchObject({
      message: expect.stringMatching(/permission denied/),
    });
  });
});
