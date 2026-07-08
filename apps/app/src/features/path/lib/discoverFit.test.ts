import { describe, it, expect } from "vitest";
import { driveMinutesBetween } from "./driveTime";
import { pickNextMeeting, fitsBeforeMeeting, type NextMeeting } from "./discoverFit";
import type { CalendarWaypoint, CalendarTimeBlock } from "../hooks/useCalendarEvents";

const iso = (h: number, m = 0) => `2026-07-15T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
const addMin = (s: string, min: number) => new Date(Date.parse(s) + min * 60000).toISOString();
const ORIGIN = { lat: 40, lng: -74 };

const wp = (id: string, startH: number, lat = 40, lng = -74): CalendarWaypoint => ({
  id, title: id, start: iso(startH), end: iso(startH + 1), address: "x", lat, lng, source: "calendar",
});
const tb = (id: string, startH: number): CalendarTimeBlock => ({
  id, title: id, start: iso(startH), end: iso(startH + 1), reason: "no_location",
});

describe("pickNextMeeting", () => {
  it("returns the earliest FUTURE meeting, merging waypoints + time-blocks", () => {
    const m = pickNextMeeting(iso(9), [wp("a", 15)], [tb("b", 12)]);
    expect(m?.id).toBe("b");
    expect(m?.loc).toBeNull();
  });
  it("ignores meetings that already started (start <= now)", () => {
    const m = pickNextMeeting(iso(13), [wp("past", 9), wp("next", 16)], []);
    expect(m?.id).toBe("next");
  });
  it("returns null when there is no future meeting", () => {
    expect(pickNextMeeting(iso(18), [wp("past", 9)], [])).toBeNull();
    expect(pickNextMeeting(iso(9), [], [])).toBeNull();
  });
  it("carries the located waypoint's coordinates", () => {
    const m = pickNextMeeting(iso(9), [wp("a", 12, 41, -74.5)], []);
    expect(m?.loc).toEqual({ lat: 41, lng: -74.5 });
  });
});

describe("fitsBeforeMeeting", () => {
  const near = { lat: 40, lng: -74.01 };
  it("true when the drop-in comfortably precedes the meeting", () => {
    const meeting: NextMeeting = { id: "m", title: "M", start: iso(17), loc: { lat: 40, lng: -74 } };
    expect(fitsBeforeMeeting(iso(9), ORIGIN, near, meeting)).toBe(true);
  });
  it("false when the drop-in overruns the meeting", () => {
    const meeting: NextMeeting = { id: "m", title: "M", start: iso(9, 5), loc: { lat: 40, lng: -74 } };
    expect(fitsBeforeMeeting(iso(9), ORIGIN, near, meeting)).toBe(false);
  });
  it("time-block meeting drops the return-drive term", () => {
    const meeting: NextMeeting = { id: "b", title: "Lunch", start: iso(9, 30), loc: null };
    expect(fitsBeforeMeeting(iso(9), ORIGIN, near, meeting)).toBe(false);
    expect(fitsBeforeMeeting(iso(9), ORIGIN, near, { ...meeting, start: iso(9, 40) })).toBe(true);
  });
  it("respects custom dwell/buffer", () => {
    const meeting: NextMeeting = { id: "m", title: "M", start: iso(9, 40), loc: null };
    expect(fitsBeforeMeeting(iso(9), ORIGIN, near, meeting, 45, 10)).toBe(false);
  });
  it("matches the arrive/depart math of driveMinutesBetween", () => {
    const meeting: NextMeeting = { id: "m", title: "M", start: iso(17), loc: null };
    const drive = driveMinutesBetween(ORIGIN, near);
    expect(Date.parse(addMin(iso(9), drive))).toBeGreaterThan(Date.parse(iso(9)));
    expect(fitsBeforeMeeting(iso(9), ORIGIN, near, meeting)).toBe(true);
  });
});
