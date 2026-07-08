import { describe, it, expect } from "vitest";
import { driveMinutesBetween } from "./driveTime";
import {
  scheduleDay,
  type ScheduleInput,
  type FixedWaypoint,
  type SchedProspect,
  type SchedTimeBlock,
  type TimelineEntry,
} from "./scheduleDay";

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (h: number, m = 0) =>
  `2026-07-15T${pad(h)}:${pad(m)}:00.000Z`;

// Mirror the scheduler's own arithmetic so tests assert against the real
// drive-time function rather than fragile hardcoded minutes.
const addMinutes = (isoStr: string, min: number) =>
  new Date(Date.parse(isoStr) + min * 60000).toISOString();
const minutesBetween = (a: string, b: string) =>
  (Date.parse(b) - Date.parse(a)) / 60000;

const DEFAULT_DWELL = 20;

// Origin the rep starts the day from.
const ORIGIN = { lat: 40, lng: -74 };

// A prospect a short hop from the origin (~2.1 min drive).
const prospectNear = (id: string, name = id): SchedProspect => ({
  id,
  name,
  lat: 40,
  lng: -74.015,
});

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);

const isSortedAsc = (timeline: TimelineEntry[]) => {
  const key = (e: TimelineEntry) =>
    Date.parse(e.kind === "prospect" ? e.arrive : e.start);
  for (let i = 1; i < timeline.length; i++) {
    if (key(timeline[i]) < key(timeline[i - 1])) return false;
  }
  return true;
};

