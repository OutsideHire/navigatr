import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useReferralQueue } from "./useReferralQueue";

const orderMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "referrals") throw new Error(`unexpected table ${table}`);
      return { select: (...a: unknown[]) => { selectMock(...a); return { eq: (...e: unknown[]) => { eqMock(...e); return { eq: (...e2: unknown[]) => { eqMock(...e2); return { eq: (...e3: unknown[]) => { eqMock(...e3); return { order: orderMock }; } }; } }; } }; } };
    },
  },
}));
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) => selector({ user: { id: "user-1" } }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => { orderMock.mockReset(); eqMock.mockReset(); selectMock.mockReset(); });

describe("useReferralQueue", () => {
  it("loads submitted inbound referrals oldest first and maps them", async () => {
    orderMock.mockResolvedValueOnce({
      data: [{
        id: "r-1", partner_id: "p-1", company_name: "Fresh Bakery", contact_name: "Ann",
        contact_email: null, contact_phone: "+15550001", address: "5 Oak St", place_id: null,
        notes: "Wants a demo", submitted_at: "2026-10-07T12:00:00Z", assigned_user_id: "user-1",
        partner: { name: "Jane", company: "Jane & Co" },
      }],
      error: null,
    });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqMock.mock.calls).toEqual([["status", "submitted"], ["direction", "inbound"], ["can_triage", true]]);
    expect(orderMock).toHaveBeenCalledWith("submitted_at", { ascending: true });
    expect(result.current.data).toEqual([{
      id: "r-1", partnerId: "p-1", partnerName: "Jane", partnerCompany: "Jane & Co",
      companyName: "Fresh Bakery", contactName: "Ann", contactEmail: null, contactPhone: "+15550001",
      address: "5 Oak St", placeId: null, notes: "Wants a demo",
      submittedAt: "2026-10-07T12:00:00Z", assignedUserId: "user-1",
      source: "rep_entered", duplicateOfReferralId: null, duplicateOfDealId: null, urgency: null,
      icpFlags: [],
    }]);
  });

  it("carries the portal source and the duplicate flags", async () => {
    orderMock.mockResolvedValueOnce({
      data: [{
        id: "r-3", partner_id: "p-1", company_name: "Corner Cafe", contact_name: "Ann",
        contact_email: null, contact_phone: "5550100001", address: null, place_id: null,
        notes: "", submitted_at: "2026-10-12T12:00:00Z", assigned_user_id: "user-1",
        source: "portal_signed_in", duplicate_of_referral_id: "r-1", duplicate_of_deal_id: "d-1",
        urgency: "this_month",
        partner: { name: "Jane", company: "Jane & Co" },
      }],
      error: null,
    });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(selectMock.mock.calls[0][0]).toContain("source, duplicate_of_referral_id, duplicate_of_deal_id");
    expect(selectMock.mock.calls[0][0]).toContain("urgency");
    expect(result.current.data?.[0]).toMatchObject({
      source: "portal_signed_in", duplicateOfReferralId: "r-1", duplicateOfDealId: "d-1", urgency: "this_month",
    });
  });

  it("falls back to the partner snapshot when the partner embed is hidden", async () => {
    orderMock.mockResolvedValueOnce({
      data: [{
        id: "r-2", partner_id: "p-9", company_name: "Hidden Co", contact_name: null,
        contact_email: null, contact_phone: null, address: null, place_id: null,
        notes: "", submitted_at: "2026-10-07T12:00:00Z", assigned_user_id: null,
        partner_company_snapshot: "Snap & Co", partner: null,
      }],
      error: null,
    });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ partnerName: "", partnerCompany: "Snap & Co" });
  });

  it("throws the query error", async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
  it("carries the advisory ICP flags", async () => {
    orderMock.mockResolvedValueOnce({
      data: [{
        id: "r-4", partner_id: "p-1", company_name: "Subway #12", contact_name: "Ann",
        contact_email: null, contact_phone: "5550100001", address: null, place_id: null,
        notes: "", submitted_at: "2026-10-12T12:00:00Z", assigned_user_id: "user-1",
        icp_flags: ["chain:Subway"],
        partner: { name: "Jane", company: "Jane & Co" },
      }],
      error: null,
    });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(selectMock.mock.calls[0][0]).toContain("icp_flags");
    expect(result.current.data?.[0].icpFlags).toEqual(["chain:Subway"]);
  });
});
