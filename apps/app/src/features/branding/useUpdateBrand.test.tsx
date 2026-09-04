// useUpdateBrand: RPC name + payload shape, cache invalidation on success,
// error pass-through.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useUpdateBrand } from "./useUpdateBrand";
import { ORG_BRANDING_QUERY_KEY } from "./useBrand";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));
// useUpdateBrand transitively imports useBrand which imports @/stores/auth,
// whose top-level code calls supabase.auth.getSession(). Mocking the store
// short-circuits that side effect so the test doesn't need a real Supabase
// auth client.
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: { id: "user-1" } }),
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

describe("useUpdateBrand", () => {
  it("calls update_org_branding with snake_case param names and null defaults", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        product_name: "Acme Sales",
        primary_color: "#2456e6",
        logo_url: null,
        dark_logo_url: null,
        show_powered_by: true,
      },
      error: null,
    });
    const { result } = renderHook(() => useUpdateBrand(), {
      wrapper: makeWrapper(freshClient()),
    });
    await result.current.mutateAsync({
      productName: "Acme Sales",
      primaryColor: "#2456e6",
    });
    expect(rpcMock).toHaveBeenCalledWith("update_org_branding", {
      p_product_name: "Acme Sales",
      p_primary_color: "#2456e6",
      p_logo_url: null,
      p_dark_logo_url: null,
      p_show_powered_by: null,
    });
  });

  it("returns mapped Brand shape from the RPC response", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        product_name: "X",
        primary_color: null,
        logo_url: "https://x/logo.svg",
        show_powered_by: false,
      },
      error: null,
    });
    const { result } = renderHook(() => useUpdateBrand(), {
      wrapper: makeWrapper(freshClient()),
    });
    const res = await result.current.mutateAsync({ productName: "X" });
    expect(res).toEqual({
      productName: "X",
      primaryColor: null,
      logoUrl: "https://x/logo.svg",
      showPoweredBy: false,
    });
  });

  it("invalidates the org-branding query on success", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { product_name: "Y", primary_color: null, logo_url: null, show_powered_by: true },
      error: null,
    });
    const client = freshClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateBrand(), {
      wrapper: makeWrapper(client),
    });
    await result.current.mutateAsync({ productName: "Y" });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ queryKey: ORG_BRANDING_QUERY_KEY("org-1") });
  });

  it("surfaces RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    const { result } = renderHook(() => useUpdateBrand(), {
      wrapper: makeWrapper(freshClient()),
    });
    await expect(result.current.mutateAsync({ productName: "X" })).rejects.toThrow("not_authorized");
  });
});
