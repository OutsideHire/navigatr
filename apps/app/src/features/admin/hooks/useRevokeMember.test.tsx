// Covers RPC payload shape, both cache invalidations on success,
// auth refusal, RPC error surfacing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useRevokeMember } from "./useRevokeMember";

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

describe("useRevokeMember", () => {
  it("calls admin_revoke_member with targetId and kind", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useRevokeMember(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await result.current.mutateAsync({ targetId: "t-1", kind: "invite" });
    expect(rpcMock).toHaveBeenCalledWith("admin_revoke_member", {
      p_target: "t-1",
      p_kind: "invite",
    });
  });

  it("invalidates both leaderboard prefix and seat-usage caches on success", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRevokeMember(), {
      wrapper: makeWrapper(client),
    });
    await result.current.mutateAsync({ targetId: "t-1", kind: "profile" });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["admin", "leaderboard", "user-1"]);
    expect(keys).toContainEqual(["admin", "seat-usage", "user-1"]);
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useRevokeMember(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync({ targetId: "t-1", kind: "invite" }))
      .rejects.toThrow(/not signed in/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces server errors (forbidden, etc.)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });
    const { result } = renderHook(() => useRevokeMember(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync({ targetId: "t-1", kind: "profile" }))
      .rejects.toMatchObject({ message: "forbidden" });
  });
});
