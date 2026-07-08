import { driveMinutesBetween } from "./driveTime";

export interface RunLatLng { lat: number; lng: number }
export interface RunStop { id: string; name: string; lat: number; lng: number }
export interface RunWaypoint { id: string; title: string; start: string; end: string; lat: number; lng: number }
export interface RunTimeBlock { id: string; title: string; start: string; end: string }

export interface RunScheduleInput {
  now: string;
  startLoc: RunLatLng;
  stops: RunStop[];
  waypoints: RunWaypoint[];
  timeBlocks: RunTimeBlock[];
  dwellMin?: number;
  bufferMin?: number;
}

export interface AnnotatedStop {
  id: string;
  arrive: string;
  depart: string;
  nextMeetingId: string | null;
  fitsBeforeNextMeeting: boolean;
}

export interface RunMeeting { id: string; title: string; start: string; end: string; located: boolean }
export interface RunScheduleResult { stops: AnnotatedStop[]; meetings: RunMeeting[] }

// Mirrors scheduleDay's defaults (kept local; not exported there).
const DEFAULT_DWELL_MIN = 20;
const DEFAULT_BUFFER_MIN = 10;

const addMinutes = (iso: string, min: number): string =>
  new Date(Date.parse(iso) + min * 60000).toISOString();

interface InternalMeeting extends RunMeeting { loc: RunLatLng | null }

/**
 * Order-preserving ETA walk over the rep's pending stops. Unlike scheduleDay
 * (which reorders via nearest-that-fits), this keeps the given order and pins
 * meetings at their times, flagging stops that overrun the next meeting.
 */
export function annotateRunSchedule(input: RunScheduleInput): RunScheduleResult {
  const dwell = input.dwellMin ?? DEFAULT_DWELL_MIN;
  const buffer = input.bufferMin ?? DEFAULT_BUFFER_MIN;
  const nowMs = Date.parse(input.now);

  const meetings: InternalMeeting[] = [
    ...input.waypoints.map((w) => ({
      id: w.id, title: w.title, start: w.start, end: w.end, located: true,
      loc: { lat: w.lat, lng: w.lng } as RunLatLng | null,
    })),
    ...input.timeBlocks.map((b) => ({
      id: b.id, title: b.title, start: b.start, end: b.end, located: false,
      loc: null as RunLatLng | null,
    })),
  ]
    .filter((m) => Date.parse(m.end) > nowMs)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  const attended = new Set<string>();
  let cursor = input.now;
  let cursorLoc: RunLatLng = input.startLoc;
  const annotated: AnnotatedStop[] = [];

  for (const stop of input.stops) {
    for (const m of meetings) {
      if (attended.has(m.id)) continue;
      if (Date.parse(m.start) <= Date.parse(cursor)) {
        // Monotonic: only advance the clock (and move to the meeting's location)
        // when the meeting actually extends past the current cursor. A meeting
        // whose end is already behind the cursor — overlapping/nested events, or
        // one the rep is already late past — is marked attended without regressing
        // time or teleporting the rep's location.
        if (Date.parse(m.end) > Date.parse(cursor)) {
          cursor = m.end;
          if (m.loc) cursorLoc = m.loc;
        }
        attended.add(m.id);
      } else {
        break;
      }
    }

    const arrive = addMinutes(cursor, driveMinutesBetween(cursorLoc, { lat: stop.lat, lng: stop.lng }));
    const depart = addMinutes(arrive, dwell);

    const next = meetings.find((m) => !attended.has(m.id)) ?? null;

    let fits = true;
    if (next) {
      const returnDrive = next.loc
        ? driveMinutesBetween({ lat: stop.lat, lng: stop.lng }, next.loc)
        : 0;
      fits = Date.parse(addMinutes(depart, returnDrive + buffer)) <= Date.parse(next.start);
    }

    annotated.push({ id: stop.id, arrive, depart, nextMeetingId: next?.id ?? null, fitsBeforeNextMeeting: fits });

    cursor = depart;
    cursorLoc = { lat: stop.lat, lng: stop.lng };
  }

  return {
    stops: annotated,
    meetings: meetings.map(({ id, title, start, end, located }) => ({ id, title, start, end, located })),
  };
}
