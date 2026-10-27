import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useReferralQueue } from "./useReferralQueue";

const orderMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const rpcMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpcMock(...a),
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

beforeEach(() => { orderMock.mockReset(); eqMock.mockReset(); selectMock.mockReset(); rpcMock.mockReset(); });

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
    // Every partner was visible, so no name lookup.
    expect(rpcMock).not.toHaveBeenCalled();
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
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ partnerName: "", partnerCompany: "Snap & Co" });
  });

  it("still lists hidden-partner referrals with snapshot naming when the name lookup fails", async () => {
    orderMock.mockResolvedValueOnce({
      data: [{
        id: "r-8", partner_id: "p-8", company_name: "Hidden Co", contact_name: null,
        contact_email: null, contact_phone: null, address: null, place_id: null,
        notes: "", submitted_at: "2026-10-07T12:00:00Z", assigned_user_id: "user-1",
        partner_company_snapshot: "Snap & Co", partner: null,
      }],
      error: null,
    });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "function does not exist" } });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({ id: "r-8", partnerName: "", partnerCompany: "Snap & Co" });
  });

  it("names partners the viewer cannot open with one batched lookup (FR-PORT-55)", async () => {
    const hidden = (id: string) => ({
      id, partner_id: `p-${id}`, company_name: "Hidden Co", contact_name: null,
      contact_email: null, contact_phone: null, address: null, place_id: null,
      notes: "", submitted_at: "2026-10-07T12:00:00Z", assigned_user_id: "user-1",
      partner_company_snapshot: "Snap & Co", partner: null,
    });
    orderMock.mockResolvedValueOnce({
      data: [
        hidden("r-5"),
        { ...hidden("r-6"), partner: { name: "Jane", company: "Jane & Co" } },
        hidden("r-7"),
      ],
      error: null,
    });
    rpcMock.mockResolvedValueOnce({
      data: [
        { referral_id: "r-5", partner_id: "p-r-5", name: "Pat CPA", company: "Pat & Co", visible: false },
        { referral_id: "r-7", partner_id: "p-r-7", name: "Kim CPA", company: "Kim & Co", visible: false },
      ],
      error: null,
    });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("referral_partner_names", { p_referral_ids: ["r-5", "r-7"] });
    expect(result.current.data?.map((r) => [r.partnerName, r.partnerCompany])).toEqual([
      ["Pat CPA", "Pat & Co"], ["Jane", "Jane & Co"], ["Kim CPA", "Kim & Co"],
    ]);
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
