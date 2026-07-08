// Tests the Supabase→Deal mapping and React Query plumbing. RLS itself is
// a server-side concern — verified separately in the SQL editor with a
// cross-tenant smoke test. Here we cover: shape mapping, empty result,
// error propagation, and that the hook stays disabled until auth resolves
// (so we don't fire `id=eq.undefined` queries).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useDeals } from "./useDeals";

// ---- mocks ----

const orderMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: (col: string, opts: { ascending: boolean }) => orderMock(col, opts),
      }),
    }),
  },
}));

let authUserId: string | undefined;
vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: authUserId ? { id: authUserId } : null }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  orderMock.mockReset();
  authUserId = "user-1";
});

describe("useDeals", () => {
  it("maps Supabase rows to the frontend Deal shape", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "deal-1",
          company_name: "Acme",
          contact_name: "Jane",
          contact_phone: "+12025550100",
          contact_email: "j@acme.com",
          value_cents: 1_200_000,
          stage: "qualified",
          probability: 55,
          last_activity_at: "2026-05-18T12:00:00Z",
          next_followup_at: null,
          employee_count_range: "11-50",
          lead_source: "Partner referral",
          updated_at: "2026-05-19T08:00:00Z",
          owner_id: null,
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useDeals(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      {
        id: "deal-1",
        companyName: "Acme",
        contactName: "Jane",
        phone: "+12025550100",
        email: "j@acme.com",
        valueCents: 1_200_000,
        stage: "qualified",
        probability: 55,
        lastActivity: "2026-05-18T12:00:00Z",
        nextFollowup: null,
        employeeCountRange: "11-50",
        leadSource: "Partner referral",
        updatedAt: "2026-05-19T08:00:00Z",
        owner_id: null,
        professionData: null,
        // Absent on the row → mapper defaults it to null (not undefined),
        // so toEqual needs it spelled out explicitly here.
        followupCalendarSyncStatus: null,
      },
    ]);
  });

  it("maps followup_calendar_sync_status through to followupCalendarSyncStatus", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "deal-3",
          company_name: "Synced Co",
          contact_name: "S",
          contact_phone: "+12025550001",
          contact_email: "s@c.co",
          value_cents: 500_000,
          stage: "proposal",
          probability: 75,
          last_activity_at: "2026-05-18T12:00:00Z",
          next_followup_at: "2026-05-25T12:00:00Z",
          employee_count_range: "1-10",
          lead_source: "Cold call",
          updated_at: "2026-05-19T08:00:00Z",
          owner_id: null,
          followup_calendar_sync_status: "error",
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => useDeals(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].followupCalendarSyncStatus).toBe("error");
  });

  it("returns an empty array when there are no deals", async () => {
    orderMock.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useDeals(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("surfaces Supabase errors via React Query's isError", async () => {
    orderMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for table deals" },
    });
    const { result } = renderHook(() => useDeals(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    // We throw the raw Supabase error object — React Query stores it.
    // The shape matters less than the fact that ProtectedRoute / the
    // page can detect failure and not loop.
    expect(result.current.error).toBeTruthy();
  });

  it("stays disabled until a user id is available (no anon queries fired)", () => {
    authUserId = undefined;
    const { result } = renderHook(() => useDeals(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(orderMock).not.toHaveBeenCalled();
  });

  it("coerces nullable employee_count_range to empty string", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "deal-2",
          company_name: "Bare Co",
          contact_name: "X",
          contact_phone: "+12025550000",
          contact_email: "x@b.co",
          value_cents: 0,
          stage: "new",
          probability: 20,
          last_activity_at: null,
          next_followup_at: null,
          employee_count_range: null,
          lead_source: null,
          updated_at: "2026-05-19T08:00:00Z",
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => useDeals(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].employeeCountRange).toBe("");
    // Null lead_source coerces to empty string (the "Other" bucket on
    // the dashboard's lead-sources breakdown).
    expect(result.current.data?.[0].leadSource).toBe("");
    // Null last_activity_at falls back to a real ISO string (not null) so
    // the relative-date formatter doesn't crash.
    expect(result.current.data?.[0].lastActivity).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
