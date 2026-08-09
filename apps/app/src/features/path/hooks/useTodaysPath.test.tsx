// Tests useTodaysPath (SP-B1), the thin hook that composes the four input tiers
// from sibling hooks, adapts them to the SP-A assembler's input shapes, and
// returns the assembler's proposal/overflow. We mock the three underlying hooks
// (useMeetingStops, useOwedVisits, useMerchants) so this exercises the
// COMPOSITION/adaptation only, NOT the assembler's internal ordering (which has
// its own tests). A fixed `now` keeps every assertion deterministic.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useTodaysPath } from "./useTodaysPath";
import type { MeetingStop } from "../lib/meetingStops";
import type { OwedVisit } from "../lib/owedVisits";
import type { Merchant } from "../mockData";
import type { CalendarStatus } from "./useCalendarEvents";

// ── Mocks: the three composed hooks. Hoisted refs let each test seed the tier
//    data (and the meeting-stops status) before rendering. ─────────────────────
const meetingsRef = vi.hoisted(() => ({
  stops: [] as MeetingStop[],
  status: "ok" as CalendarStatus,
  isLoading: false,
}));
const owedRef = vi.hoisted(() => ({ owed: [] as OwedVisit[], isLoading: false }));
const dueTodayRef = vi.hoisted(() => ({ dueToday: [] as OwedVisit[], isLoading: false }));
const merchantsRef = vi.hoisted(() => ({ merchants: [] as Merchant[], isLoading: false }));

