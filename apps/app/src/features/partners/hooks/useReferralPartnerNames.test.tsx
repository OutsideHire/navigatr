import { describe, it, expect, vi, beforeEach } from "vitest";

import { fetchReferralPartnerNames } from "./useReferralPartnerNames";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));
const captureMock = vi.fn();
vi.mock("@/lib/observability", () => ({
  captureException: (...a: unknown[]) => captureMock(...a),
}));

beforeEach(() => { rpcMock.mockReset(); captureMock.mockReset(); });

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

  it("reports an RPC error and returns no names so screens fall back to the snapshot", async () => {
    const err = { message: "function does not exist" };
    rpcMock.mockResolvedValueOnce({ data: null, error: err });
    const names = await fetchReferralPartnerNames(["r-1"]);
    expect(names.size).toBe(0);
    expect(captureMock).toHaveBeenCalledWith(err, { action: "referrals.partner-names" });
  });
});
