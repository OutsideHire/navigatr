// Covers RPC payload shape, per-row result pass-through, cache
// invalidation on success, auth refusal, RPC error surfacing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAdminBulkInvite } from "./useAdminBulkInvite";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
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
  rpcMock.mockReset();
  authUserId = "user-1";
});

describe("useAdminBulkInvite", () => {
  it("calls admin_bulk_invite with the rows array", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ email: "a@x.com", id: "i1", ok: true, error: null }],
      error: null,
    });
    const { result } = renderHook(() => useAdminBulkInvite(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync([
      { email: "a@x.com", full_name: "Alice", role: "rep" },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("admin_bulk_invite", {
      p_invites: [{ email: "a@x.com", full_name: "Alice", role: "rep" }],
    });
  });

  it("forwards role_level and reports_to when present on a row", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ email: "b@x.com", id: "i2", ok: true, error: null }],
      error: null,
    });
    const { result } = renderHook(() => useAdminBulkInvite(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync([
      {
        email: "b@x.com",
        full_name: "Bob",
        role: "manager",
        role_level: "sales_manager",
        reports_to: "manager@x.com",
      },
    ]);
    expect(rpcMock).toHaveBeenCalledWith("admin_bulk_invite", {
      p_invites: [
        {
          email: "b@x.com",
          full_name: "Bob",
          role: "manager",
          role_level: "sales_manager",
          reports_to: "manager@x.com",
        },
      ],
    });
  });

  it("invalidates the leaderboard cache prefix on success", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useAdminBulkInvite(), {
      wrapper: makeWrapper(client),
    });
    await result.current.mutateAsync([]);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual([
      "admin", "leaderboard", "user-1",
    ]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useAdminBulkInvite(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync([{ email: "a@x.com", full_name: null, role: "rep" }]))
      .rejects.toThrow(/not signed in/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces server errors (forbidden, etc.)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });
    const { result } = renderHook(() => useAdminBulkInvite(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync([{ email: "a@x.com", full_name: null, role: "rep" }]))
      .rejects.toMatchObject({ message: "forbidden" });
  });
});
