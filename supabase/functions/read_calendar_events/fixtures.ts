// CALENDAR_MOCK=1 fixture — mirrors the normalized RawCalendarEvent shape the
// index builds from Google's events.list, hitting every classifier branch:
// a located meeting, a no-location call, a private event, an all-day block,
// a declined invite, and a personal-calendar event.
import type { RawCalendarEvent } from "../_shared/calendarQualify.ts";

export function mockCalendarEvents(windowStart: string): RawCalendarEvent[] {
  const day = windowStart.slice(0, 10);
  const at = (h: number, m = 0) => `${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
  return [
    { id: "m1", calendarId: "work@x.com", summary: "Joe's Diner appt", start: at(15), end: at(16), isAllDay: false, status: "confirmed", visibility: "default", responseStatus: "accepted", location: "2640 Exchange Dr, Edmond, OK" },
    { id: "m2", calendarId: "work@x.com", summary: "Phone check-in", start: at(17), end: at(17, 30), isAllDay: false, status: "confirmed", visibility: "default", responseStatus: "accepted", location: "" },
    { id: "m3", calendarId: "work@x.com", summary: "Private thing", start: at(18), end: at(19), isAllDay: false, status: "confirmed", visibility: "private", responseStatus: "accepted", location: "somewhere" },
    { id: "m4", calendarId: "work@x.com", summary: "Conference (all day)", start: null, end: null, isAllDay: true, status: "confirmed", visibility: "default", responseStatus: "accepted", location: "" },
    { id: "m5", calendarId: "work@x.com", summary: "Declined invite", start: at(20), end: at(21), isAllDay: false, status: "confirmed", visibility: "default", responseStatus: "declined", location: "1 Somewhere Rd" },
    { id: "m6", calendarId: "personal@x.com", summary: "Dentist", start: at(21), end: at(22), isAllDay: false, status: "confirmed", visibility: "default", responseStatus: "accepted", location: "5 Tooth Ln" },
  ];
}
