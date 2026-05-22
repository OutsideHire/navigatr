// Covers RPC payload shape, return value pass-through, cache
// invalidation on success, auth refusal, RPC error surfacing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useResendInvite } from "./useResendInvite";

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

describe("useResendInvite", () => {
  it("calls admin_resend_invite with the invite id", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { id: "inv-1", email: "a@x.com", token: "tok123" },
      error: null,
    });
    const { result } = renderHook(() => useResendInvite(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    const res = await result.current.mutateAsync("inv-1");
    expect(rpcMock).toHaveBeenCalledWith("admin_resend_invite", {
      p_invite_id: "inv-1",
    });
    expect(res).toEqual({ id: "inv-1", email: "a@x.com", token: "tok123" });
  });

  it("invalidates the org-agents cache on success", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { id: "inv-1", email: "a@x.com", token: "tok123" },
      error: null,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useResendInvite(), {
      wrapper: makeWrapper(client),
    });
    await result.current.mutateAsync("inv-1");
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual([
      "admin", "agents", "user-1",
    ]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useResendInvite(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync("inv-1"))
      .rejects.toThrow(/not signed in/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces server errors (forbidden, etc.)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });
    const { result } = renderHook(() => useResendInvite(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync("inv-1"))
      .rejects.toMatchObject({ message: "forbidden" });
  });
});
