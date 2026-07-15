import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useSetMemberManager } from "./useSetMemberManager";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));

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

beforeEach(() => { rpcMock.mockReset(); authUserId = "user-1"; });

describe("useSetMemberManager", () => {
  it("calls admin_set_manager with member + manager and invalidates the leaderboard", async () => {
    rpcMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetMemberManager(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({ memberId: "m-1", managerId: "mgr-1" });
    expect(rpcMock).toHaveBeenCalledWith("admin_set_manager", { p_member: "m-1", p_manager: "mgr-1" });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(["admin", "leaderboard", "user-1"]);
  });

  it("passes null manager (unassign)", async () => {
    rpcMock.mockResolvedValueOnce({ error: null });
    const { result } = renderHook(() => useSetMemberManager(), {
      wrapper: makeWrapper(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })),
    });
    await result.current.mutateAsync({ memberId: "m-1", managerId: null });
    expect(rpcMock).toHaveBeenCalledWith("admin_set_manager", { p_member: "m-1", p_manager: null });
  });

  it("refuses when signed out", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useSetMemberManager(), {
      wrapper: makeWrapper(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })),
    });
    await expect(result.current.mutateAsync({ memberId: "m-1", managerId: null })).rejects.toThrow(/not signed in/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ error: { message: "cycle_detected" } });
    const { result } = renderHook(() => useSetMemberManager(), {
      wrapper: makeWrapper(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })),
    });
    await expect(result.current.mutateAsync({ memberId: "m-1", managerId: "mgr-1" }))
      .rejects.toMatchObject({ message: expect.stringMatching(/cycle_detected/) });
  });
});