const prospectEntries = (t: TimelineEntry[]) =>
  t.filter((e): e is Extract<TimelineEntry, { kind: "prospect" }> => e.kind === "prospect");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scheduleDay", () => {
  it("1. schedules all prospects when there are no fixed events", () => {
    const windowStart = iso(9);
    const windowEnd = iso(18);
    const prospects: SchedProspect[] = [
      prospectNear("p1"),
      { id: "p2", name: "p2", lat: 40.02, lng: -74 },
      { id: "p3", name: "p3", lat: 40.04, lng: -74 },
    ];
    const input: ScheduleInput = {
      windowStart,
      windowEnd,
      origin: ORIGIN,
      waypoints: [],
      timeBlocks: [],
      prospects,
    };

    const result = scheduleDay(input);

    expect(result.unscheduledProspectIds).toEqual([]);
    const ps = prospectEntries(result.timeline);
    expect(ps).toHaveLength(3);
    for (const p of ps) {
      expect(Date.parse(p.arrive)).toBeGreaterThanOrEqual(Date.parse(windowStart));
      expect(Date.parse(p.depart)).toBeLessThanOrEqual(Date.parse(windowEnd));
    }
    // Only prospect entries exist.
    expect(result.timeline.every((e) => e.kind === "prospect")).toBe(true);
    expect(isSortedAsc(result.timeline)).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it("2. keeps a located waypoint at 10:00 and never overlaps it", () => {
    const windowStart = iso(9);
    const windowEnd = iso(18);
    const wp: FixedWaypoint = {
      id: "wp1",
      title: "Big Meeting",
      start: iso(10),
      end: iso(11),
      lat: 40,
      lng: -74,
    };
    // Supply more prospects than fit before 10:00; extras land after the
    // waypoint or go unscheduled. Either way none may overlap the meeting.
    const prospects: SchedProspect[] = [
      prospectNear("p1"),
      prospectNear("p2"),
      prospectNear("p3"),
      prospectNear("p4"),
      prospectNear("p5"),
      prospectNear("p6"),
    ];
    const input: ScheduleInput = {
      windowStart,
      windowEnd,
      origin: ORIGIN,
      waypoints: [wp],
      timeBlocks: [],
      prospects,
    };

    const result = scheduleDay(input);

    const wpEntry = result.timeline.find((e) => e.kind === "waypoint" && e.id === "wp1");
    expect(wpEntry).toBeDefined();
    expect(wpEntry).toMatchObject({ kind: "waypoint", start: iso(10), end: iso(11) });

    for (const p of prospectEntries(result.timeline)) {
      expect(overlaps(p.arrive, p.depart, iso(10), iso(11))).toBe(false);
    }
    expect(isSortedAsc(result.timeline)).toBe(true);
  });

  it("3. flags a conflict when two located waypoints are unreachable in their gap", () => {
    const windowStart = iso(9);
    const windowEnd = iso(18);
    const a: FixedWaypoint = {
      id: "a",
      title: "Downtown",
      start: iso(9, 30),
      end: iso(10),
      lat: 40,
      lng: -74,
    };
    // B starts only 10 min after A ends, but is ~69 min of driving away.
    const b: FixedWaypoint = {
      id: "b",
      title: "Far Suburb",
      start: iso(10, 10),
      end: iso(11),
      lat: 40.5,
      lng: -74,
    };
    const input: ScheduleInput = {
      windowStart,
      windowEnd,
      origin: ORIGIN,
      waypoints: [a, b],
      timeBlocks: [],
      prospects: [],
    };

    const result = scheduleDay(input);

    // Sanity: the geometry really is infeasible.
    const drive = driveMinutesBetween({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
    expect(drive).toBeGreaterThan(minutesBetween(a.end, b.start));

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].betweenTitles).toEqual(["Downtown", "Far Suburb"]);
    expect(result.conflicts[0].detail).toMatch(/apart.*drive/);
  });

  it("4. never schedules a prospect inside a time-block", () => {
    const windowStart = iso(9);
    const windowEnd = iso(18);
    const block: SchedTimeBlock = {
      id: "lunch",
      title: "Lunch",
      start: iso(12),
      end: iso(13),
    };
    const prospects: SchedProspect[] = [
      prospectNear("p1"),
      prospectNear("p2"),
      prospectNear("p3"),
      prospectNear("p4"),
    ];
    const input: ScheduleInput = {
      windowStart,
      windowEnd,
      origin: ORIGIN,
      waypoints: [],
      timeBlocks: [block],
      prospects,
    };

    const result = scheduleDay(input);

    const blockEntry = result.timeline.find((e) => e.kind === "timeblock" && e.id === "lunch");
    expect(blockEntry).toMatchObject({ kind: "timeblock", start: iso(12), end: iso(13) });
    for (const p of prospectEntries(result.timeline)) {
      expect(overlaps(p.arrive, p.depart, iso(12), iso(13))).toBe(false);
    }
    expect(isSortedAsc(result.timeline)).toBe(true);
  });

  it("5. nearest-that-fits: the nearest prospect overflows but a farther one fits", () => {
    // Gap 09:00 -> exit waypoint at 10:30 (loc = far north). ~90 min gap.
    // pNear (south of origin, ~27.6 min): nearest from origin, but its return
    //   leg all the way north blows the deadline (~127 min round-trip).
    // pFar (at the exit location, ~41.5 min): farther, but ~0 return (~72 min).
    const windowStart = iso(9);
    const windowEnd = iso(18);
    const exitWp: FixedWaypoint = {
      id: "exit",
      title: "Anchor",
      start: iso(10, 30),
      end: iso(11),
      lat: 40.3,
      lng: -74,
    };
    const pNear: SchedProspect = { id: "pNear", name: "pNear", lat: 39.8, lng: -74 };
    const pFar: SchedProspect = { id: "pFar", name: "pFar", lat: 40.3, lng: -74 };
    const input: ScheduleInput = {
      windowStart,
      windowEnd,
      origin: ORIGIN,
      waypoints: [exitWp],
      timeBlocks: [],
      prospects: [pNear, pFar],
    };

    // Sanity: pNear is genuinely nearer to the origin than pFar.
    const dNear = driveMinutesBetween(ORIGIN, { lat: pNear.lat, lng: pNear.lng });
    const dFar = driveMinutesBetween(ORIGIN, { lat: pFar.lat, lng: pFar.lng });
    expect(dNear).toBeLessThan(dFar);

    const result = scheduleDay(input);

    // pFar (farther from origin) wins the first gap because its round trip
    // clears the anchor deadline; pNear does not fit the first gap.
    const pFarEntry = prospectEntries(result.timeline).find((p) => p.id === "pFar")!;
    expect(pFarEntry).toBeDefined();
    expect(Date.parse(pFarEntry.depart)).toBeLessThanOrEqual(Date.parse(exitWp.start));
    expect(overlaps(pFarEntry.arrive, pFarEntry.depart, exitWp.start, exitWp.end)).toBe(false);

    // pNear overflows the first gap. It may still land in a *later* gap (after
    // the anchor) or be left unscheduled — but it must NOT be in the first gap.
    const pNearEntry = prospectEntries(result.timeline).find((p) => p.id === "pNear");
    if (pNearEntry) {
      expect(Date.parse(pNearEntry.arrive)).toBeGreaterThanOrEqual(Date.parse(exitWp.end));
    } else {
      expect(result.unscheduledProspectIds).toContain("pNear");
    }
  });

  it("6. empty prospects → timeline is exactly the fixed entries", () => {
    const windowStart = iso(9);
    const windowEnd = iso(18);
    const wp: FixedWaypoint = {
      id: "wp1",
      title: "Meeting",
      start: iso(10),
      end: iso(11),
      lat: 40,
      lng: -74,
    };
    const block: SchedTimeBlock = { id: "lunch", title: "Lunch", start: iso(12), end: iso(13) };
    const input: ScheduleInput = {
      windowStart,
      windowEnd,
      origin: ORIGIN,
      waypoints: [wp],
      timeBlocks: [block],
      prospects: [],
    };

    const result = scheduleDay(input);

    expect(result.unscheduledProspectIds).toEqual([]);
    expect(prospectEntries(result.timeline)).toHaveLength(0);
    expect(result.timeline).toEqual([
      { kind: "waypoint", id: "wp1", title: "Meeting", start: iso(10), end: iso(11) },
      { kind: "timeblock", id: "lunch", title: "Lunch", start: iso(12), end: iso(13) },
    ]);
  });

  it("7. ETA math: single prospect, no waypoints", () => {
    const windowStart = iso(9);
    const windowEnd = iso(18);
    const p = prospectNear("p1");
    const input: ScheduleInput = {
      windowStart,
      windowEnd,
      origin: ORIGIN,
      waypoints: [],
      timeBlocks: [],
      prospects: [p],
    };

    const result = scheduleDay(input);

    const drive = driveMinutesBetween(ORIGIN, { lat: p.lat, lng: p.lng });
    const expectedArrive = addMinutes(windowStart, drive);
    const expectedDepart = addMinutes(expectedArrive, DEFAULT_DWELL);

    const entry = prospectEntries(result.timeline)[0];
    expect(entry.id).toBe("p1");
    expect(entry.arrive).toBe(expectedArrive);
    expect(entry.depart).toBe(expectedDepart);
  });

  it("respects custom dwellMin and bufferMin", () => {
    const windowStart = iso(9);
    const windowEnd = iso(18);
    const p = prospectNear("p1");
    const input: ScheduleInput = {
      windowStart,
      windowEnd,
      origin: ORIGIN,
      waypoints: [],
      timeBlocks: [],
      prospects: [p],
      dwellMin: 45,
      bufferMin: 5,
    };

    const result = scheduleDay(input);
    const drive = driveMinutesBetween(ORIGIN, { lat: p.lat, lng: p.lng });
    const entry = prospectEntries(result.timeline)[0];
    expect(entry.arrive).toBe(addMinutes(windowStart, drive));
    expect(entry.depart).toBe(addMinutes(entry.arrive, 45));
  });

  it("8. first gap after a located meeting measures drive from the meeting, not origin", () => {
    // Regression: when the rep's first calendar event of the day is a located
    // meeting, the first free gap opens AT the meeting's location — not at the
    // rep's origin. ETAs and feasibility for drop-ins in that gap must be
    // measured from the meeting the rep just left, or every morning-gap ETA is
    // wildly wrong (route-around's primary case: the day starts with a meeting).
    const windowStart = iso(9);
    const windowEnd = iso(18);
    const meeting: FixedWaypoint = {
      id: "m1",
      title: "Morning Meeting",
      start: iso(9), // opens exactly at the window → first free gap is gapIndex 0
      end: iso(9, 30),
      lat: 41, // ~69 miles / ~138 min north of the (40,-74) origin
      lng: -74,
    };
    // A prospect right next to the meeting — but far from origin.
    const p1: SchedProspect = { id: "p1", name: "Near Meeting", lat: 41, lng: -74.01 };
    const input: ScheduleInput = {
      windowStart,
      windowEnd,
      origin: ORIGIN,
      waypoints: [meeting],
      timeBlocks: [],
      prospects: [p1],
    };

    const result = scheduleDay(input);

    const entry = prospectEntries(result.timeline).find((p) => p.id === "p1");
    expect(entry).toBeDefined();

    const meetingLoc = { lat: meeting.lat, lng: meeting.lng };
    const p1Loc = { lat: p1.lat, lng: p1.lng };
    const driveFromMeeting = driveMinutesBetween(meetingLoc, p1Loc);
    const driveFromOrigin = driveMinutesBetween(ORIGIN, p1Loc);
    // Sanity: the two vantage points give very different drive times, so the
    // assertion truly discriminates the bug (not an accidental coincidence).
    expect(Math.abs(driveFromOrigin - driveFromMeeting)).toBeGreaterThan(60);

    // The gap opens at the meeting's end (09:30) at the meeting's location.
    const expectedArrive = addMinutes(iso(9, 30), driveFromMeeting);
    const fromOriginArrive = addMinutes(iso(9, 30), driveFromOrigin);
    expect(entry!.arrive).toBe(expectedArrive);
    expect(entry!.arrive).not.toBe(fromOriginArrive);
  });

  it("clamps fixed spans to the window", () => {
    // Waypoint starts before the window opens; it should be clamped to windowStart.
    const windowStart = iso(9);
    const windowEnd = iso(18);
    const wp: FixedWaypoint = {
      id: "early",
      title: "Early Bird",
      start: iso(8),
      end: iso(9, 30),
      lat: 40,
      lng: -74,
    };
    const input: ScheduleInput = {
      windowStart,
      windowEnd,
      origin: ORIGIN,
      waypoints: [wp],
      timeBlocks: [],
      prospects: [prospectNear("p1")],
    };

    const result = scheduleDay(input);
    // No prospect may land before 09:30 (the clamped end of the waypoint).
    for (const p of prospectEntries(result.timeline)) {
      expect(Date.parse(p.arrive)).toBeGreaterThanOrEqual(Date.parse(windowStart));
      expect(overlaps(p.arrive, p.depart, windowStart, iso(9, 30))).toBe(false);
    }
  });
});
