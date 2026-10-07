// useReferDeal records an outbound referral via the refer_deal_to_partner RPC.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useReferDeal } from "./useReferDeal";

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

describe("useReferDeal", () => {
  it("calls refer_deal_to_partner with partner, deal and note", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ref-1", error: null });
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(client()) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1", notes: "Q3 referral" });
    expect(rpcMock).toHaveBeenCalledWith("refer_deal_to_partner", {
      p_partner_id: "p-1", p_deal_id: "d-1", p_note: "Q3 referral",
    });
  });

  it("sends an empty note when none is given", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ref-1", error: null });
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(client()) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });
    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({ p_note: "" });
  });

  it("invalidates partners and referrals on success", async () => {
    rpcMock.mockResolvedValueOnce({ data: "ref-1", error: null });
    const c = client();
    const spy = vi.spyOn(c, "invalidateQueries");
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(c) });
    await result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it("refuses when not signed in", async () => {
    authUserId = undefined;
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(client()) });
    await expect(result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" })).rejects.toThrow("Not signed in");
  });

  it("maps server errors to friendly copy", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "deal_not_visible" } });
    const { result } = renderHook(() => useReferDeal(), { wrapper: wrap(client()) });
    await expect(result.current.mutateAsync({ partnerId: "p-1", dealId: "d-1" })).rejects.toThrow("You can't see that deal.");
  });
});
