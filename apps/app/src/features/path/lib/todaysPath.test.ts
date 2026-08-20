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

// 09:00 UTC start inside the default 08..18 window (offset 0) -> 540min budget
// (09:00 clamps above the 08:00 open, runs to the 18:00 close).
const NOW = "2026-08-09T09:00:00.000Z";

describe("assembleTodaysPath", () => {
  it("returns empty proposal and overflow for empty input", () => {
    const r = assembleTodaysPath(base(), NOW);
    expect(r.proposal).toEqual([]);
    expect(r.overflow).toEqual([]);
  });

  it("exposes remaining capacity and the working-window end hour", () => {
    // Empty day at 09:00 in the default 08..18 window: 09:00 -> 18:00 is 540min
    // still open and the window closes at hour 18.
    const r = assembleTodaysPath(base(), NOW);
    expect(typeof r.remainingMin).toBe("number");
    expect(r.remainingMin).toBe(540);
    expect(r.windowEndHour).toBe(18);
  });

  it("returns the configured window end hour when a dayWindow is given", () => {
    const r = assembleTodaysPath(base({ dayWindow: { startHour: 9, endHour: 18 } }), NOW);
    expect(r.windowEndHour).toBe(18);
  });

  it("honors a minute-precise per-rep end-of-day (endMinutes) for the budget", () => {
    // 16:00 EOD = 960 min. Starting the empty day at 09:00 leaves 7h = 420min.
    const r = assembleTodaysPath(base({ dayWindow: { startHour: 9, endHour: 17, endMinutes: 960 } }), NOW);
    expect(r.remainingMin).toBe(420);
    // windowEndHour tracks the per-rep EOD (16), not the coarse endHour fallback.
    expect(r.windowEndHour).toBe(16);
  });

  it("falls back to the default 18:00 close when no per-rep endMinutes is given", () => {
    const r = assembleTodaysPath(base(), NOW);
    expect(r.remainingMin).toBe(540); // 09:00 -> 18:00 in the default 08..18 window
    expect(r.windowEndHour).toBe(18);
  });

  it("honors a minute-precise per-rep start-of-day (startMinutes) for the budget", () => {
    // 8:30 AM open = 510 min. NOW is 09:00, so the day is already open and the
    // budget runs 09:00 -> 18:00 (540). Verify startMinutes is accepted and the
    // window still opens no later than 09:00 (the start clamps below now).
    const r = assembleTodaysPath(base({ dayWindow: { startHour: 8, endHour: 18, startMinutes: 510 } }), NOW);
    expect(r.remainingMin).toBe(540);
  });

  it("a startMinutes AFTER now defers the day's start to that open time", () => {
    // 09:30 open (570 min) with NOW 09:00 (offset 0): the day has not opened yet,
    // so it starts at 09:30 and remaining runs 09:30 -> 18:00 = 510.
    const r = assembleTodaysPath(base({ dayWindow: { startHour: 8, endHour: 18, startMinutes: 570 } }), NOW);
    expect(r.startsAtIso).toBe("2026-08-09T09:30:00.000Z");
    expect(r.remainingMin).toBe(510);
    expect(r.dayNotYetOpen).toBe(true);
  });

  it("endMinutes carries sub-hour precision into windowEndHour (floored) and the budget", () => {
    // 16:30 EOD = 990 min -> 7.5h = 450min budget; the hour label floors to 16.
    const r = assembleTodaysPath(base({ dayWindow: { startHour: 9, endHour: 17, endMinutes: 990 } }), NOW);
    expect(r.remainingMin).toBe(450);
    expect(r.windowEndHour).toBe(16);
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
    // dwell 150 with the 540 budget (09:00->18:00) fits exactly 3 of 4.
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

  it("threads datePromised from owed / due-today candidates onto the ordered stops (v2.2 B 4.5)", () => {
    const input = base({
      owed: [owed({ id: "o-promised", ageDays: 5, datePromised: true }), owed({ id: "o-plain", ageDays: 3 })],
      dueToday: [due({ id: "d-promised", datePromised: true })],
      nearbyPool: [nearby({ id: "n-1" })],
    });
    const r = assembleTodaysPath(input, NOW);
    const byId = (id: string) => [...r.proposal, ...r.overflow].find((s) => s.id === id)!;
    expect(byId("o-promised").datePromised).toBe(true);
    expect(byId("o-plain").datePromised).toBe(false);
    expect(byId("d-promised").datePromised).toBe(true);
    // A nearby fill is never a promise.
    expect(byId("n-1").datePromised).toBe(false);
  });

  it("threads bandPosition from owed / due-today candidates onto the ordered stops (v2.2 B 4.6)", () => {
    const input = base({
      owed: [
        owed({ id: "o-warm", ageDays: 6, bandPosition: "past_ideal" }),
        owed({ id: "o-hot", ageDays: 12, bandPosition: "aging" }),
      ],
      dueToday: [due({ id: "d-neutral", bandPosition: "in_window" })],
      nearbyPool: [nearby({ id: "n-1" })],
    });
    const r = assembleTodaysPath(input, NOW);
    const byId = (id: string) => [...r.proposal, ...r.overflow].find((s) => s.id === id)!;
    expect(byId("o-warm").bandPosition).toBe("past_ideal");
    expect(byId("o-hot").bandPosition).toBe("aging");
    expect(byId("d-neutral").bandPosition).toBe("in_window");
    // A nearby fill carries no band.
    expect(byId("n-1").bandPosition).toBeUndefined();
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

  it("holds nearby entirely in the pool on load (only nearby present -> empty proposal, all in overflow)", () => {
    // v2.2 B 4.2: fill is manual. Nearby candidates are NEVER auto-selected onto
    // the day, even when the budget is wide open. They all route to overflow (the
    // retained fill pool) in ranked order, available for manual fill (B-T4).
    const input = base({ nearbyPool: [nearby({ id: "n-1" }), nearby({ id: "n-2" })], dwellMin: 20 });
    const r = assembleTodaysPath(input, NOW);
    expect(r.proposal).toEqual([]);
    expect(r.overflow.map((s) => s.id)).toEqual(["n-1", "n-2"]);
    expect(r.overflow.every((s) => s.tier === "nearby")).toBe(true);
  });

  it("never auto-selects nearby onto the day: proposal has zero nearby, pool holds them in ranked order", () => {
    // Wide budget, plenty of room. Owed + due-today (real commitments) still
    // select onto the day; every nearby stays in the pool regardless of capacity.
    const input = base({
      owed: [owed({ id: "o-1", ageDays: 8 })],
      dueToday: [due({ id: "d-1" })],
      nearbyPool: [nearby({ id: "n-1" }), nearby({ id: "n-2" }), nearby({ id: "n-3" })],
      dwellMin: 20,
    });
    const r = assembleTodaysPath(input, NOW);
    // Commitments assemble on load.
    expect(r.proposal.filter((s) => s.tier !== "appointment").map((s) => s.id)).toEqual(["o-1", "d-1"]);
    // Zero nearby in the proposal.
    expect(r.proposal.some((s) => s.tier === "nearby")).toBe(false);
    // All nearby in overflow, in ranked (input) order.
    expect(r.overflow.map((s) => s.id)).toEqual(["n-1", "n-2", "n-3"]);
    expect(r.overflow.every((s) => s.tier === "nearby")).toBe(true);
  });

  it("owed/due overflow ranks before nearby in the pool: owed-overflow -> due-overflow -> nearby", () => {
    // dwell 200, budget 480 -> only 2 auto-eligible fit; the rest overflow, and
    // nearby always trails the owed/due overflow in the pool order (B-T4 consumes
    // the pool in this rank order).
    const input = base({
      owed: [owed({ id: "o-1", ageDays: 8 }), owed({ id: "o-2", ageDays: 4 }), owed({ id: "o-3", ageDays: 2 })],
      dueToday: [due({ id: "d-1" })],
      nearbyPool: [nearby({ id: "n-1" }), nearby({ id: "n-2" })],
      dwellMin: 200,
    });
    const r = assembleTodaysPath(input, NOW);
    expect(r.proposal.filter((s) => s.tier !== "appointment").map((s) => s.id)).toEqual(["o-1", "o-2"]);
    // Overflow: unselected owed/due first (in rank), then all nearby.
    expect(r.overflow.map((s) => s.id)).toEqual(["o-3", "d-1", "n-1", "n-2"]);
    expect(r.overflow.map((s) => s.tier)).toEqual(["past_due", "due_today", "nearby", "nearby"]);
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
    // Full day (09:00): 540 budget -> 3 fit (360<=540).
    const full = assembleTodaysPath(input, "2026-08-09T09:00:00.000Z");
    expect(full.proposal.filter((s) => s.tier !== "appointment")).toHaveLength(3);
    // Late start (15:00): only 180min left -> 1 fits.
    const late = assembleTodaysPath(input, "2026-08-09T15:00:00.000Z");
    expect(late.proposal.filter((s) => s.tier !== "appointment").map((s) => s.id)).toEqual(["o-1"]);
    expect(late.overflow.map((s) => s.id)).toEqual(["o-2", "o-3"]);
  });

  it("appointments consume budget, leaving less for flexible stops", () => {
    const flexOnly = base({
      owed: [owed({ id: "o-1", ageDays: 8 }), owed({ id: "o-2", ageDays: 6 })],
      dwellMin: 200,
    });
    // No appointment: 540 budget -> 2 fit.
    expect(assembleTodaysPath(flexOnly, NOW).proposal.filter((s) => s.tier !== "appointment")).toHaveLength(2);
    // A 4-hour appointment (240min) eats budget -> only 1 flexible fits (200<=300).
    const withAppt = { ...flexOnly, appointments: [appt({ startAt: "2026-08-09T12:00:00.000Z", endAt: "2026-08-09T16:00:00.000Z" })] };
    const r = assembleTodaysPath(withAppt, NOW);
    expect(r.proposal.filter((s) => s.tier !== "appointment")).toHaveLength(1);
    expect(r.overflow.map((s) => s.id)).toEqual(["o-2"]);
  });

  it("uses per-kind dwell when no override: an end-less appointment holds 30, a flexible stop holds 15", () => {
    // No dwellMin override -> derive per kind. An appointment with no endAt
    // consumes the 30-min appointment dwell; a flexible owed stop at the origin
    // (zero drive) consumes the 15-min flexible dwell. Budget is the full 540min.
    const apptOnly = assembleTodaysPath(
      base({ appointments: [appt({ id: "a-noend", startAt: "2026-08-09T11:00:00.000Z", endAt: null })] }),
      NOW,
    );
    expect(apptOnly.remainingMin).toBe(540 - 30);

    const flexOnly = assembleTodaysPath(base({ owed: [owed({ id: "o-1" })] }), NOW);
    expect(flexOnly.remainingMin).toBe(540 - 15);
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


// The working window's hours (startHour / endMinutes) are the rep's wall-clock
// business hours, so they must anchor to the rep's timezone, NOT UTC. Regression
// for Robert's "Starts at shows the wrong time" QA: a rep in US Central saw the
// day open and close on UTC hours, offsetting "Starts at" and collapsing
// capacity in the late morning. `tzOffsetMinutes` is the device offset (minutes
// BEHIND UTC: 300 = US Central UTC-5, -60 = CET UTC+1, 0 = UTC). The default
// working window opens at 8:00 AM local (Workday Window Fix v1.4 Section 7).
describe("assembleTodaysPath — timezone-local working window", () => {
  it("opens the day at the rep's LOCAL start hour, not the UTC hour (US Central)", () => {
    // 12:30Z with offset 300 == 7:30 local, before the 8:00 local open. So the
    // day starts at 8:00 local == 13:00Z, with the full 600min (8..18) window.
    // Ignoring the offset (the bug) would start at "now" and lose ~4.5h.
    const r = assembleTodaysPath(
      base({ tzOffsetMinutes: 300 }),
      "2026-08-19T12:30:00.000Z",
    );
    expect(r.startsAtIso).toBe("2026-08-19T13:00:00.000Z");
    expect(r.remainingMin).toBe(600);
    // Before the local open, so the start is the scheduled opening, not now.
    expect(r.dayNotYetOpen).toBe(true);
  });

  it("clamps 'Starts at' to now once the local window is already open (US Central)", () => {
    // 15:30Z with offset 300 == 10:30 local, inside the 8:00..18:00 local window.
    // Start is now; remaining runs to 18:00 local (23:00Z) == 7.5h = 450min.
    const r = assembleTodaysPath(
      base({ tzOffsetMinutes: 300 }),
      "2026-08-19T15:30:00.000Z",
    );
    expect(r.startsAtIso).toBe("2026-08-19T15:30:00.000Z");
    expect(r.remainingMin).toBe(450);
    expect(r.dayNotYetOpen).toBe(false);
  });

  it("closes the day at the rep's LOCAL end-of-day (no capacity after local EOD)", () => {
    // 02:00Z Aug 20 with offset 300 == 21:00 local Aug 19, well past the 18:00
    // local close. The local date is derived from (now, offset), so the window
    // is Aug 19 local and there is zero remaining budget.
    const r = assembleTodaysPath(
      base({ tzOffsetMinutes: 300 }),
      "2026-08-20T02:00:00.000Z",
    );
    expect(r.remainingMin).toBe(0);
    expect(r.dayNotYetOpen).toBe(false);
  });

  it("anchors the window for an east-of-UTC rep too (CET, offset -60)", () => {
    // 06:30Z with offset -60 == 07:30 local, before the 8:00 local open, which
    // is 07:00Z. Day starts at 07:00Z with the full 600min window.
    const r = assembleTodaysPath(
      base({ tzOffsetMinutes: -60 }),
      "2026-08-19T06:30:00.000Z",
    );
    expect(r.startsAtIso).toBe("2026-08-19T07:00:00.000Z");
    expect(r.remainingMin).toBe(600);
    expect(r.dayNotYetOpen).toBe(true);
  });

  it("defaults to UTC (offset 0) when no tzOffsetMinutes is given", () => {
    // Backward-compat: the prior UTC behavior is exactly offset 0. NOW is 09:00Z,
    // after the 08:00 open, so the day is open and starts at now.
    const withZero = assembleTodaysPath(base({ tzOffsetMinutes: 0 }), NOW);
    const without = assembleTodaysPath(base(), NOW);
    expect(without).toEqual(withZero);
    expect(without.startsAtIso).toBe("2026-08-09T09:00:00.000Z");
    expect(without.dayNotYetOpen).toBe(false);
  });
});
