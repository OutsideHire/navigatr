// Pure, Deno-free so vitest unit-tests it from the app; the read_calendar_events
// Edge function imports it with the .ts extension. Slice 1 qualification subset:
// personal-calendar / all-day / cancelled / declined / private are excluded;
// remaining events with a location string are geocode candidates ("located"),
// the rest are time blocks. Geocoding itself happens in the Edge, not here.

export interface RawCalendarEvent {
  id: string;
  calendarId: string;
  summary: string | null;
  start: string | null; // ISO datetime; null when absent or all-day
  end: string | null;
  isAllDay: boolean;
  status: string | null;         // 'confirmed' | 'tentative' | 'cancelled'
  visibility: string | null;     // 'default' | 'public' | 'private' | 'confidential'
  responseStatus: string | null; // rep's own: 'accepted' | 'declined' | 'tentative' | 'needsAction'
  location: string | null;       // free-text address; may be empty
}

export type EventClass = "located" | "time_block" | "excluded";

export function classifyEvent(ev: RawCalendarEvent, personalCalendarIds: string[]): EventClass {
  if (personalCalendarIds.includes(ev.calendarId)) return "excluded";
  if (ev.isAllDay) return "excluded";
  if (ev.status === "cancelled") return "excluded";
  if (ev.responseStatus === "declined") return "excluded";
  if (ev.visibility === "private" || ev.visibility === "confidential") return "excluded";
  if (!ev.start || !ev.end) return "excluded";
  const hasLocation = typeof ev.location === "string" && ev.location.trim().length > 0;
  return hasLocation ? "located" : "time_block";
}
