// Tests useMeetingStops (Slice 5A), the thin composer that fetches today's
// scheduled appointments + external calendar waypoints and derives the pure
// `assembleMeetingStops` list. We stub @/lib/supabase (a chainable `from`
// builder + `functions.invoke`) and useAuth so no network is hit, same style
// as useCalendarEvents.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useMeetingStops } from "./useMeetingStops";
import type { ScheduledAppointmentRow } from "@/features/appointments/types";

// ── Mocks ──────────────────────────────────────────────────────────
const orderMock = vi.fn(); // terminal of the appointments read
const invokeMock = vi.fn(); // read_calendar_events

vi.mock("@/lib/supabase", () => {
  const builder = {
    select: () => builder,
    neq: () => builder,
    gte: () => builder,
    lt: () => builder,
    order: (...args: unknown[]) => orderMock(...args),
  };
  return {
    supabase: {
      from: () => builder,
      functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    },
  };
});

vi.mock("@/stores/auth", () => ({
  useAuth: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "rep-1" } }),
}));

// Mock the deals cache the hook joins against. A hoisted ref lets each test
// seed the deal list before rendering (the factory is hoisted above imports,
// so it must not close over a plain top-level variable).
const dealsRef = vi.hoisted(() => ({
  current: [] as Array<{ id: string; companyName: string }>,
}));
vi.mock("@/features/pipeline/hooks/useDeals", () => ({
  useDeals: () => ({ data: dealsRef.current }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function makeApptRow(overrides: Partial<ScheduledAppointmentRow> = {}): ScheduledAppointmentRow {
  return {
    id: "appt-1",
    deal_id: "deal-1",
    owner_id: "rep-1",
    title: "Acme demo",
    start_at: "2026-08-08T10:00:00Z",
    end_at: "2026-08-08T11:00:00Z",
    location_address: "1 Main St",
    location_lat: 40.1,
    location_lng: -74.1,
    notes: null,
    status: "scheduled",
    calendar_event_id: "cal-appt-1",
    calendar_sync_status: "synced",
    calendar_sync_error: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

const NOW = "2026-08-08T08:00:00Z";
const PATH_DATE = "2026-08-08";

beforeEach(() => {
  orderMock.mockReset();
  invokeMock.mockReset();
  dealsRef.current = [];
});

// A calendar read that returns no external waypoints, so the assembled stops
// are exactly the appointments under test.
function noWaypoints() {
  invokeMock.mockResolvedValue({
    data: { status: "ok", waypoints: [], timeBlocks: [], skippedCount: 0 },
    error: null,
  });
}

describe("useMeetingStops", () => {
  it("composes appointments + external waypoints into time-ordered stops", async () => {
    orderMock.mockResolvedValue({ data: [makeApptRow()], error: null });
    invokeMock.mockResolvedValue({
      data: {
        status: "ok",
        waypoints: [
          {
            id: "wp-9",
            title: "Dentist",
            start: "2026-08-08T09:00:00Z",
            end: "2026-08-08T09:30:00Z",
            address: "22 Oak Ave",
            lat: 41.0,
            lng: -75.0,
            source: "calendar",
          },
        ],
        timeBlocks: [],
        skippedCount: 0,
      },
      error: null,
    });

    const { result } = renderHook(() => useMeetingStops(PATH_DATE, NOW), { wrapper });
    await waitFor(() => expect(result.current.stops).toHaveLength(2));
    expect(result.current.stops.map((s) => s.id)).toEqual(["wp-9", "appt-1"]);
    expect(result.current.status).toBe("ok");
  });

  it("de-dups a mirrored appointment (waypoint.id === calendar_event_id)", async () => {
    orderMock.mockResolvedValue({ data: [makeApptRow()], error: null });
    invokeMock.mockResolvedValue({
      data: {
        status: "ok",
        waypoints: [
          {
            id: "cal-appt-1", // the mirror of appt-1
            title: "Acme demo (from Google)",
            start: "2026-08-08T10:00:00Z",
            end: "2026-08-08T11:00:00Z",
            address: "1 Main St",
            lat: 40.1,
            lng: -74.1,
            source: "calendar",
          },
        ],
        timeBlocks: [],
        skippedCount: 0,
      },
      error: null,
    });

    const { result } = renderHook(() => useMeetingStops(PATH_DATE, NOW), { wrapper });
    await waitFor(() => expect(result.current.stops).toHaveLength(1));
    expect(result.current.stops[0]).toMatchObject({ kind: "appointment", appointmentId: "appt-1" });
  });

  it("surfaces the calendar reconnect status while still returning appointments", async () => {
    orderMock.mockResolvedValue({ data: [makeApptRow()], error: null });
    invokeMock.mockResolvedValue({ data: null, error: new Error("boom") });

    const { result } = renderHook(() => useMeetingStops(PATH_DATE, NOW), { wrapper });
    await waitFor(() => expect(result.current.stops).toHaveLength(1));
    expect(result.current.status).toBe("needs_reconnect");
    expect(result.current.stops[0].kind).toBe("appointment");
  });

  it("joins the deal name onto an appointment when its dealId is in the deals cache", async () => {
    dealsRef.current = [{ id: "deal-1", companyName: "Acme Payments" }];
    orderMock.mockResolvedValue({ data: [makeApptRow({ deal_id: "deal-1" })], error: null });
    noWaypoints();

    const { result } = renderHook(() => useMeetingStops(PATH_DATE, NOW), { wrapper });
    await waitFor(() => expect(result.current.stops).toHaveLength(1));
    const stop = result.current.stops[0];
    expect(stop).toMatchObject({ appointmentId: "appt-1", dealId: "deal-1" });
    expect(stop.dealName).toBe("Acme Payments");
  });

  it("leaves dealName null when the appointment's dealId misses the cache or is absent", async () => {
    // Cache holds a different deal, so neither appointment can resolve a name:
    // one whose dealId is present-but-absent from the cache, one with a falsy
    // (empty) dealId that skips the lookup entirely.
    dealsRef.current = [{ id: "deal-1", companyName: "Acme Payments" }];
    orderMock.mockResolvedValue({
      data: [
        makeApptRow({ id: "appt-miss", deal_id: "deal-404", start_at: "2026-08-08T10:00:00Z" }),
        makeApptRow({ id: "appt-null", deal_id: "", start_at: "2026-08-08T11:00:00Z" }),
      ],
      error: null,
    });
    noWaypoints();

    const { result } = renderHook(() => useMeetingStops(PATH_DATE, NOW), { wrapper });
    await waitFor(() => expect(result.current.stops).toHaveLength(2));
    const byId = new Map(result.current.stops.map((s) => [s.appointmentId, s]));
    expect(byId.get("appt-miss")?.dealName).toBeNull();
    expect(byId.get("appt-null")?.dealName).toBeNull();
  });
});
