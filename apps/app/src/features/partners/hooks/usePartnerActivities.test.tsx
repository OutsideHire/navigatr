// Maps Supabase rows → frontend PartnerTouch shape. Pins the cache-key
// contract that useLogPartnerTouch relies on for invalidation.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { usePartnerActivities, PARTNER_ACTIVITIES_QUERY_KEY } from "./usePartnerActivities";

const orderMock = vi.fn();
const eqMock = vi.fn(() => ({ order: orderMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
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
  eqMock.mockClear();
  selectMock.mockClear();
  authUserId = "user-1";
});

describe("usePartnerActivities", () => {
  it("maps row → camelCase, converts DATE follow_up to ISO midnight UTC", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "t-1",
          partner_id: "p-1",
          type: "call",
          notes: "Quarterly sync",
          duration_minutes: 23,
          occurred_at: "2026-05-21T15:00:00Z",
          follow_up_date: "2026-06-04",
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePartnerActivities("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        id: "t-1",
        partnerId: "p-1",
        type: "call",
        notes: "Quarterly sync",
        durationMinutes: 23,
        occurredAt: "2026-05-21T15:00:00Z",
        followUpDate: "2026-06-04T00:00:00.000Z",
      },
    ]);
  });

  it("null follow_up_date stays null after mapping", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "t-2",
          partner_id: "p-1",
          type: "note",
          notes: "FYI",
          duration_minutes: null,
          occurred_at: "2026-05-21T15:00:00Z",
          follow_up_date: null,
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => usePartnerActivities("p-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].followUpDate).toBeNull();
  });

  it("disabled when no partnerId", () => {
    const { result } = renderHook(() => usePartnerActivities(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(orderMock).not.toHaveBeenCalled();
  });

  it("disabled when not signed in", () => {
    authUserId = undefined;
    const { result } = renderHook(() => usePartnerActivities("p-1"), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(orderMock).not.toHaveBeenCalled();
  });

  it("cache key shape — useLogPartnerTouch invalidates this exact pattern", () => {
    expect(PARTNER_ACTIVITIES_QUERY_KEY("u-1", "p-1")).toEqual([
      "partnerActivities", "byPartner", "u-1", "p-1",
    ]);
    expect(PARTNER_ACTIVITIES_QUERY_KEY(undefined, "p-1")).toEqual([
      "partnerActivities", "byPartner", "anon", "p-1",
    ]);
  });
});
