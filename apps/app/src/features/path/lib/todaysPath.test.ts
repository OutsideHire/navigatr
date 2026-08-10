import { describe, it, expect } from "vitest";
import {
  assembleTodaysPath,
  type AssembleTodaysPathInput,
  type PathAppointment,
  type OwedCandidate,
  type DueTodayCandidate,
  type NearbyCandidate,
} from "./todaysPath";

// --- builders ----------------------------------------------------------------
// Most tests put candidates at the origin (drive == 0) so the budget is driven
// purely by dwellMin, and nearest-neighbor ordering falls back to input order
// (equal distances resolve to the lowest unvisited index). That keeps tier
// ordering + capacity assertions deterministic and free of haversine noise.

const ORIGIN = { lat: 0, lng: 0 };

const appt = (o: Partial<PathAppointment> = {}): PathAppointment => ({
  id: "a1",
  kind: "appointment",
  title: "Meeting",
  dealId: "deal-a1",
  startAt: "2026-08-09T11:00:00.000Z",
  endAt: "2026-08-09T12:00:00.000Z",
  lat: 0,
  lng: 0,
  ...o,
});

const owed = (o: Partial<OwedCandidate> = {}): OwedCandidate => ({
  id: "o1",
  dealId: "deal-o1",
  name: "Owed Co",
  lat: 0,
  lng: 0,
  ageDays: 5,
  ...o,
});

const due = (o: Partial<DueTodayCandidate> = {}): DueTodayCandidate => ({
  id: "u1",
  dealId: "deal-u1",
  name: "Due Co",
  lat: 0,
  lng: 0,
  ...o,
});

const nearby = (o: Partial<NearbyCandidate> = {}): NearbyCandidate => ({
  id: "n1",
  name: "Nearby Co",
  lat: 0,
  lng: 0,
  ...o,
});

const base = (o: Partial<AssembleTodaysPathInput> = {}): AssembleTodaysPathInput => ({
  appointments: [],
  owed: [],
  dueToday: [],
  nearbyPool: [],
  origin: ORIGIN,
  ...o,
});

// 09:00 local-UTC start of an 09..17 window -> full 480min budget.
const NOW = "2026-08-09T09:00:00.000Z";

