// useAttributeDeal / useUnattributeDeal call the referral RPCs (Partner Portal
// Phase 0). The old partner_deals table is frozen for app writes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAttributeDeal, useUnattributeDeal } from "./useAttributeDeal";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrap(c: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={c}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  rpcMock.mockReset();
  authUserId = "user-1";
});

describe("useAttributeDeal", () => {
  it("calls attribute_deal_to_partner with partner, deal and note", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ref-1", error: null });
    const { result } = renderHook(() => useAttributeDeal(), { wrapper: wrap(client()) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1", notes: "met at chamber" });
    expect(rpcMock).toHaveBeenCalledWith("attribute_deal_to_partner", {
      p_partner_id: "p-1", p_deal_id: "d-1", p_note: "met at chamber",
    });
  });

  it("invalidates partners and referrals on success", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ref-1", error: null });
    const c = client();
    const spy = vi.spyOn(c, "invalidateQueries");
    const { result } = renderHook(() => useAttributeDeal(), { wrapper: wrap(c) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls.map((x) => x[0]?.queryKey)).toEqual([["partners", "list", "user-1"], ["referrals"]]);
  });

  it("surfaces the server error with friendly copy", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "already_linked" } });
    const { result } = renderHook(() => useAttributeDeal(), { wrapper: wrap(client()) });
    await expect(result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" }))
      .rejects.toThrow("That deal is already linked to this partner.");
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useAttributeDeal(), { wrapper: wrap(client()) });
    await expect(result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" })).rejects.toThrow("Not signed in");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("useUnattributeDeal", () => {
  it("calls remove_referral_link (inbound by default)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useUnattributeDeal(), { wrapper: wrap(client()) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });
    expect(rpcMock).toHaveBeenCalledWith("remove_referral_link", {
      p_partner_id: "p-1", p_deal_id: "d-1", p_direction: "inbound",
    });
  });

  it("passes the outbound direction through", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useUnattributeDeal(), { wrapper: wrap(client()) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1", direction: "outbound" });
    expect(rpcMock).toHaveBeenCalledWith("remove_referral_link", {
      p_partner_id: "p-1", p_deal_id: "d-1", p_direction: "outbound",
    });
  });

  it("maps not_authorized to plain copy", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "not_authorized" } });
    const { result } = renderHook(() => useUnattributeDeal(), { wrapper: wrap(client()) });
    await expect(result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" }))
      .rejects.toThrow("You don't have access to do that.");
  });
});
