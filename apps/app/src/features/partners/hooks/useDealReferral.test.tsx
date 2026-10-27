import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useDealReferral } from "./useDealReferral";

const maybeSingleMock = vi.fn();
const rpcMock = vi.fn();
const calls: unknown[][] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: () => {
      const chain = {
        select: (...a: unknown[]) => { calls.push(["select", ...a]); return chain; },
        eq: (...a: unknown[]) => { calls.push(["eq", ...a]); return chain; },
        not: (...a: unknown[]) => { calls.push(["not", ...a]); return chain; },
        order: (...a: unknown[]) => { calls.push(["order", ...a]); return chain; },
        limit: (...a: unknown[]) => { calls.push(["limit", ...a]); return chain; },
        maybeSingle: maybeSingleMock,
      };
      return chain;
    },
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => { maybeSingleMock.mockReset(); rpcMock.mockReset(); calls.length = 0; });

describe("useDealReferral", () => {
  it("returns the earliest live inbound referral for the deal", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "r-1", partner_id: "p-1", partner_company_snapshot: "Jane & Co", partner: { name: "Jane", company: "Jane & Co" } }, error: null,
    });
    const { result } = renderHook(() => useDealReferral("d-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      referralId: "r-1", partnerId: "p-1", partnerVisible: true, partnerName: "Jane",
      partnerCompany: "Jane & Co", partnerCompanySnapshot: "Jane & Co",
    });
    expect(calls).toContainEqual(["eq", "deal_id", "d-1"]);
    expect(calls).toContainEqual(["eq", "direction", "inbound"]);
    expect(calls).toContainEqual(["not", "status", "in", "(declined,withdrawn)"]);
    // A visible partner comes through the embed; no extra lookup.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("still names a partner the viewer cannot open, read-only (FR-PORT-55)", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "r-4", partner_id: "p-4", partner_company_snapshot: "Old Snap", partner: null }, error: null,
    });
    rpcMock.mockResolvedValueOnce({
      data: [{ referral_id: "r-4", partner_id: "p-4", name: "Jane CPA", company: "Jane & Co", visible: false }],
      error: null,
    });
    const { result } = renderHook(() => useDealReferral("d-4"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith("referral_partner_names", { p_referral_ids: ["r-4"] });
    expect(result.current.data).toEqual({
      referralId: "r-4", partnerId: "p-4", partnerVisible: false, partnerName: "Jane CPA",
      partnerCompany: "Jane & Co", partnerCompanySnapshot: "Old Snap",
    });
  });

  it("marks the partner not visible when the embed is hidden and no name comes back", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { id: "r-3", partner_id: "p-3", partner_company_snapshot: "Snap & Co", partner: null }, error: null,
    });
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useDealReferral("d-3"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      referralId: "r-3", partnerId: "p-3", partnerVisible: false, partnerName: null,
      partnerCompany: null, partnerCompanySnapshot: "Snap & Co",
    });
  });

  it("returns null when the deal has no referral", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const { result } = renderHook(() => useDealReferral("d-2"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not run without a deal id", () => {
    const { result } = renderHook(() => useDealReferral(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