vi.mock("./useMeetingStops", () => ({
  useMeetingStops: () => ({
    stops: meetingsRef.stops,
    status: meetingsRef.status,
    isLoading: meetingsRef.isLoading,
  }),
}));
vi.mock("./useOwedVisits", () => ({
  useOwedVisits: () => ({ owed: owedRef.owed, isLoading: owedRef.isLoading }),
}));
vi.mock("./useDueTodayVisits", () => ({
  useDueTodayVisits: () => ({ dueToday: dueTodayRef.dueToday, isLoading: dueTodayRef.isLoading }),
}));
vi.mock("./useMerchants", () => ({
  useMerchants: () => ({ merchants: merchantsRef.merchants, isLoading: merchantsRef.isLoading }),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ORIGIN = { lat: 40.0, lng: -74.0 };
const NOW = "2026-08-09T15:00:00Z"; // 15:00 UTC, inside the default 9..17 window

// The local calendar day the composing hook derives from NOW. Computed the same
// way as the hook so the "opens today" band lines up regardless of runner TZ.
const PATH_DATE = (() => {
  const d = new Date(NOW);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

function meetingStop(overrides: Partial<MeetingStop> = {}): MeetingStop {
  return {
    id: "appt-1",
    kind: "appointment",
    title: "Acme demo",
    dealId: "deal-1",
    dealName: "Acme",
    startAt: "2026-08-09T16:00:00Z",
    endAt: "2026-08-09T16:30:00Z",
    lat: 40.05,
    lng: -74.05,
    address: "1 Main St",
    appointmentId: "appt-1",
    past: false,
    ...overrides,
  };
}

function owedVisit(overrides: Partial<OwedVisit> = {}): OwedVisit {
  return {
    taskId: "task-1",
    dealId: "deal-9",
    name: "Old Prospect Co",
    address: "9 Old Rd",
    placeId: "place-9",
    lat: 40.02,
    lng: -74.02,
    urgency: 5,
    bandPosition: "in_band",
    dateSource: "interval",
    targetAt: "2026-08-05",
    earliestAt: "2026-08-01",
    latestAt: "2026-08-10",
    snoozeCount: 0,
    sourceOutcome: "no_answer",
    createdAt: "2026-08-04T12:00:00Z", // 5 days before NOW
    ...overrides,
  } as OwedVisit;
}

function merchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: "m-1",
    name: "Fresh Lead LLC",
    category: "other",
    address: "3 New Ave",
    lat: 40.01,
    lng: -74.01,
    phone: "",
    employeeCountRange: "",
    status: "prospect",
    lastActivity: null,
    ...overrides,
  } as Merchant;
}

beforeEach(() => {
  meetingsRef.stops = [];
  meetingsRef.status = "ok";
  meetingsRef.isLoading = false;
  owedRef.owed = [];
  owedRef.isLoading = false;
  dueTodayRef.dueToday = [];
  dueTodayRef.isLoading = false;
  merchantsRef.merchants = [];
  merchantsRef.isLoading = false;
});

describe("useTodaysPath", () => {
  it("maps each source into its assembler tier (appointment anchor + owed + nearby)", () => {
    meetingsRef.stops = [meetingStop()];
    owedRef.owed = [owedVisit()];
    merchantsRef.merchants = [merchant()];

    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));

    // The appointment anchor is present, tagged appointment, with its time kept.
    const anchor = result.current.proposal.find((s) => s.id === "appt-1");
    expect(anchor).toBeTruthy();
    expect(anchor).toMatchObject({
      kind: "appointment",
      tier: "appointment",
      name: "Acme demo",
      dealId: "deal-1",
      startAt: "2026-08-09T16:00:00Z",
    });

    // The owed visit became a past_due flexible stop keyed by its task id.
    const owedStop = result.current.proposal.find((s) => s.id === "task-1");
    expect(owedStop).toMatchObject({ kind: "flexible", tier: "past_due", name: "Old Prospect Co", dealId: "deal-9" });

    // The merchant became a nearby flexible stop with a null dealId.
    const nearbyStop = result.current.proposal.find((s) => s.id === "m-1");
    expect(nearbyStop).toMatchObject({ kind: "flexible", tier: "nearby", name: "Fresh Lead LLC", dealId: null });

    expect(result.current.status).toBe("ok");
    expect(result.current.isLoading).toBe(false);
  });

  it("passes owed staleness through as ageDays derived from `now`", () => {
    // The adaptation concern: createdAt → ageDays (whole days before `now`). We
    // assert the mapped values, NOT the final proposal order (routing is the
    // assembler's job and has its own tests).
    owedRef.owed = [
      owedVisit({ taskId: "recent", createdAt: "2026-08-08T15:00:00Z" }), // 1 day
      owedVisit({ taskId: "stale", lat: 40.03, lng: -74.03, createdAt: "2026-08-01T15:00:00Z" }), // 8 days
    ];

    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));

    const pastDue = result.current.proposal.filter((s) => s.tier === "past_due");
    expect(pastDue.map((s) => s.id).sort()).toEqual(["recent", "stale"]);
    expect(pastDue.find((s) => s.id === "stale")?.ageDays).toBe(8);
    expect(pastDue.find((s) => s.id === "recent")?.ageDays).toBe(1);
  });

  it("is deterministic for a fixed `now` (identical inputs → identical output)", () => {
    meetingsRef.stops = [meetingStop()];
    owedRef.owed = [owedVisit()];
    merchantsRef.merchants = [merchant()];

    const a = renderHook(() => useTodaysPath(ORIGIN, NOW)).result.current;
    const b = renderHook(() => useTodaysPath(ORIGIN, NOW)).result.current;
    expect(b.proposal).toEqual(a.proposal);
    expect(b.overflow).toEqual(a.overflow);
  });

  it("excludes past and unlocated meetings from the appointment tier", () => {
    meetingsRef.stops = [
      meetingStop({ id: "keep" }),
      meetingStop({ id: "past", past: true }),
      meetingStop({ id: "unlocated", lat: null, lng: null }),
    ];

    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));
    const anchorIds = result.current.proposal.filter((s) => s.tier === "appointment").map((s) => s.id);
    expect(anchorIds).toEqual(["keep"]);
  });

  it("returns an empty proposal when every source is empty", () => {
    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));
    expect(result.current.proposal).toEqual([]);
    expect(result.current.overflow).toEqual([]);
    expect(result.current.status).toBe("ok");
  });

  it("reports no_origin and an empty proposal when origin is null", () => {
    meetingsRef.stops = [meetingStop()];
    owedRef.owed = [owedVisit()];

    const { result } = renderHook(() => useTodaysPath(null, NOW));
    expect(result.current.status).toBe("no_origin");
    expect(result.current.proposal).toEqual([]);
    expect(result.current.overflow).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("surfaces needs_reconnect from the calendar read", () => {
    meetingsRef.status = "needs_reconnect";
    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));
    expect(result.current.status).toBe("needs_reconnect");
  });

  it("is loading while any composed source is loading (with an origin)", () => {
    merchantsRef.isLoading = true;
    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));
    expect(result.current.isLoading).toBe(true);
  });

  it("is loading while the due-today source is loading (with an origin)", () => {
    dueTodayRef.isLoading = true;
    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));
    expect(result.current.isLoading).toBe(true);
  });

  it("maps the due-today source into the due_today tier, ordered after past-due and before nearby", () => {
    // Collinear coords increasing in distance from ORIGIN in tier-priority order,
    // so nearest-neighbor routing preserves the tier order in the tail (no
    // appointments = the routed selection is the whole proposal).
    owedRef.owed = [owedVisit({ taskId: "owed-1", lat: 40.01, lng: -74.0 })]; // past-due (earliest 2026-08-01)
    dueTodayRef.dueToday = [owedVisit({ taskId: "due-1", name: "Opens Today Co", lat: 40.02, lng: -74.0 })];
    merchantsRef.merchants = [merchant({ id: "m-1", lat: 40.03, lng: -74.0 })];

    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));

    // The due-today task is present, tagged due_today, keyed by its task id.
    const dueStop = result.current.proposal.find((s) => s.id === "due-1");
    expect(dueStop).toMatchObject({ kind: "flexible", tier: "due_today", name: "Opens Today Co", dealId: "deal-9" });

    // Strict tier priority among the flexible stops: past_due -> due_today -> nearby.
    const flexTiers = result.current.proposal.filter((s) => s.kind === "flexible").map((s) => s.tier);
    expect(flexTiers).toEqual(["past_due", "due_today", "nearby"]);
  });

  it("excludes a due-today task with no resolvable coordinates", () => {
    dueTodayRef.dueToday = [
      owedVisit({ taskId: "mappable", lat: 40.02, lng: -74.0 }),
      owedVisit({ taskId: "no-coords", lat: null as unknown as number, lng: null as unknown as number }),
    ];

    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));
    const ids = result.current.proposal.map((s) => s.id);
    expect(ids).toContain("mappable");
    expect(ids).not.toContain("no-coords");
  });

  it("keeps past-due and due-today disjoint: an opens-today task never double-counts in the owed tier", () => {
    // useOwedVisits returns the whole opened window, so the SAME opens-today task
    // can appear in owed.owed (earliest_at === today). The composing hook must
    // route it to due_today only, never past_due.
    owedRef.owed = [owedVisit({ taskId: "shared", earliestAt: PATH_DATE, lat: 40.02, lng: -74.0 })];
    dueTodayRef.dueToday = [owedVisit({ taskId: "shared", earliestAt: PATH_DATE, lat: 40.02, lng: -74.0 })];

    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));
    const shared = result.current.proposal.filter((s) => s.id === "shared");
    expect(shared).toHaveLength(1); // exactly one, no double-count
    expect(shared[0].tier).toBe("due_today");
    expect(result.current.proposal.some((s) => s.tier === "past_due")).toBe(false);
  });

  it("keeps a genuinely past-due task in the owed tier, not due_today", () => {
    owedRef.owed = [owedVisit({ taskId: "old", earliestAt: "2026-08-01", lat: 40.02, lng: -74.0 })];

    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));
    const stop = result.current.proposal.find((s) => s.id === "old");
    expect(stop?.tier).toBe("past_due");
  });
});
