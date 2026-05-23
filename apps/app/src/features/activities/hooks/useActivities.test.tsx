// Covers the Supabase row → Activity shape mapping, the disabled state
// (no userId or no dealId), and error propagation. The cache key shape
// is pinned by useLogActivity's invalidate call, so an accidental
// rename here would silently break that hook's "refetch after log"
// guarantee.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useActivities, ACTIVITIES_QUERY_KEY } from "./useActivities";

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
  selectMock.mockClear();
  eqMock.mockClear();
  authUserId = "user-1";
});

describe("useActivities", () => {
  it("maps Supabase rows to the frontend Activity shape", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "act-1",
          deal_id: "deal-1",
          type: "call",
          disposition: "positive_engagement",
          duration_minutes: 23,
          outcome_notes: "Good chat",
          occurred_at: "2026-05-18T12:00:00Z",
          follow_up_date: "2026-05-22",
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useActivities("deal-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        id: "act-1",
        dealId: "deal-1",
        type: "call",
        disposition: "positive_engagement",
        durationMinutes: 23,
        outcomeNotes: "Good chat",
        occurredAt: "2026-05-18T12:00:00Z",
        // DB date string → ISO midnight UTC
        followUpDate: "2026-05-22T00:00:00.000Z",
        loggedBy: null,
      },
    ]);
  });

  it("null follow_up_date stays null after mapping", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "act-2",
          deal_id: "deal-1",
          type: "email",
          disposition: "dm_unavailable",
          duration_minutes: null,
          outcome_notes: "",
          occurred_at: "2026-05-19T00:00:00Z",
          follow_up_date: null,
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => useActivities("deal-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].followUpDate).toBeNull();
  });

  it("disabled when no dealId", () => {
    const { result } = renderHook(() => useActivities(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(orderMock).not.toHaveBeenCalled();
  });

  it("disabled when not signed in", () => {
    authUserId = undefined;
    const { result } = renderHook(() => useActivities("deal-1"), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(orderMock).not.toHaveBeenCalled();
  });

  it("surfaces Supabase errors via isError (so the page can show a terminal error, not loop)", async () => {
    orderMock.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied for activities" },
    });
    const { result } = renderHook(() => useActivities("deal-1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  // Cache-key contract: useLogActivity invalidates this exact shape.
  // Changing either side without the other silently breaks the
  // "refetch after log" guarantee.
  it("cache key shape is ['activities', 'byDeal', userId, dealId]", () => {
    expect(ACTIVITIES_QUERY_KEY("u-1", "d-1")).toEqual(["activities", "byDeal", "u-1", "d-1"]);
    expect(ACTIVITIES_QUERY_KEY(undefined, "d-1")).toEqual(["activities", "byDeal", "anon", "d-1"]);
  });
});
