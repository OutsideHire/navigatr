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
import type { OwedVisit, OwedVisitNoCoords } from "../lib/owedVisits";
import type { Merchant } from "../mockData";
import type { CalendarStatus } from "./useCalendarEvents";

// ── Mocks: the three composed hooks. Hoisted refs let each test seed the tier
//    data (and the meeting-stops status) before rendering. ─────────────────────
const meetingsRef = vi.hoisted(() => ({
  stops: [] as MeetingStop[],
  status: "ok" as CalendarStatus,
  isLoading: false,
}));
const owedRef = vi.hoisted(() => ({ owed: [] as OwedVisit[], noLocation: [] as OwedVisitNoCoords[], isLoading: false }));
const dueTodayRef = vi.hoisted(() => ({ dueToday: [] as OwedVisit[], noLocation: [] as OwedVisitNoCoords[], isLoading: false }));
const merchantsRef = vi.hoisted(() => ({ merchants: [] as Merchant[], isLoading: false }));
// Per-rep end-of-day (minutes from midnight) or null to use the global default.
// Mocked so the hook's capacity window is driven without a live DB/QueryClient.
const eodRef = vi.hoisted(() => ({ current: null as number | null }));
// Captures the opts useTodaysPath passes to useMerchants (industry scoping).
const merchantsOptsRef = vi.hoisted(() => ({ current: undefined as { industries?: string[] } | undefined }));
// The rep's Default Industries (usePathPreferences already returns saved-or-recommended).
const prefsRef = vi.hoisted(() => ({ current: null as Record<string, string[]> | null }));

