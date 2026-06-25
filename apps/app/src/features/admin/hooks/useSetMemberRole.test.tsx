import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSetMemberRole } from "./useSetMemberRole";

let rpcResult: { error: Error | null };
let authUserId: string | null;
const rpcMock = vi.fn((..._args: unknown[]) => Promise.resolve(rpcResult));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...args: unknown[]) => rpcMock(...args) } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (sel: (s: { user: { id: string } | null }) => unknown) =>
    sel({ user: authUserId ? { id: authUserId } : null }),
}));

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function client() {
  return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
}

beforeEach(() => { rpcResult = { error: null }; authUserId = "me"; rpcMock.mockClear(); });

describe("useSetMemberRole", () => {
  it("calls admin_set_role with the profile id + new role and invalidates the leaderboard", async () => {
    const c = client();
    const invalidate = vi.spyOn(c, "invalidateQueries");
    const { result } = renderHook(() => useSetMemberRole(), { wrapper: wrapper(c) });
    result.current.mutate({ profileId: "u2", newRole: "manager" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("admin_set_role", { p_profile_id: "u2", p_new_role: "manager" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "leaderboard", "me"] });
  });

  it("surfaces an RPC error", async () => {
    rpcResult = { error: new Error("cannot_demote_sole_admin") };
    const { result } = renderHook(() => useSetMemberRole(), { wrapper: wrapper(client()) });
    result.current.mutate({ profileId: "u2", newRole: "rep" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error("cannot_demote_sole_admin"));
  });

  it("refuses (and skips the RPC) when not signed in", async () => {
    authUserId = null;
    const { result } = renderHook(() => useSetMemberRole(), { wrapper: wrapper(client()) });
    result.current.mutate({ profileId: "u2", newRole: "manager" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
