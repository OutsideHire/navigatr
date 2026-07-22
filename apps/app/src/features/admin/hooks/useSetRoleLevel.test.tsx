import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useSetRoleLevel } from "./useSetRoleLevel";

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

describe("useSetRoleLevel", () => {
  it("calls admin_set_role_level with profile + level and invalidates the leaderboard", async () => {
    rpcMock.mockResolvedValueOnce({ error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetRoleLevel(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync({ profileId: "p-1", level: "sales_manager" });
    expect(rpcMock).toHaveBeenCalledWith("admin_set_role_level", { p_profile_id: "p-1", p_level: "sales_manager" });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(["admin", "leaderboard", "user-1"]);
  });

  it("refuses when signed out", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useSetRoleLevel(), {
      wrapper: makeWrapper(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })),
    });
    await expect(result.current.mutateAsync({ profileId: "p-1", level: "sales_manager" })).rejects.toThrow(/not signed in/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces RPC errors via error.message", async () => {
    rpcMock.mockResolvedValueOnce({ error: { message: "cannot_change_own_role" } });
    const { result } = renderHook(() => useSetRoleLevel(), {
      wrapper: makeWrapper(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })),
    });
    await expect(result.current.mutateAsync({ profileId: "p-1", level: "sales_professional" }))
      .rejects.toMatchObject({ message: expect.stringMatching(/cannot_change_own_role/) });
  });
});