vi.mock("./useMeetingStops", () => ({
  useMeetingStops: () => ({
    stops: meetingsRef.stops,
    status: meetingsRef.status,
    isLoading: meetingsRef.isLoading,
  }),
}));
vi.mock("./useOwedVisits", () => ({
  useOwedVisits: () => ({ owed: owedRef.owed, noLocation: owedRef.noLocation, isLoading: owedRef.isLoading }),
}));
vi.mock("./useDueTodayVisits", () => ({
  useDueTodayVisits: () => ({ dueToday: dueTodayRef.dueToday, noLocation: dueTodayRef.noLocation, isLoading: dueTodayRef.isLoading }),
}));
vi.mock("./useMerchants", () => ({
  useMerchants: (_origin: unknown, opts?: { industries?: string[] }) => {
    merchantsOptsRef.current = opts;
    return { merchants: merchantsRef.merchants, isLoading: merchantsRef.isLoading };
  },
}));
vi.mock("./usePathPreferences", () => ({
  usePathEndOfDayMinutes: () => ({ data: eodRef.current }),
  usePathPreferences: () => ({ data: prefsRef.current }),
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
  owedRef.noLocation = [];
  owedRef.isLoading = false;
  dueTodayRef.dueToday = [];
  dueTodayRef.noLocation = [];
  dueTodayRef.isLoading = false;
  merchantsRef.merchants = [];
  merchantsRef.isLoading = false;
  eodRef.current = null;
  merchantsOptsRef.current = undefined;
  prefsRef.current = null;
});

describe("useTodaysPath", () => {
  it("maps each source into its assembler tier (appointment anchor + owed on the day, nearby held in the pool)", () => {
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

    // The owed visit became a past_due flexible stop keyed by its task id, on the day.
    const owedStop = result.current.proposal.find((s) => s.id === "task-1");
    expect(owedStop).toMatchObject({ kind: "flexible", tier: "past_due", name: "Old Prospect Co", dealId: "deal-9" });

    // v2.2 B 4.2: the merchant became a nearby flexible stop with a null dealId,
    // held in the fill pool (overflow), NOT auto-added to the day.
    expect(result.current.proposal.some((s) => s.tier === "nearby")).toBe(false);
    const nearbyStop = result.current.overflow.find((s) => s.id === "m-1");
    expect(nearbyStop).toMatchObject({ tier: "nearby", name: "Fresh Lead LLC", dealId: null });

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

  it("scopes the nearby fill to the rep's Default Industries (Path QA)", () => {
    // Regression: the day-builder must pass the rep's Default Industries to the
    // nearby fetch (same source as discover). Before the fix it passed nothing,
    // so the Edge fetched EVERY industry and the auto-fill ignored the setting.
    prefsRef.current = { retail: ["grocery_store"], restaurants_bars_entertainment: ["restaurant"] };
    renderHook(() => useTodaysPath(ORIGIN, NOW));
    expect(new Set(merchantsOptsRef.current?.industries)).toEqual(
      new Set(["retail", "restaurants_bars_entertainment"]),
    );
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

  it("maps the due-today source into the due_today tier, on the day after past-due; nearby stays in the pool", () => {
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

    // v2.2 B 4.2: the day (proposal) carries only the real commitments in tier
    // order past_due -> due_today. Nearby is held in the pool (overflow), never
    // auto-added on load.
    const flexTiers = result.current.proposal.filter((s) => s.kind === "flexible").map((s) => s.tier);
    expect(flexTiers).toEqual(["past_due", "due_today"]);
    expect(result.current.overflow.map((s) => s.tier)).toEqual(["nearby"]);
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

  // Regression (Path QA B1 / "refresh to populate"): called WITHOUT an explicit
  // `now` (the production path, where PathPage calls `useTodaysPath(origin)`), the hook
  // must capture the clock ONCE and keep a stable output identity across renders.
  // The old code read `now = new Date().toISOString()` as a per-render default, so
  // the memo's `now` dep changed every render and `proposal`/`overflow` got a fresh
  // array identity each time. That re-derivation churns the entry landing
  // (TodaysPathView keys `workingProposal`/`poolCursor` off `proposal` identity and
  // reset them on every render). It also means the day is NOT stably exposed until
  // something re-renders "just right", which is the QA-reported empty-until-refresh.
  // RunningPath already captures a stable `now`; this asserts the entry view does too.
  it("captures `now` once so the assembled day keeps a stable identity across re-renders (no fixed now)", () => {
    meetingsRef.stops = [meetingStop()];
    owedRef.owed = [owedVisit()];
    merchantsRef.merchants = [merchant()];

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T15:00:00.000Z"));
    try {
      // Production call signature: no explicit `now` (defaults internally).
      const { result, rerender } = renderHook(() => useTodaysPath(ORIGIN));
      const firstProposal = result.current.proposal;
      const firstOverflow = result.current.overflow;
      // The day is exposed on the first render (owed + nearby assembled).
      expect(firstProposal.length).toBeGreaterThan(0);

      // Advance the wall clock and re-render. A per-render `now` default would make
      // the memo re-derive here and hand a NEW array identity to consumers; a
      // captured `now` must not.
      vi.setSystemTime(new Date("2026-08-09T15:00:00.001Z"));
      rerender();
      vi.setSystemTime(new Date("2026-08-09T15:00:00.002Z"));
      rerender();

      expect(result.current.proposal).toBe(firstProposal);
      expect(result.current.overflow).toBe(firstOverflow);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes no-location owed drop-ins, deduped by taskId across the owed + due-today bands, never in the plan", () => {
    // A window-opens-today task with no coords is read by BOTH useOwedVisits
    // (.lte) and useDueTodayVisits (.eq), so the same stub arrives twice.
    const stub: OwedVisitNoCoords = { taskId: "nl-shared", dealId: "deal-nl", name: "No Map Co", address: "9 Off Grid Rd" };
    owedRef.noLocation = [stub, { taskId: "nl-owed", dealId: "deal-2", name: "Owed Only Co", address: null }];
    dueTodayRef.noLocation = [stub];

    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));

    // Deduped: the shared stub appears once, alongside the owed-only one.
    expect(result.current.noLocation.map((s) => s.taskId).sort()).toEqual(["nl-owed", "nl-shared"]);
    // Never routed.
    expect(result.current.proposal.some((s) => s.dealId === "deal-nl")).toBe(false);
    expect(result.current.overflow.some((s) => s.name === "No Map Co")).toBe(false);
  });

  it("uses the global 17:00 default end-of-day when the rep has no override", () => {
    // Empty day, NOW = 15:00 UTC in the 9..17 window: 2h = 120min still open.
    eodRef.current = null;
    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));
    expect(result.current.remainingMin).toBe(120);
    expect(result.current.windowEndHour).toBe(17);
  });

  it("reflects the rep's per-rep end-of-day in the budget and the window-end hour", () => {
    // 16:00 EOD = 960 min. From 15:00 that leaves 1h = 60min.
    eodRef.current = 960;
    const { result } = renderHook(() => useTodaysPath(ORIGIN, NOW));
    expect(result.current.remainingMin).toBe(60);
    expect(result.current.windowEndHour).toBe(16);
  });

  it("reflects the rep's per-rep end-of-day for the window-end hour even with no origin", () => {
    eodRef.current = 960;
    const { result } = renderHook(() => useTodaysPath(null, NOW));
    expect(result.current.status).toBe("no_origin");
    expect(result.current.windowEndHour).toBe(16);
  });

  it("still surfaces no-location owed drop-ins when there is no origin (nothing routable)", () => {
    owedRef.noLocation = [{ taskId: "nl1", dealId: "deal-nl", name: "No Map Co", address: null }];

    const { result } = renderHook(() => useTodaysPath(null, NOW));

    expect(result.current.status).toBe("no_origin");
    expect(result.current.proposal).toHaveLength(0);
    expect(result.current.noLocation.map((s) => s.taskId)).toEqual(["nl1"]);
  });
});
