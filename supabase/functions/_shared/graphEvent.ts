// Pure builders for a Microsoft Graph event body from a navigatr item. The
// Outlook counterpart of googleEvent.ts. Shared by the microsoft provider
// (write) and unit-tested from the app.
//
// Timed appointments are tagged with a singleValueExtendedProperty so
// read_calendar_events can dedup them (never re-show a pushed appointment as a
// waypoint), the same role Google's extendedProperties play. Follow-up + path
// blocks are all-day, which the Path read already excludes, so they need no tag.
import type { AppointmentForEvent, FollowupDealForEvent, PathForBlockEvent } from "./googleEvent.ts";

// A named MAPI string property in the public-strings namespace. The value is the
// navigatr appointment id; read_calendar_events expands this and maps it onto
// RawCalendarEvent.navigatrAppointmentId.
export const NAVIGATR_APPT_PROP_ID =
  "String {00020329-0000-0000-C000-000000000046} Name navigatr_appointment_id";

interface GraphDateTime {
  dateTime: string; // "YYYY-MM-DDTHH:mm:ss" (no trailing Z; timeZone carries the zone)
  timeZone: string;
}

export interface GraphEventBody {
  subject: string;
  body?: { contentType: "text"; content: string };
  start: GraphDateTime;
  end: GraphDateTime;
  isAllDay?: boolean;
  location?: { displayName: string };
  attendees?: Array<{ emailAddress: { address: string }; type: "required" }>;
  singleValueExtendedProperties?: Array<{ id: string; value: string }>;
}

// Graph wants a local-style dateTime with the zone in a separate field, not a
// trailing Z. An ISO instant's first 19 chars are "YYYY-MM-DDTHH:mm:ss".
function graphDateTime(iso: string, timeZone: string): GraphDateTime {
  return { dateTime: iso.slice(0, 19), timeZone };
}

/** Timed appointment, tagged for read-dedup. `timeZone` names the zone the
 *  absolute instants should be interpreted in (callers pass "UTC" today). */
export function buildGraphAppointment(
  appt: AppointmentForEvent,
  attendeeEmails: string[],
  timeZone: string,
): GraphEventBody {
  const body: GraphEventBody = {
    subject: appt.title,
    start: graphDateTime(appt.startAt, timeZone),
    end: graphDateTime(appt.endAt, timeZone),
    singleValueExtendedProperties: [{ id: NAVIGATR_APPT_PROP_ID, value: appt.id }],
  };
  if (appt.locationAddress && appt.locationAddress.trim()) {
    body.location = { displayName: appt.locationAddress.trim() };
  }
  const emails = attendeeEmails.filter((e) => !!e && e.includes("@"));
  if (emails.length) {
    body.attendees = emails.map((address) => ({ emailAddress: { address }, type: "required" as const }));
  }
  const desc = [appt.notes?.trim(), "Scheduled via navigatr"].filter(Boolean).join("\n\n");
  if (desc) body.body = { contentType: "text", content: desc };
  return body;
}

// Graph all-day events set isAllDay + start/end at midnight with an EXCLUSIVE
// end, matching Google's all-day convention (single day ends the next day).
function allDayRange(startDate: string): { start: GraphDateTime; end: GraphDateTime } {
  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endDate = end.toISOString().slice(0, 10);
  return {
    start: { dateTime: `${startDate}T00:00:00`, timeZone: "UTC" },
    end: { dateTime: `${endDate}T00:00:00`, timeZone: "UTC" },
  };
}

/** All-day follow-up reminder. Takes the UTC date portion of next_followup_at. */
export function buildGraphFollowup(deal: FollowupDealForEvent, followUpDateISO: string): GraphEventBody {
  const startDate = followUpDateISO.slice(0, 10);
  return {
    subject: `Follow up: ${deal.companyName}`,
    isAllDay: true,
    ...allDayRange(startDate),
    body: { contentType: "text", content: `navigatr follow-up for ${deal.companyName}` },
  };
}

/** All-day block for a planned prospecting day. pathDate is already a date. */
export function buildGraphPathBlock(path: PathForBlockEvent): GraphEventBody {
  const name = path.name?.trim();
  return {
    subject: name ? `Prospecting: ${name}` : "Prospecting",
    isAllDay: true,
    ...allDayRange(path.pathDate),
    body: { contentType: "text", content: "navigatr planned prospecting day" },
  };
}
