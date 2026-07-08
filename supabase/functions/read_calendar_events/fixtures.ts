// CALENDAR_MOCK=1 fixture — mirrors the normalized RawCalendarEvent shape the
// index builds from Google's events.list, hitting every classifier branch:
// a located meeting, a no-location call, a private event, an all-day block,
// a declined invite, a personal-calendar event, and a navigatr-pushed event.
// MICROSOFT_CALENDAR_MOCK=1 uses mockMicrosoftCalendarEvents (Graph-normalized).
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
    // A navigatr-pushed appointment (tagged with our appointment id): already
    // represented natively, so it must be classified "excluded" (skipped) and
    // must NOT reappear as a waypoint on the read.
    { id: "m7", calendarId: "work@x.com", summary: "Navigatr appt (pushed)", start: at(22), end: at(23), isAllDay: false, status: "confirmed", visibility: "default", responseStatus: "accepted", location: "77 Seed St, Edmond, OK", navigatrAppointmentId: "seed-appt-1" },
  ];
}

// MICROSOFT_CALENDAR_MOCK=1 fixture — the Graph-normalized RawCalendarEvent shape
// the microsoft provider produces (calendarId "microsoft-primary", visibility
// from Graph sensitivity, status "confirmed"/"cancelled", no navigatr push yet).
// Hits every classifier branch so the union read path is testable:
// a located meeting, a no-location sync, a private event, an all-day block,
// a declined invite, and a cancelled event.
export function mockMicrosoftCalendarEvents(windowStart: string): RawCalendarEvent[] {
  const day = windowStart.slice(0, 10);
  const at = (h: number, m = 0) => `${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
  return [
    { id: "ms1", calendarId: "microsoft-primary", summary: "Outlook client visit", start: at(9), end: at(10), isAllDay: false, status: "confirmed", visibility: "normal", responseStatus: "accepted", location: "100 Broadway, Oklahoma City, OK", navigatrAppointmentId: null },
    { id: "ms2", calendarId: "microsoft-primary", summary: "Teams sync", start: at(11), end: at(11, 30), isAllDay: false, status: "confirmed", visibility: "normal", responseStatus: "accepted", location: null, navigatrAppointmentId: null },
    { id: "ms3", calendarId: "microsoft-primary", summary: "Private review", start: at(12), end: at(13), isAllDay: false, status: "confirmed", visibility: "private", responseStatus: "accepted", location: "somewhere", navigatrAppointmentId: null },
    { id: "ms4", calendarId: "microsoft-primary", summary: "Offsite (all day)", start: null, end: null, isAllDay: true, status: "confirmed", visibility: "normal", responseStatus: "accepted", location: null, navigatrAppointmentId: null },
    { id: "ms5", calendarId: "microsoft-primary", summary: "Declined invite", start: at(14), end: at(15), isAllDay: false, status: "confirmed", visibility: "normal", responseStatus: "declined", location: "9 Declined Dr", navigatrAppointmentId: null },
    { id: "ms6", calendarId: "microsoft-primary", summary: "Cancelled meeting", start: at(16), end: at(17), isAllDay: false, status: "cancelled", visibility: "normal", responseStatus: "accepted", location: "8 Cancelled Ct", navigatrAppointmentId: null },
  ];
}
