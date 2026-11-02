// Covers the Supabase row → Activity shape mapping, the disabled state
// (no userId or no dealId), and error propagation. The cache key shape
// is pinned by useLogActivity's invalidate call, so an accidental
// rename here would silently break that hook's "refetch after log"
// guarantee.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useActivities,
  useMyActivityHistory,
  ACTIVITIES_QUERY_KEY,
  ACTIVITIES_ORG_QUERY_KEY,
  MY_ACTIVITY_HISTORY_QUERY_KEY,
} from "./useActivities";

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
        // DB date string → ISO NOON UTC (tz-stable calendar day)
        followUpDate: "2026-05-22T12:00:00.000Z",
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

/**
 * The Activities History tab shows only what the viewer logged (PRD 6.12.C
 * FR-ACT-26). The filter has to be IN the request: RLS returns every activity on
 * the viewer's deals (right for the deal record), so dropping this .eq would put
 * colleagues' visits back in a rep's History without any test on the page
 * noticing, because the page only renders what the hook hands it.
 */
describe("useMyActivityHistory", () => {
  it("asks the server for the viewer's own activities only, newest first", async () => {
    orderMock.mockResolvedValueOnce({
      data: [
        {
          id: "a-1",
          deal_id: "deal-1",
          type: "call",
          disposition: "no_answer",
          duration_minutes: null,
          outcome_notes: "",
          occurred_at: "2026-11-01T15:00:00Z",
          follow_up_date: null,
          logged_by: "user-1",
          voice_note_url: null,
        },
      ],
      error: null,
    });
    const { result } = renderHook(() => useMyActivityHistory(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(eqMock).toHaveBeenCalledWith("logged_by", "user-1");
    expect(orderMock).toHaveBeenCalledWith("occurred_at", { ascending: false });
    expect(result.current.data?.[0]).toMatchObject({ id: "a-1", loggedBy: "user-1" });
  });

  it("does not query when signed out (no id to filter on)", () => {
    authUserId = undefined;
    const { result } = renderHook(() => useMyActivityHistory(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(eqMock).not.toHaveBeenCalled();
  });

  it("surfaces Supabase errors via isError", async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useMyActivityHistory(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  // Every mutation invalidates ACTIVITIES_ORG_QUERY_KEY. React Query matches by
  // prefix, so History refreshes after a log, edit or delete only while its key
  // starts with that one.
  it("cache key extends the org list key, so the existing invalidations refresh it", () => {
    expect(MY_ACTIVITY_HISTORY_QUERY_KEY("u-1").slice(0, 3)).toEqual([...ACTIVITIES_ORG_QUERY_KEY("u-1")]);
    expect(MY_ACTIVITY_HISTORY_QUERY_KEY("u-1")).toEqual(["activities", "list", "u-1", "mine"]);
  });
});
