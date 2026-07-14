// Pins the Supabase row → Partner shape mapping (especially the nested
// partner_deals → attributedDealIds flattening), the cache-key shape
// useCreatePartner relies on for invalidation, and the disabled state
// when no userId is available.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { usePartners, PARTNERS_QUERY_KEY } from "./usePartners";

const orderMock = vi.fn();
const selectMock = vi.fn(() => ({ order: orderMock }));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: selectMock }) },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  orderMock.mockReset();
  selectMock.mockClear();
  authUserId = "user-1";
});

describe("usePartners", () => {
  it("maps Supabase rows to the frontend Partner shape, flattening attribution", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "p-1",
          name: "Sarah Johnson",
          company: "Johnson & Boyle CPAs",
          type: "cpa",
          status: "active",
          phone: "+12025550101",
          email: "sarah@johnson.com",
          city: "Austin, TX",
          last_touch_at: "2026-05-17T00:00:00Z",
          next_followup_at: "2026-05-22T00:00:00Z",
          notes: "Best CPA in network",
          created_by: "creator-9",
          partner_deals: [
            { deal_id: "d-206", direction: "inbound" },
            { deal_id: "d-301", direction: "inbound" },
            // Outbound link (we referred a deal TO this partner) must be
            // excluded from attribution.
            { deal_id: "d-999", direction: "outbound" },
          ],
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePartners(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        id: "p-1",
        name: "Sarah Johnson",
        company: "Johnson & Boyle CPAs",
        type: "cpa",
        status: "active",
        phone: "+12025550101",
        email: "sarah@johnson.com",
        city: "Austin, TX",
        lastTouch: "2026-05-17T00:00:00Z",
        nextFollowup: "2026-05-22T00:00:00Z",
        attributedDealIds: ["d-206", "d-301"],
        outboundDealIds: ["d-999"],
        notes: "Best CPA in network",
        createdBy: "creator-9",
      },
    ]);
    // Outbound links are excluded from attribution (inbound-only).
    expect(result.current.data?.[0].attributedDealIds).not.toContain("d-999");
  });

  it("splits partner_deals into inbound attribution and outbound referrals", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "p-3",
          name: "Split",
          company: "Split Co",
          type: "cpa",
          status: "active",
          phone: null,
          email: null,
          city: null,
          last_touch_at: null,
          next_followup_at: null,
          notes: "",
          partner_deals: [
            { deal_id: "in1", direction: "inbound" },
            { deal_id: "out1", direction: "outbound" },
            // No direction → treated as inbound.
            { deal_id: "in2" },
          ],
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePartners(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].attributedDealIds).toEqual(["in1", "in2"]);
    expect(result.current.data?.[0].outboundDealIds).toEqual(["out1"]);
  });

  it("partner with no attributed deals produces empty attributedDealIds (not undefined)", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "p-2",
          name: "X",
          company: "X",
          type: "other",
          status: "cooling",
          phone: null,
          email: null,
          city: null,
          last_touch_at: null,
          next_followup_at: null,
          notes: "",
          partner_deals: null,
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePartners(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].attributedDealIds).toEqual([]);
    // Nullable contact fields normalize to empty strings so consumers
    // don't have to special-case.
    expect(result.current.data?.[0].phone).toBe("");
    expect(result.current.data?.[0].email).toBe("");
    expect(result.current.data?.[0].city).toBe("");
  });

  it("disabled when not signed in (no Supabase call fires)", () => {
    authUserId = undefined;
    const { result } = renderHook(() => usePartners(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(orderMock).not.toHaveBeenCalled();
  });

  it("surfaces Supabase errors via isError", async () => {
    orderMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table partners" },
    });
    const { result } = renderHook(() => usePartners(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("maps created_by → createdBy (gates the Edit button on the detail page)", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "p-9",
          name: "Owned",
          company: "Owned Co",
          type: "cpa",
          status: "active",
          phone: null,
          email: null,
          city: null,
          last_touch_at: null,
          next_followup_at: null,
          notes: "",
          created_by: "creator-9",
          partner_deals: null,
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePartners(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].createdBy).toBe("creator-9");
  });

  it("normalizes a missing created_by to null", async () => {
    // Intentionally OMIT created_by so row.created_by is `undefined` — this is
    // what actually exercises the `?? null` in toPartner. (A row with an
    // explicit null would pass even if the coalescing were removed.)
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "p-10",
          name: "NoCreator",
          company: "NoCreator Co",
          type: "other",
          status: "active",
          phone: null,
          email: null,
          city: null,
          last_touch_at: null,
          next_followup_at: null,
          notes: "",
          partner_deals: null,
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePartners(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].createdBy).toBeNull();
  });

  it("cache key shape — useCreatePartner's invalidation depends on this", () => {
    expect(PARTNERS_QUERY_KEY("u-1")).toEqual(["partners", "list", "u-1"]);
    expect(PARTNERS_QUERY_KEY(undefined)).toEqual(["partners", "list", "anon"]);
  });
});
