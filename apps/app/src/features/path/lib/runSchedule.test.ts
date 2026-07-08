import { describe, it, expect } from "vitest";
import { driveMinutesBetween } from "./driveTime";
import {
  annotateRunSchedule,
  type RunScheduleInput,
  type RunStop,
  type RunWaypoint,
  type RunTimeBlock,
} from "./runSchedule";

const iso = (h: number, m = 0) => `2026-07-15T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
const addMin = (s: string, min: number) => new Date(Date.parse(s) + min * 60000).toISOString();
const ORIGIN = { lat: 40, lng: -74 };
const near = (id: string): RunStop => ({ id, name: id, lat: 40, lng: -74.015 });

const base = (over: Partial<RunScheduleInput> = {}): RunScheduleInput => ({
  now: iso(9),
  startLoc: ORIGIN,
  stops: [],
  waypoints: [],
  timeBlocks: [],
  ...over,
});

describe("annotateRunSchedule", () => {
  it("1. no meetings → sequential ETAs from now/startLoc, all fit, no meetings", () => {
    const stops = [near("a"), near("b")];
    const r = annotateRunSchedule(base({ stops }));
    expect(r.meetings).toEqual([]);
    expect(r.stops).toHaveLength(2);
    const d = driveMinutesBetween(ORIGIN, { lat: 40, lng: -74.015 });
    expect(r.stops[0].arrive).toBe(addMin(iso(9), d));
    expect(r.stops[0].depart).toBe(addMin(r.stops[0].arrive, 20));
    expect(r.stops[0].fitsBeforeNextMeeting).toBe(true);
    expect(r.stops[0].nextMeetingId).toBeNull();
    expect(Date.parse(r.stops[1].arrive)).toBeGreaterThanOrEqual(Date.parse(r.stops[0].depart));
  });

  it("2. one reachable located meeting → nextMeetingId set, fits true", () => {
    const wp: RunWaypoint = { id: "m", title: "Meeting", start: iso(17), end: iso(18), lat: 40, lng: -74 };
    const r = annotateRunSchedule(base({ stops: [near("a")], waypoints: [wp] }));
    expect(r.stops[0].nextMeetingId).toBe("m");
    expect(r.stops[0].fitsBeforeNextMeeting).toBe(true);
    expect(r.meetings.map((mtg) => mtg.id)).toEqual(["m"]);
    expect(r.meetings[0].located).toBe(true);
  });

  it("3. stop that overruns the next meeting → fits false", () => {
    const wp: RunWaypoint = { id: "m", title: "Far", start: iso(9, 30), end: iso(10), lat: 41, lng: -74 };
    const r = annotateRunSchedule(base({ stops: [near("a")], waypoints: [wp] }));
    expect(r.stops[0].nextMeetingId).toBe("m");
    expect(r.stops[0].fitsBeforeNextMeeting).toBe(false);
  });

  it("4. located meeting between stops pins the clock and resets the drive origin", () => {
    const wp: RunWaypoint = { id: "m", title: "Mtg", start: iso(10), end: iso(10, 30), lat: 41, lng: -74 };
    const a: RunStop = { id: "a", name: "a", lat: 40, lng: -74 };
    const b: RunStop = { id: "b", name: "b", lat: 41, lng: -74.01 };
    const r = annotateRunSchedule(base({ now: iso(9, 40), stops: [a, b], waypoints: [wp] }));
    expect(Date.parse(r.stops[1].arrive)).toBeGreaterThanOrEqual(Date.parse(iso(10, 30)));
    const driveFromMeeting = driveMinutesBetween({ lat: 41, lng: -74 }, { lat: 41, lng: -74.01 });
    expect(r.stops[1].arrive).toBe(addMin(iso(10, 30), driveFromMeeting));
  });

  it("5. time-block blocks its span with no drive math", () => {
    const block: RunTimeBlock = { id: "lunch", title: "Lunch", start: iso(12), end: iso(13) };
    const r = annotateRunSchedule(base({ now: iso(12), stops: [near("a")], timeBlocks: [block] }));
    const d = driveMinutesBetween(ORIGIN, { lat: 40, lng: -74.015 });
    expect(r.stops[0].arrive).toBe(addMin(iso(13), d));
    expect(r.meetings[0].located).toBe(false);
  });

  it("6. meetings that already ended are dropped", () => {
    const past: RunWaypoint = { id: "past", title: "Past", start: iso(8), end: iso(8, 30), lat: 40, lng: -74 };
    const r = annotateRunSchedule(base({ now: iso(9), stops: [near("a")], waypoints: [past] }));
    expect(r.meetings).toEqual([]);
    expect(r.stops[0].nextMeetingId).toBeNull();
  });

  it("7. empty stops → stops [], meetings still listed", () => {
    const wp: RunWaypoint = { id: "m", title: "M", start: iso(17), end: iso(18), lat: 40, lng: -74 };
    const r = annotateRunSchedule(base({ stops: [], waypoints: [wp] }));
    expect(r.stops).toEqual([]);
    expect(r.meetings).toHaveLength(1);
  });

  it("8. custom dwell/buffer respected", () => {
    const r = annotateRunSchedule(base({ stops: [near("a")], dwellMin: 45 }));
    expect(r.stops[0].depart).toBe(addMin(r.stops[0].arrive, 45));
  });
});
