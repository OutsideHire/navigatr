// Pure builder for a Google Calendar event body from a navigatr scheduled
// appointment. Shared by the sync_appointment Edge fn (write) and unit-tested
// from the app. The navigatr_appointment_id extended property tags the event as
// ours so read_calendar_events can dedup it (never re-show it as a waypoint).
export interface AppointmentForEvent {
  id: string;
  title: string;
  startAt: string; // ISO
  endAt: string;   // ISO
  locationAddress: string | null;
  notes: string | null;
}
export interface GoogleEventBody {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: string;
  description?: string;
  attendees?: Array<{ email: string }>;
  extendedProperties: { private: { navigatr_appointment_id: string } };
}
export function buildGoogleEventPayload(
  appt: AppointmentForEvent,
  attendeeEmails: string[],
  timeZone: string,
): GoogleEventBody {
  const body: GoogleEventBody = {
    summary: appt.title,
    start: { dateTime: appt.startAt, timeZone },
    end: { dateTime: appt.endAt, timeZone },
    extendedProperties: { private: { navigatr_appointment_id: appt.id } },
  };
  if (appt.locationAddress && appt.locationAddress.trim()) body.location = appt.locationAddress.trim();
  const emails = attendeeEmails.filter((e) => !!e && e.includes("@"));
  if (emails.length) body.attendees = emails.map((email) => ({ email }));
  const desc = [appt.notes?.trim(), "Scheduled via navigatr"].filter(Boolean).join("\n\n");
  if (desc) body.description = desc;
  return body;
}

export interface FollowupDealForEvent {
  id: string;
  companyName: string;
}
export interface GoogleAllDayEventBody {
  summary: string;
  start: { date: string };
  end: { date: string };
  description?: string;
  extendedProperties: { private: Record<string, string> };
}
// All-day follow-up reminder. Google all-day events use start.date/end.date
// (YYYY-MM-DD) with an EXCLUSIVE end, so a single-day reminder ends the next day.
// We take the UTC date portion of next_followup_at (follow-ups are date-intent).
export function buildFollowupEvent(deal: FollowupDealForEvent, followUpDateISO: string): GoogleAllDayEventBody {
  const startDate = followUpDateISO.slice(0, 10);
  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endDate = end.toISOString().slice(0, 10);
  return {
    summary: `Follow up: ${deal.companyName}`,
    start: { date: startDate },
    end: { date: endDate },
    description: `navigatr follow-up for ${deal.companyName}`,
    extendedProperties: { private: { navigatr_followup_deal_id: deal.id } },
  };
}

export interface PathForBlockEvent {
  id: string;
  name: string;
  pathDate: string; // YYYY-MM-DD (already a calendar day; no tz slicing)
}
// All-day block for a planned prospecting day. Google all-day end is EXCLUSIVE,
// so a single-day block ends the next day. pathDate is a DATE already.
export function buildPathBlockEvent(path: PathForBlockEvent): GoogleAllDayEventBody {
  const startDate = path.pathDate;
  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endDate = end.toISOString().slice(0, 10);
  const name = path.name?.trim();
  return {
    summary: name ? `Prospecting: ${name}` : "Prospecting",
    start: { date: startDate },
    end: { date: endDate },
    description: "navigatr planned prospecting day",
    extendedProperties: { private: { navigatr_path_id: path.id } },
  };
}
