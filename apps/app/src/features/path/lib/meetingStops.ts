/**
 * Meeting stops (Slice 5A), assemble the day's *meetings* into time-ordered,
 * normalized stops the Path Stops view can render. Two sources:
 *   1. navigatr-booked appointments (the `scheduled_appointments` rows a rep's
 *      day carries, a deal ref, a start/end, and an optional location), and
 *   2. external located calendar meetings (the `waypoints` the calendar read
 *      returns, real lat/lng events the rep must be at, not booked in navigatr).
 *
 * Pure: takes the two row sets + a `nowIso` and joins/normalizes them in memory
 * (no network, no Date.now). Follows the `assembleOwedVisits` convention, narrow
 * structural input types, one map/filter/sort pass, deterministic output.
 *
 * DE-DUP: a navigatr appointment that is mirrored onto the calendar would come
 * back BOTH as an appointment and as an external waypoint. We keep the
 * appointment and drop the mirror. The calendar-waypoint shape today has NO
 * explicit `navigatrAppointmentId`, so the reliable link is
 * `appointment.calendarEventId === waypoint.id` (the mirrored event's id). We
 * dedupe on that, and ALSO honor a `navigatrAppointmentId` on the waypoint if a
 * future calendar read starts supplying one. See the shape note in the report.
 */

/** The appointment fields a meeting stop needs. Structurally satisfied by
 *  `ScheduledAppointment` (features/appointments/types.ts); `dealName` is
 *  optional because that row does not currently carry a deal name. */
export interface MeetingStopAppointment {
  id: string;
  dealId: string | null;
  dealName?: string | null;
  title: string;
  startAt: string;
  endAt: string | null;
  locationAddress: string | null;
  locationLat: number | null;
  locationLng: number | null;
  /** The mirrored Google event id, when synced, the dedup link to a waypoint. */
  calendarEventId: string | null;
}

/** The calendar-waypoint fields a meeting stop needs. Structurally satisfied by
 *  `CalendarWaypoint` (path/hooks/useCalendarEvents.ts). `navigatrAppointmentId`
 *  is optional and forward-looking, the current read does not supply it. */
export interface MeetingStopWaypoint {
  id: string;
  title: string;
  start: string;
  end: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  navigatrAppointmentId?: string | null;
}

/** A normalized, time-placeable meeting on the rep's day. */
export interface MeetingStop {
  id: string;
  kind: "appointment" | "external";
  title: string;
  dealId: string | null;
  dealName: string | null;
  startAt: string;
  endAt: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  appointmentId: string | null;
  past: boolean;
}

/** ms since epoch for an ISO timestamp, or NaN when unparseable. */
function ms(iso: string | null): number {
  if (!iso) return NaN;
  return new Date(iso).getTime();
}

/** A stop is past when its end (or start, if no end) is strictly before now. */
function isPast(startAt: string, endAt: string | null, nowMs: number): boolean {
  const ref = endAt ? ms(endAt) : ms(startAt);
  if (Number.isNaN(ref)) return false;
  return ref < nowMs;
}

/**
 * Assemble today's appointments + external located waypoints into normalized,
 * time-ordered `MeetingStop`s.
 *
 * - Appointments become `kind:"appointment"` stops (appointmentId set; deal
 *   ref + optional name; location if the row carries one, else null).
 * - Located external waypoints become `kind:"external"` stops. A waypoint with
 *   no usable lat/lng is excluded. `appointmentId` stays null unless the
 *   waypoint carries an explicit `navigatrAppointmentId`.
 * - A waypoint that mirrors an appointment already in the list is dropped
 *   (matched by `appointment.calendarEventId === waypoint.id`, or by an
 *   explicit `waypoint.navigatrAppointmentId === appointment.id`).
 * - `past` is set from `nowIso`. Output is sorted ascending by `startAt`.
 */
export function assembleMeetingStops(
  appointments: MeetingStopAppointment[],
  waypoints: MeetingStopWaypoint[],
  nowIso: string,
): MeetingStop[] {
  const nowMs = ms(nowIso);
  const stops: MeetingStop[] = [];

  // Appointment stops + the dedup keys they claim.
  const appointmentIds = new Set<string>();
  const mirroredEventIds = new Set<string>();
  for (const a of appointments) {
    appointmentIds.add(a.id);
    if (a.calendarEventId) mirroredEventIds.add(a.calendarEventId);
    stops.push({
      id: a.id,
      kind: "appointment",
      title: a.title,
      dealId: a.dealId ?? null,
      dealName: a.dealName ?? null,
      startAt: a.startAt,
      endAt: a.endAt ?? null,
      lat: a.locationLat ?? null,
      lng: a.locationLng ?? null,
      address: a.locationAddress ?? null,
      appointmentId: a.id,
      past: isPast(a.startAt, a.endAt ?? null, nowMs),
    });
  }

  // External stops: located, and not a mirror of an appointment we already have.
  for (const w of waypoints) {
    if (w.lat == null || w.lng == null) continue; // no usable location
    const mirrorsById = mirroredEventIds.has(w.id);
    const mirrorsByRef =
      w.navigatrAppointmentId != null && appointmentIds.has(w.navigatrAppointmentId);
    if (mirrorsById || mirrorsByRef) continue;
    stops.push({
      id: w.id,
      kind: "external",
      title: w.title,
      dealId: null,
      dealName: null,
      startAt: w.start,
      endAt: w.end ?? null,
      lat: w.lat,
      lng: w.lng,
      address: w.address ?? null,
      appointmentId: w.navigatrAppointmentId ?? null,
      past: isPast(w.start, w.end ?? null, nowMs),
    });
  }

  stops.sort((a, b) => {
    const diff = ms(a.startAt) - ms(b.startAt);
    if (!Number.isNaN(diff) && diff !== 0) return diff;
    return a.startAt.localeCompare(b.startAt);
  });
  return stops;
}
