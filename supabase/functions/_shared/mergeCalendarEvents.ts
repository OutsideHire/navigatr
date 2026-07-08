// Pure, Deno-free helpers for the read_calendar_events union pipeline: applying a
// connection's personal-calendar filter, flattening the per-connection event
// lists into one union, and folding per-connection success into an overall
// response status. Kept Deno-free so vitest unit-tests it from the app the same
// way it imports calendarQualify.ts; the Edge index imports it with the .ts
// extension.
import type { RawCalendarEvent } from "./calendarQualify.ts";

/**
 * Drop events that belong to one of the connection's personal calendars. The net
 * effect matches the old Google read, which filtered personal calendars out at
 * the calendarList level before reading their events — here the provider returns
 * every event and we filter by `calendarId` instead.
 */
export function applyPersonalFilter(
  events: RawCalendarEvent[],
  personalCalendarIds: string[],
): RawCalendarEvent[] {
  if (personalCalendarIds.length === 0) return events;
  return events.filter((ev) => !personalCalendarIds.includes(ev.calendarId));
}

/** Flatten each connection's events into a single union list, preserving order. */
export function mergeConnections(perConnection: RawCalendarEvent[][]): RawCalendarEvent[] {
  return perConnection.flat();
}

/**
 * Fold per-connection outcomes into the response status. No connections at all
 * → "not_connected"; at least one connection succeeded → "ok"; otherwise (every
 * connection failed its token refresh / list) → "needs_reconnect".
 */
export function overallStatus(
  results: Array<{ ok: boolean }>,
): "ok" | "needs_reconnect" | "not_connected" {
  if (results.length === 0) return "not_connected";
  if (results.some((r) => r.ok)) return "ok";
  return "needs_reconnect";
}
