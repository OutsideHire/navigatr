import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { fetchReferralPartnerNames, useReferralPartnerNames } from "./useReferralPartnerNames";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => { rpcMock.mockReset(); });

describe("fetchReferralPartnerNames", () => {
  it("asks for every id in one call and keys the result by referral", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        { referral_id: "r-1", partner_id: "p-1", name: "Jane CPA", company: "Jane & Co", visible: false },
        { referral_id: "r-2", partner_id: "p-2", name: "Pat CPA", company: "Pat & Co", visible: true },
      ],
      error: null,
    });
    const names = await fetchReferralPartnerNames(["r-1", "r-2", "r-3"]);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("referral_partner_names", { p_referral_ids: ["r-1", "r-2", "r-3"] });
    expect(names.get("r-1")).toEqual({ partnerId: "p-1", name: "Jane CPA", company: "Jane & Co", visible: false });
    expect(names.get("r-2")?.visible).toBe(true);
    expect(names.has("r-3")).toBe(false);
  });

  it("skips the call when there is nothing to look up", async () => {
    const names = await fetchReferralPartnerNames([]);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(names.size).toBe(0);
  });

  it("throws the RPC error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(fetchReferralPartnerNames(["r-1"])).rejects.toEqual({ message: "boom" });
  });
});

describe("useReferralPartnerNames", () => {
  it("loads the names for a batch of referrals", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ referral_id: "r-1", partner_id: "p-1", name: "Jane CPA", company: "Jane & Co", visible: false }],
      error: null,
    });
    const { result } = renderHook(() => useReferralPartnerNames(["r-1"]), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get("r-1")?.name).toBe("Jane CPA");
  });

  it("does not run for an empty batch", () => {
    const { result } = renderHook(() => useReferralPartnerNames([]), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