describe("assembleTodaysPath", () => {
  it("returns empty proposal and overflow for empty input", () => {
    const r = assembleTodaysPath(base(), NOW);
    expect(r.proposal).toEqual([]);
    expect(r.overflow).toEqual([]);
  });

  it("exposes remaining capacity and the working-window end hour", () => {
    // Empty day at 09:00 in the default 09..17 window: the whole 480min budget
    // is still open and the window closes at hour 17.
    const r = assembleTodaysPath(base(), NOW);
    expect(typeof r.remainingMin).toBe("number");
    expect(r.remainingMin).toBe(480);
    expect(r.windowEndHour).toBe(17);
  });

  it("returns the configured window end hour when a dayWindow is given", () => {
    const r = assembleTodaysPath(base({ dayWindow: { startHour: 9, endHour: 18 } }), NOW);
    expect(r.windowEndHour).toBe(18);
  });

  it("always includes appointments, ordered ascending by startAt", () => {
    const later = appt({ id: "late", startAt: "2026-08-09T15:00:00.000Z", endAt: "2026-08-09T15:30:00.000Z" });
    const earlier = appt({ id: "early", startAt: "2026-08-09T10:00:00.000Z", endAt: "2026-08-09T10:30:00.000Z" });
    const r = assembleTodaysPath(base({ appointments: [later, earlier] }), NOW);
    const apptStops = r.proposal.filter((s) => s.tier === "appointment");
    expect(apptStops.map((s) => s.id)).toEqual(["early", "late"]);
    expect(apptStops[0]!.kind).toBe("appointment");
  });

  it("keeps an external appointment's kind and tags it tier=appointment", () => {
    const ext = appt({ id: "x", kind: "external", title: "Client visit" });
    const r = assembleTodaysPath(base({ appointments: [ext] }), NOW);
    const s = r.proposal.find((p) => p.id === "x")!;
    expect(s.kind).toBe("external");
    expect(s.tier).toBe("appointment");
    expect(s.name).toBe("Client visit");
  });

  it("selects flexible candidates in strict tier order: past_due, then due_today, then nearby", () => {
    // dwell 150 with a 480 budget fits exactly 3 of 4.
    const input = base({
      owed: [owed({ id: "o-old", ageDays: 9 }), owed({ id: "o-new", ageDays: 3 })],
      dueToday: [due({ id: "d-1" })],
      nearbyPool: [nearby({ id: "n-1" })],
      dwellMin: 150,
    });
    const r = assembleTodaysPath(input, NOW);
    const selectedIds = r.proposal.filter((s) => s.tier !== "appointment").map((s) => s.id);
    expect(selectedIds).toEqual(["o-old", "o-new", "d-1"]);
    expect(r.proposal.find((s) => s.id === "o-old")!.tier).toBe("past_due");
    expect(r.proposal.find((s) => s.id === "d-1")!.tier).toBe("due_today");
    // nearby did not fit -> overflow.
    expect(r.overflow.map((s) => s.id)).toEqual(["n-1"]);
    expect(r.overflow[0]!.tier).toBe("nearby");
  });

  it("oldest past_due first (preserves the input order of pre-sorted owed)", () => {
    const input = base({
      owed: [owed({ id: "o-old", ageDays: 12 }), owed({ id: "o-mid", ageDays: 7 }), owed({ id: "o-new", ageDays: 2 })],
    });
    const r = assembleTodaysPath(input, NOW);
    const ids = r.proposal.filter((s) => s.tier === "past_due").map((s) => s.id);
    expect(ids).toEqual(["o-old", "o-mid", "o-new"]);
  });

  it("cuts off at capacity: the rest overflow in strict priority order", () => {
    // dwell 200, budget 480 -> exactly 2 fit (2*200=400<=480, 3rd would be 600).
    const input = base({
      owed: [owed({ id: "o-1", ageDays: 8 }), owed({ id: "o-2", ageDays: 4 })],
      dueToday: [due({ id: "d-1" })],
      nearbyPool: [nearby({ id: "n-1" }), nearby({ id: "n-2" })],
      dwellMin: 200,
    });
    const r = assembleTodaysPath(input, NOW);
    expect(r.proposal.filter((s) => s.tier !== "appointment").map((s) => s.id)).toEqual(["o-1", "o-2"]);
    // Overflow preserves tier + priority order: remaining owed? none; then due, then nearby.
    expect(r.overflow.map((s) => s.id)).toEqual(["d-1", "n-1", "n-2"]);
    expect(r.overflow.map((s) => s.tier)).toEqual(["due_today", "nearby", "nearby"]);
  });

  it("excludes candidates with no lat/lng from both proposal and overflow", () => {
    const input = base({
      owed: [owed({ id: "o-nogeo", lat: null, lng: null }), owed({ id: "o-geo" })],
      dueToday: [due({ id: "d-nogeo", lat: 0, lng: null })],
      dwellMin: 20,
    });
    const r = assembleTodaysPath(input, NOW);
    const all = [...r.proposal.map((s) => s.id), ...r.overflow.map((s) => s.id)];
    expect(all).toContain("o-geo");
    expect(all).not.toContain("o-nogeo");
    expect(all).not.toContain("d-nogeo");
  });

  it("handles empty tiers (only nearby present)", () => {
    const input = base({ nearbyPool: [nearby({ id: "n-1" }), nearby({ id: "n-2" })], dwellMin: 20 });
    const r = assembleTodaysPath(input, NOW);
    expect(r.proposal.map((s) => s.id)).toEqual(["n-1", "n-2"]);
    expect(r.proposal.every((s) => s.tier === "nearby")).toBe(true);
    expect(r.overflow).toEqual([]);
  });

  it("past_due carries ageDays; flexible stops have null appointment times", () => {
    const r = assembleTodaysPath(base({ owed: [owed({ id: "o-1", ageDays: 6 })] }), NOW);
    const s = r.proposal.find((p) => p.id === "o-1")!;
    expect(s.ageDays).toBe(6);
    expect(s.kind).toBe("flexible");
    expect(s.startAt).toBeNull();
  });

  it("now drives the budget: a later start leaves room for fewer stops", () => {
    const input = base({
      owed: [owed({ id: "o-1", ageDays: 8 }), owed({ id: "o-2", ageDays: 6 }), owed({ id: "o-3", ageDays: 4 })],
      dwellMin: 120,
    });
    // Full day (09:00): 480 budget -> 3 fit (360<=480).
    const full = assembleTodaysPath(input, "2026-08-09T09:00:00.000Z");
    expect(full.proposal.filter((s) => s.tier !== "appointment")).toHaveLength(3);
    // Late start (15:00): only 120min left -> 1 fits.
    const late = assembleTodaysPath(input, "2026-08-09T15:00:00.000Z");
    expect(late.proposal.filter((s) => s.tier !== "appointment").map((s) => s.id)).toEqual(["o-1"]);
    expect(late.overflow.map((s) => s.id)).toEqual(["o-2", "o-3"]);
  });

  it("appointments consume budget, leaving less for flexible stops", () => {
    const flexOnly = base({
      owed: [owed({ id: "o-1", ageDays: 8 }), owed({ id: "o-2", ageDays: 6 })],
      dwellMin: 200,
    });
    // No appointment: 480 budget -> 2 fit.
    expect(assembleTodaysPath(flexOnly, NOW).proposal.filter((s) => s.tier !== "appointment")).toHaveLength(2);
    // A 4-hour appointment (240min) eats budget -> only 1 flexible fits (200<=240).
    const withAppt = { ...flexOnly, appointments: [appt({ startAt: "2026-08-09T12:00:00.000Z", endAt: "2026-08-09T16:00:00.000Z" })] };
    const r = assembleTodaysPath(withAppt, NOW);
    expect(r.proposal.filter((s) => s.tier !== "appointment")).toHaveLength(1);
    expect(r.overflow.map((s) => s.id)).toEqual(["o-2"]);
  });

  it("is deterministic and pure (same inputs -> identical output)", () => {
    const input = base({
      appointments: [appt()],
      owed: [owed({ id: "o-1" })],
      dueToday: [due({ id: "d-1" })],
      nearbyPool: [nearby({ id: "n-1" })],
      dwellMin: 30,
    });
    const a = assembleTodaysPath(input, NOW);
    const b = assembleTodaysPath(input, NOW);
    expect(a).toEqual(b);
  });

  it("accepts now as epoch ms as well as ISO", () => {
    const input = base({ owed: [owed({ id: "o-1" })], dwellMin: 30 });
    const iso = assembleTodaysPath(input, NOW);
    const ms = assembleTodaysPath(input, Date.parse(NOW));
    expect(ms).toEqual(iso);
  });

  it("re-sorts owed oldest-overdue-first internally, even when input is out of order", () => {
    // Deliberately NOT pre-sorted: the assembler must reorder by ageDays desc.
    const input = base({
      owed: [
        owed({ id: "o-mid", ageDays: 7 }),
        owed({ id: "o-old", ageDays: 12 }),
        owed({ id: "o-new", ageDays: 2 }),
      ],
      dwellMin: 20,
    });
    const r = assembleTodaysPath(input, NOW);
    const ids = r.proposal.filter((s) => s.tier === "past_due").map((s) => s.id);
    expect(ids).toEqual(["o-old", "o-mid", "o-new"]);
  });

  it("owed sort is stable for equal ageDays (preserves input index order)", () => {
    const input = base({
      owed: [
        owed({ id: "o-a", ageDays: 5 }),
        owed({ id: "o-b", ageDays: 5 }),
        owed({ id: "o-c", ageDays: 5 }),
      ],
      dwellMin: 20,
    });
    const r = assembleTodaysPath(input, NOW);
    const ids = r.proposal.filter((s) => s.tier === "past_due").map((s) => s.id);
    expect(ids).toEqual(["o-a", "o-b", "o-c"]);
  });

  it("defers a flexible stop that cannot fit before an appointment, without dropping or reordering", () => {
    // FAR is a distinct (non-origin) coordinate ~10mi from the origin, so the
    // drive is ~20min at 30mph (not zero). The appointment opens just 15min
    // into the day, so drive-out + dwell + drive-back cannot fit before it and
    // the stop must be deferred past the anchor. This exercises the interleave
    // deferral branch that origin-colocated candidates never reach.
    const FAR = { lat: 0.145, lng: 0 };
    const input = base({
      appointments: [
        appt({
          id: "appt-soon",
          startAt: "2026-08-09T09:15:00.000Z",
          endAt: "2026-08-09T09:45:00.000Z",
          lat: 0,
          lng: 0,
        }),
      ],
      owed: [owed({ id: "o-far", lat: FAR.lat, lng: FAR.lng, ageDays: 5 })],
      dwellMin: 20,
    });
    const r = assembleTodaysPath(input, NOW);
    const ids = r.proposal.map((s) => s.id);
    // (b) the selected-but-deferred stop is still present, not dropped.
    expect(ids).toContain("o-far");
    expect(r.overflow.map((s) => s.id)).not.toContain("o-far");
    // (a) the appointment stays anchored and the stop lands AFTER it.
    const apptIdx = ids.indexOf("appt-soon");
    const stopIdx = ids.indexOf("o-far");
    expect(apptIdx).toBe(0);
    expect(stopIdx).toBeGreaterThan(apptIdx);
    expect(r.proposal[apptIdx]!.startAt).toBe("2026-08-09T09:15:00.000Z");
    expect(r.proposal[apptIdx]!.tier).toBe("appointment");
    // (c) deterministic: identical inputs produce identical output.
    expect(assembleTodaysPath(input, NOW)).toEqual(r);
  });
});
