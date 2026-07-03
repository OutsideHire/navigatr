// Tests the Calendar-Aware Path (Slice 1) data source:
//   - useCalendarEvents: window-gating, read_calendar_events wiring, the
//     non-blocking error fallback (calendar failure must never break Path).
//
// We stub @/lib/supabase (functions.invoke) so no network is hit — same
// approach as useMerchants.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useCalendarEvents,
  type CalendarWaypoint,
  type CalendarTimeBlock,
} from "./useCalendarEvents";

// ── Mocks ──────────────────────────────────────────────────────────
const invokeMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeWaypoint(overrides: Partial<CalendarWaypoint> = {}): CalendarWaypoint {
  return {
    id: "wp-1",
    title: "Coffee with Dana",
    start: "2026-07-03T09:00:00Z",
    end: "2026-07-03T09:30:00Z",
    address: "123 Congress Ave",
    lat: 30.2672,
    lng: -97.7431,
    source: "calendar",
    ...overrides,
  };
}

function makeTimeBlock(overrides: Partial<CalendarTimeBlock> = {}): CalendarTimeBlock {
  return {
    id: "tb-1",
    title: "Team standup",
    start: "2026-07-03T10:00:00Z",
    end: "2026-07-03T10:15:00Z",
    reason: "no_location",
    ...overrides,
  };
}

const WINDOW = { start: "2026-07-03T00:00:00Z", end: "2026-07-03T23:59:59Z" };

beforeEach(() => {
  invokeMock.mockReset();
});

describe("useCalendarEvents", () => {
  it("does not fetch while window is null", () => {
    const { result } = renderHook(() => useCalendarEvents(null), { wrapper });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.current.waypoints).toEqual([]);
    expect(result.current.timeBlocks).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("calls read_calendar_events with the window body and exposes the results", async () => {
    invokeMock.mockResolvedValue({
      data: {
        status: "ok",
        waypoints: [makeWaypoint({ id: "a" }), makeWaypoint({ id: "b" })],
        timeBlocks: [makeTimeBlock()],
        skippedCount: 0,
      },
      error: null,
    });
    const { result } = renderHook(() => useCalendarEvents(WINDOW), { wrapper });
    await waitFor(() => expect(result.current.waypoints).toHaveLength(2));
    expect(invokeMock).toHaveBeenCalledWith("read_calendar_events", {
      body: { window_start: WINDOW.start, window_end: WINDOW.end },
    });
    expect(result.current.status).toBe("ok");
    expect(result.current.waypoints.map((w) => w.id)).toEqual(["a", "b"]);
    expect(result.current.timeBlocks).toHaveLength(1);
    expect(result.current.isError).toBe(false);
  });

  it("degrades to needs_reconnect with empty arrays when invoke errors (no throw)", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("boom") });
    const { result } = renderHook(() => useCalendarEvents(WINDOW), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("needs_reconnect"));
    expect(result.current.waypoints).toEqual([]);
    expect(result.current.timeBlocks).toEqual([]);
    // Non-blocking: the query resolved successfully, it did not error out.
    expect(result.current.isError).toBe(false);
  });
});
