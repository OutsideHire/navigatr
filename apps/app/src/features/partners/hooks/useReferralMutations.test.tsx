import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAcceptReferral, useDeclineReferral, useLogReferral, useMergeReferral } from "./useReferralMutations";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

function setup() {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(c, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={c}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

beforeEach(() => rpcMock.mockReset());

describe("useLogReferral", () => {
  it("calls log_referral with trimmed optional fields as null", async () => {
    rpcMock.mockResolvedValueOnce({ data: "r-9", error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useLogReferral(), { wrapper });
    const id = await result.current.mutateAsync({ partnerId: "p-1", companyName: " Fresh Bakery ", contactPhone: " ", notes: "hi" });
    expect(id).toBe("r-9");
    expect(rpcMock).toHaveBeenCalledWith("log_referral", {
      p_partner_id: "p-1", p_company_name: "Fresh Bakery", p_contact_name: null,
      p_contact_email: null, p_contact_phone: null, p_address: null, p_notes: "hi",
    });
  });
});

describe("useAcceptReferral", () => {
  it("returns accepted with the new deal id and refreshes deals, partners, referrals", async () => {
    rpcMock.mockResolvedValueOnce({ data: { result: "accepted", deal_id: "d-1" }, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).resolves.toEqual({ result: "accepted", dealId: "d-1" });
    expect(rpcMock).toHaveBeenCalledWith("accept_referral", { p_referral_id: "r-1" });
    await waitFor(() => expect(spy.mock.calls.map((x) => x[0]?.queryKey)).toEqual([
      ["referrals"], ["partners", "list", "user-1"], ["deals", "list", "user-1"],
    ]));
  });

  it("returns duplicate without a deal id when the match is not visible", async () => {
    rpcMock.mockResolvedValueOnce({ data: { result: "duplicate", deal_id: null }, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).resolves.toEqual({ result: "duplicate", dealId: null });
  });

  it("maps errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "referral_not_submitted" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).rejects.toThrow("This referral was already handled.");
  });
});

describe("useDeclineReferral", () => {
  it("calls decline_referral with reason and note", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeclineReferral(), { wrapper });
    await result.current.mutateAsync({ referralId: "r-1", reason: "outside_icp", note: "Too big" });
    expect(rpcMock).toHaveBeenCalledWith("decline_referral", { p_referral_id: "r-1", p_reason: "outside_icp", p_note: "Too big" });
  });
});

describe("useMergeReferral", () => {
  it("calls merge_referral", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeReferral(), { wrapper });
    await result.current.mutateAsync({ referralId: "r-1", dealId: "d-7" });
    expect(rpcMock).toHaveBeenCalledWith("merge_referral", { p_referral_id: "r-1", p_deal_id: "d-7" });
  });

  it("maps already_linked", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "already_linked" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1", dealId: "d-7" })).rejects.toThrow("That deal is already linked to this partner.");
  });
});
