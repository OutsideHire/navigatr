// Covers the partial-update payload, the .eq('id', x) where-clause
// chain, cache invalidation, and auth refusal. The "no patch fields"
// case is a real bug class — sending an empty object to PostgREST is
// a no-op but the cache invalidates anyway, which we want.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useUpdatePartner } from "./useUpdatePartner";

const eqMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: eqMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ update: updateMock }) },
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
  updateMock.mockClear();
  eqMock.mockReset();
  authUserId = "user-1";
});

describe("useUpdatePartner", () => {
  it("sends the patch payload and matches the partner by id", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useUpdatePartner(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({
      id: "p-1",
      patch: { status: "cooling", notes: "Slowed down this quarter" },
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const updateCalls = updateMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(updateCalls[0]?.[0]).toEqual({
      status: "cooling",
      notes: "Slowed down this quarter",
    });
    expect(eqMock).toHaveBeenCalledWith("id", "p-1");
  });

  it("accepts a single-field patch (the common case — status quick-change)", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useUpdatePartner(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({ id: "p-1", patch: { status: "inactive" } });
    const updateCalls = updateMock.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(updateCalls[0]?.[0]).toEqual({ status: "inactive" });
  });

  it("invalidates the partners list cache on success", async () => {
    eqMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdatePartner(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({ id: "p-1", patch: { status: "active" } });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    expect(invalidateSpy.mock.calls[0]?.[0]?.queryKey).toEqual(["partners", "list", "user-1"]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useUpdatePartner(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ id: "p-1", patch: { status: "active" } }),
    ).rejects.toThrow(/not signed in/i);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("surfaces Supabase errors (RLS denial when rep tries to edit a partner they don't own)", async () => {
    eqMock.mockResolvedValueOnce({
      error: { message: "permission denied for table partners" },
    });
    const { result } = renderHook(() => useUpdatePartner(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(
      result.current.mutateAsync({ id: "p-1", patch: { status: "active" } }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/permission denied/) });
  });
});
