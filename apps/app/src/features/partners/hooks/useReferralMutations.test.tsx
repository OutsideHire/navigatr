import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAcceptReferral, useDeclineReferral, useLogReferral, useMergeReferral, useWithdrawReferral } from "./useReferralMutations";

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
  it("returns accepted with the new deal id and refreshes deals, partners, referrals, tasks", async () => {
    rpcMock.mockResolvedValueOnce({ data: { result: "accepted", deal_id: "d-1" }, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).resolves.toEqual({ result: "accepted", dealId: "d-1" });
    expect(rpcMock).toHaveBeenCalledWith("accept_referral", { p_referral_id: "r-1" });
    await waitFor(() => expect(spy.mock.calls.map((x) => x[0]?.queryKey)).toEqual([
      ["referrals"], ["partners", "list", "user-1"], ["deals", "list", "user-1"], ["tasks", "user-1"],
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

  it("accepts a flagged referral with a written reason through accept_referral_override", async () => {
    rpcMock.mockResolvedValueOnce({ data: { result: "accepted", deal_id: "d-2" }, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(
      result.current.mutateAsync({ referralId: "r-1", overrideReason: "  Different location " }),
    ).resolves.toEqual({ result: "accepted", dealId: "d-2" });
    expect(rpcMock).toHaveBeenCalledWith("accept_referral_override", {
      p_referral_id: "r-1",
      p_override_reason: "Different location",
    });
  });

  it("explains a missing override reason", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "override_reason_required" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAcceptReferral(), { wrapper });
    await expect(result.current.mutateAsync("r-1")).rejects.toThrow("Add a short reason to go ahead with a possible duplicate.");
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

  it("keeps the plain RPC when the partner message is blank", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeclineReferral(), { wrapper });
    await result.current.mutateAsync({ referralId: "r-1", reason: "duplicate", note: "", partnerMessage: "  \n " });
    expect(rpcMock).toHaveBeenCalledWith("decline_referral", { p_referral_id: "r-1", p_reason: "duplicate", p_note: null });
  });

  it("calls decline_referral_with_message with the trimmed partner message", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useDeclineReferral(), { wrapper });
    await result.current.mutateAsync({ referralId: "r-1", reason: "outside_icp", note: " Too big ", partnerMessage: "  Not a fit. " });
    expect(rpcMock).toHaveBeenCalledWith("decline_referral_with_message", {
      p_referral_id: "r-1", p_reason: "outside_icp", p_note: "Too big", p_partner_message: "Not a fit.",
    });
    // The message becomes a referral update: the referrals refresh covers its list.
    expect(spy).toHaveBeenCalledWith({ queryKey: ["referrals"] });
  });

  it("names a message that is too long", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "partner_message_too_long" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeclineReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1", reason: "outside_icp", partnerMessage: "x" }))
      .rejects.toThrow("Keep the message to the partner under 1,000 characters.");
  });
});

describe("useMergeReferral", () => {
  it("calls merge_referral and says it merged", async () => {
    rpcMock.mockResolvedValueOnce({ data: { result: "merged", credited_partner_name: null }, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1", dealId: "d-7" }))
      .resolves.toEqual({ result: "merged", creditedPartnerName: null });
    expect(rpcMock).toHaveBeenCalledWith("merge_referral", { p_referral_id: "r-1", p_deal_id: "d-7" });
  });

  it("merges a flagged referral with a written reason through merge_referral_override", async () => {
    rpcMock.mockResolvedValueOnce({ data: { result: "closed_duplicate", credited_partner_name: "Jane CPA" }, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1", dealId: "d-7", overrideReason: "  Same owner " }))
      .resolves.toEqual({ result: "closed_duplicate", creditedPartnerName: "Jane CPA" });
    expect(rpcMock).toHaveBeenCalledWith("merge_referral_override", {
      p_referral_id: "r-1",
      p_deal_id: "d-7",
      p_reason: "Same owner",
    });
  });

  it("treats a void result from an older database as a plain merge", async () => {
    // Deploy skew: before 20261027000003 merge_referral returned void.
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    rpcMock.mockResolvedValueOnce({ data: "", error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1", dealId: "d-7" }))
      .resolves.toEqual({ result: "merged", creditedPartnerName: null });
    await expect(result.current.mutateAsync({ referralId: "r-1", dealId: "d-7" }))
      .resolves.toEqual({ result: "merged", creditedPartnerName: null });
  });

  it("explains a missing merge reason", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "override_reason_required" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1", dealId: "d-7" }))
      .rejects.toThrow("Add a short reason to go ahead with a possible duplicate.");
  });

  it("maps already_linked", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "already_linked" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMergeReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1", dealId: "d-7" })).rejects.toThrow("That deal is already linked to this partner.");
  });
});

describe("useWithdrawReferral", () => {
  it("calls withdraw_referral with a trimmed note and refreshes referrals, partners, deals", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useWithdrawReferral(), { wrapper });
    await result.current.mutateAsync({ referralId: "r-1", note: " Partner asked by phone " });
    expect(rpcMock).toHaveBeenCalledWith("withdraw_referral", { p_referral_id: "r-1", p_note: "Partner asked by phone" });
    await waitFor(() => expect(spy.mock.calls.map((x) => x[0]?.queryKey)).toEqual([
      ["referrals"], ["partners", "list", "user-1"], ["deals", "list", "user-1"],
    ]));
  });

  it("sends a null note when none is given", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useWithdrawReferral(), { wrapper });
    await result.current.mutateAsync({ referralId: "r-1", note: "  " });
    expect(rpcMock).toHaveBeenCalledWith("withdraw_referral", { p_referral_id: "r-1", p_note: null });
  });

  it("maps errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "referral_closed" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useWithdrawReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1" })).rejects.toThrow("This referral is already closed.");
  });

  it("falls back to generic copy on an unknown error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useWithdrawReferral(), { wrapper });
    await expect(result.current.mutateAsync({ referralId: "r-1" })).rejects.toThrow("Couldn't withdraw the referral");
  });
});
