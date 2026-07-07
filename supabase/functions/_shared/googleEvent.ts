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
