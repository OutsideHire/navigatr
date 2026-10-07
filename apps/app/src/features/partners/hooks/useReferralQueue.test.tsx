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
      return { select: (...a: unknown[]) => { selectMock(...a); return { eq: (...e: unknown[]) => { eqMock(...e); return { eq: (...e2: unknown[]) => { eqMock(...e2); return { order: orderMock }; } }; } }; } };
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
    expect(eqMock.mock.calls).toEqual([["status", "submitted"], ["direction", "inbound"]]);
    expect(orderMock).toHaveBeenCalledWith("submitted_at", { ascending: true });
    expect(result.current.data).toEqual([{
      id: "r-1", partnerId: "p-1", partnerName: "Jane", partnerCompany: "Jane & Co",
      companyName: "Fresh Bakery", contactName: "Ann", contactEmail: null, contactPhone: "+15550001",
      address: "5 Oak St", placeId: null, notes: "Wants a demo",
      submittedAt: "2026-10-07T12:00:00Z", assignedUserId: "user-1",
    }]);
  });

  it("throws the query error", async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useReferralQueue(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
