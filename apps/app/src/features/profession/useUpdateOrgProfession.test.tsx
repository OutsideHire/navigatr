// useUpdateOrgProfession — RPC payload + invalidation contract.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useUpdateOrgProfession } from "./useUpdateOrgProfession";
import { ORG_PROFESSION_QUERY_KEY } from "./useOrgProfession";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));
// useUpdateOrgProfession transitively imports useOrgProfession which imports
// @/stores/auth; the auth store has a top-level supabase.auth.getSession()
// call. Mocking the store + getProfession helper short-circuits that.
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
  getProfession: () => null,
}));
vi.mock("@/features/auth/useProfile", () => ({
  useProfile: () => ({ data: { org_id: "org-1" } }),
}));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function freshClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("useUpdateOrgProfession", () => {
  it("calls update_org_profession with the new value", async () => {
    rpcMock.mockResolvedValueOnce({ data: "merchant_services", error: null });
    const { result } = renderHook(() => useUpdateOrgProfession(), {
      wrapper: makeWrapper(freshClient()),
    });
    const out = await result.current.mutateAsync("merchant_services");
    expect(rpcMock).toHaveBeenCalledWith("update_org_profession", {
      p_profession: "merchant_services",
    });
    expect(out).toBe("merchant_services");
  });

  it("passes null to clear (fall back to per-user)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useUpdateOrgProfession(), {
      wrapper: makeWrapper(freshClient()),
    });
    const out = await result.current.mutateAsync(null);
    expect(rpcMock).toHaveBeenCalledWith("update_org_profession", { p_profession: null });
    expect(out).toBeNull();
  });

  it("invalidates the org-profession query on success", async () => {
    rpcMock.mockResolvedValueOnce({ data: "payroll", error: null });
    const client = freshClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateOrgProfession(), {
      wrapper: makeWrapper(client),
    });
    await result.current.mutateAsync("payroll");
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ queryKey: ORG_PROFESSION_QUERY_KEY("org-1") });
  });

  it("surfaces RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "invalid_profession" } });
    const { result } = renderHook(() => useUpdateOrgProfession(), {
      wrapper: makeWrapper(freshClient()),
    });
    await expect(result.current.mutateAsync("payroll")).rejects.toThrow("invalid_profession");
  });
});
