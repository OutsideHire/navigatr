// Covers the happy path (RPC call shape, returned row plucked from
// array), profile cache invalidation, auth refusal, and surface-up of
// server errors (org_name_too_short, already_in_organization).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useCreateOrganization } from "./useCreateOrganization";

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

describe("useCreateOrganization", () => {
  it("calls the RPC with the trimmed name and returns the row", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ org_id: "org-1", role: "manager", invite_code: "abc12345" }],
      error: null,
    });
    const { result } = renderHook(() => useCreateOrganization(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });

    const out = await result.current.mutateAsync("Acme Payments");

    expect(rpcMock).toHaveBeenCalledWith("create_organization", { p_name: "Acme Payments" });
    expect(out).toEqual({ org_id: "org-1", role: "manager", invite_code: "abc12345" });
  });

  it("supports single-object responses (in case supabase-js stops wrapping)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { org_id: "org-2", role: "manager", invite_code: "deadbeef" },
      error: null,
    });
    const { result } = renderHook(() => useCreateOrganization(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });

    const out = await result.current.mutateAsync("Beta");
    expect(out.org_id).toBe("org-2");
  });

  it("throws when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useCreateOrganization(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync("Acme")).rejects.toThrow(/not signed in/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("invalidates the profile query on success", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ org_id: "org-1", role: "manager", invite_code: "x" }],
      error: null,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateOrganization(), { wrapper: makeWrapper(client) });
    await result.current.mutateAsync("Acme");
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["profile", "user-1"]);
  });

  it("surfaces server-side errors (already_in_organization, name too short)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "already_in_organization" },
    });
    const { result } = renderHook(() => useCreateOrganization(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync("Acme")).rejects.toMatchObject({
      message: expect.stringMatching(/already_in_organization/),
    });
  });

  it("throws when the RPC returns no row (defensive)", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useCreateOrganization(), {
      wrapper: makeWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })),
    });
    await expect(result.current.mutateAsync("Acme")).rejects.toThrow(/no row/i);
  });
});
