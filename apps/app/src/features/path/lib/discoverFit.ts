import { driveMinutesBetween } from "./driveTime";
import type { CalendarWaypoint, CalendarTimeBlock } from "../hooks/useCalendarEvents";

export interface FitLatLng { lat: number; lng: number }
export interface NextMeeting { id: string; title: string; start: string; loc: FitLatLng | null }

// Mirrors the running path's defaults + fit rule (see runSchedule.ts).
const DEFAULT_DWELL_MIN = 20;
const DEFAULT_BUFFER_MIN = 10;

const addMinutes = (iso: string, min: number): string =>
  new Date(Date.parse(iso) + min * 60000).toISOString();

/** Earliest meeting today whose start is still in the future, or null. */
export function pickNextMeeting(
  now: string,
  waypoints: CalendarWaypoint[],
  timeBlocks: CalendarTimeBlock[],
): NextMeeting | null {
  const nowMs = Date.parse(now);
  const merged: NextMeeting[] = [
    ...waypoints.map((w) => ({ id: w.id, title: w.title, start: w.start, loc: { lat: w.lat, lng: w.lng } as FitLatLng | null })),
    ...timeBlocks.map((b) => ({ id: b.id, title: b.title, start: b.start, loc: null as FitLatLng | null })),
  ]
    .filter((m) => Date.parse(m.start) > nowMs)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return merged[0] ?? null;
}

/**
 * Does a drop-in at `merchant`, starting from `origin` right now, still leave
 * time to reach `meeting` on time? Same rule as the running path:
 *   arrive = now + drive(origin -> merchant); depart = arrive + dwell;
 *   fits = depart + (meeting.loc ? drive(merchant -> meeting.loc) : 0) + buffer <= meeting.start
 */
export function fitsBeforeMeeting(
  now: string,
  origin: FitLatLng,
  merchant: FitLatLng,
  meeting: NextMeeting,
  dwellMin: number = DEFAULT_DWELL_MIN,
  bufferMin: number = DEFAULT_BUFFER_MIN,
): boolean {
  const arrive = addMinutes(now, driveMinutesBetween(origin, merchant));
  const depart = addMinutes(arrive, dwellMin);
  const returnDrive = meeting.loc ? driveMinutesBetween(merchant, meeting.loc) : 0;
  return Date.parse(addMinutes(depart, returnDrive + bufferMin)) <= Date.parse(meeting.start);
}
