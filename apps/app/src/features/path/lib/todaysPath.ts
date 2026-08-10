/**
 * Auto-built Today's Path (SP-A), the pure assembler.
 *
 * Composes a rep's prioritized day into a reviewable, fit-aware proposal:
 * fixed calendar anchors (appointments) plus a tiered, budget-capped selection
 * of flexible stops (owed drop-ins, then due-today, then nearby discovery),
 * ordered into a single run list. SP-B renders this; SP-A never touches React,
 * the network, or the clock, `now` is a parameter and there is no randomness.
 *
 * Fit math is deliberately simple (v1):
 *  - Drive time is the shared straight-line heuristic (`driveMinutesBetween`,
 *    haversine at AVG_SPEED_MPH). Every duration here is a rough ESTIMATE.
 *  - Capacity gating uses an INDEPENDENT per-stop estimate: drive(origin->stop)
 *    + dwell. That is cheap and order-free (it does not depend on the eventual
 *    route), which is exactly what a "will the day hold N stops?" gate needs.
 *    The interleave step below computes routed drive separately.
 *  - This is deterministic tiered selection + a sane order, not a VRP.
 *
 * Why not reuse `scheduleDay` for the routing step: scheduleDay runs its OWN
 * score-based selection and gap-packing and can drop stops it cannot fit,
 * which would fight this slice's contract (strict tier selection against an
 * explicit budget, with the un-selected tail carried as `overflow`). Reusing it
 * would re-open the selection we just made and risk dropping already-selected
 * stops. So we keep selection here and reuse only the lower-level shared
 * primitives it also builds on: `nearestNeighborOrder` and `driveMinutesBetween`.
 */

import { nearestNeighborOrder, type LatLng } from "@/lib/distance";
import { driveMinutesBetween } from "./driveTime";
import { interleaveAroundAnchors } from "./interleaveAroundAnchors";

// --- inputs ------------------------------------------------------------------

export type AppointmentKind = "appointment" | "external";
/** `no_location` is a DISPLAY-ONLY tier: an owed drop-in whose deal has no
 *  coordinates yet, so it can be shown and acted on but never enters the route.
 *  The routing engine (assembleTodaysPath / drivingSequence) never emits it. */
export type FlexibleTier = "past_due" | "due_today" | "nearby" | "no_location";

/** A fixed, time-anchored calendar commitment (SP-B feeds these from MeetingStop). */
export interface PathAppointment {
  id: string;
  kind: AppointmentKind;
  title: string;
  dealId: string | null;
  startAt: string; // ISO
  endAt: string | null; // ISO; null when the calendar gave no end
  lat: number | null;
  lng: number | null;
}

/** A past-due owed drop-in. Input order does not matter: the assembler re-sorts
 *  owed oldest-overdue-first (by ageDays) internally. */
export interface OwedCandidate {
  id: string;
  dealId: string | null;
  name: string;
  lat: number | null;
  lng: number | null;
  ageDays: number;
}

/** A drop-in / follow-up due today. */
export interface DueTodayCandidate {
  id: string;
  dealId: string | null;
  name: string;
  lat: number | null;
  lng: number | null;
}

/** A discovered candidate used to fill the day. Extra fields are ignored. */
export interface NearbyCandidate {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  dealId?: string | null;
  [key: string]: unknown;
}

export interface DayWindow {
  startHour: number; // 0..24 local-UTC hour the working day opens
  endHour: number; // 0..24 local-UTC hour it closes
}

export interface AssembleTodaysPathInput {
  appointments: PathAppointment[];
  owed: OwedCandidate[];
  dueToday: DueTodayCandidate[];
  nearbyPool: NearbyCandidate[];
  origin: LatLng;
  /** Working hours. Defaults to 9..17. */
  dayWindow?: DayWindow;
  /** Minutes spent at each flexible stop. Defaults to 20. */
  dwellMin?: number;
}

// --- outputs -----------------------------------------------------------------

/** A flexible candidate normalized into a routable stop, tagged with its tier. */
export interface FlexibleStop {
  id: string;
  dealId: string | null;
  name: string;
  lat: number;
  lng: number;
  tier: FlexibleTier;
  /** Present only for past_due stops (from OwedCandidate.ageDays). */
  ageDays: number | null;
}

export type StopKind = AppointmentKind | "flexible";
export type StopTier = FlexibleTier | "appointment";

/** One entry in the ordered run list. Uniform shape over appointments +
 *  flexible stops so SP-B renders from a single list. */
export interface OrderedStop {
  id: string;
  kind: StopKind;
  tier: StopTier;
  /** Appointment title or flexible-stop name. */
  name: string;
  dealId: string | null;
  lat: number | null;
  lng: number | null;
  /** Appointment start/end; null for flexible stops (no fixed time). */
  startAt: string | null;
  endAt: string | null;
  /** past_due staleness age; null otherwise. */
  ageDays: number | null;
}

export interface TodaysPathResult {
  proposal: OrderedStop[];
  /** Flexible candidates that did not fit, in strict priority order, for carry-over. */
  overflow: FlexibleStop[];
  /** Budget minutes still open after the greedy selection. Raw (unrounded); the
   *  UI capacity sentence rounds it for display (FR-PATH-UX-10). */
  remainingMin: number;
  /** The working-window close hour (0..24) so the UI can say "before 6:00". */
  windowEndHour: number;
}

// --- helpers -----------------------------------------------------------------

const DEFAULT_WINDOW: DayWindow = { startHour: 9, endHour: 17 };
const DEFAULT_DWELL_MIN = 20;

const toMs = (now: string | number): number =>
  typeof now === "number" ? now : Date.parse(now);

const parseMs = (iso: string | null): number => (iso ? Date.parse(iso) : NaN);

/** Overlap (minutes) of [aStart,aEnd] with [wStart,wEnd]; 0 if disjoint/invalid. */
function overlapMinutes(aStart: number, aEnd: number, wStart: number, wEnd: number): number {
  if (!Number.isFinite(aStart) || !Number.isFinite(aEnd)) return 0;
  const lo = Math.max(aStart, wStart);
  const hi = Math.min(aEnd, wEnd);
  return hi > lo ? (hi - lo) / 60000 : 0;
}

const hasCoords = (s: { lat: number | null; lng: number | null }): s is { lat: number; lng: number } =>
  s.lat != null && s.lng != null && Number.isFinite(s.lat) && Number.isFinite(s.lng);

/** Build the prioritized, geocoded flexible list: owed -> dueToday -> nearby,
 *  each tagged. Owed is sorted oldest-overdue-first HERE (ageDays descending,
 *  stable on original input index) so the "past-due oldest first" guarantee is
 *  self-contained and does not depend on the caller pre-sorting. dueToday and
 *  nearby keep their given order. */
function prioritizedFlexible(input: AssembleTodaysPathInput): FlexibleStop[] {
  const out: FlexibleStop[] = [];
  const owedOldestFirst = input.owed
    .map((o, i) => ({ o, i }))
    .sort((x, y) => {
      const byAge = y.o.ageDays - x.o.ageDays; // descending: oldest overdue first
      return byAge !== 0 ? byAge : x.i - y.i; // stable tiebreak on input index
    })
    .map((x) => x.o);
  for (const o of owedOldestFirst) {
    if (!hasCoords(o)) continue;
    out.push({ id: o.id, dealId: o.dealId, name: o.name, lat: o.lat, lng: o.lng, tier: "past_due", ageDays: o.ageDays });
  }
  for (const d of input.dueToday) {
    if (!hasCoords(d)) continue;
    out.push({ id: d.id, dealId: d.dealId, name: d.name, lat: d.lat, lng: d.lng, tier: "due_today", ageDays: null });
  }
  for (const n of input.nearbyPool) {
    if (!hasCoords(n)) continue;
    out.push({ id: n.id, dealId: n.dealId ?? null, name: n.name, lat: n.lat, lng: n.lng, tier: "nearby", ageDays: null });
  }
  return out;
}

const flexibleToOrdered = (s: FlexibleStop): OrderedStop => ({
  id: s.id,
  kind: "flexible",
  tier: s.tier,
  name: s.name,
  dealId: s.dealId,
  lat: s.lat,
  lng: s.lng,
  startAt: null,
  endAt: null,
  ageDays: s.ageDays,
});

const appointmentToOrdered = (a: PathAppointment): OrderedStop => ({
  id: a.id,
  kind: a.kind,
  tier: "appointment",
  name: a.title,
  dealId: a.dealId,
  lat: a.lat,
  lng: a.lng,
  startAt: a.startAt,
  endAt: a.endAt,
  ageDays: null,
});

// --- main --------------------------------------------------------------------

/**
 * Assemble the rep's day into a reviewable proposal + overflow.
 *
 * @param now ISO string or epoch ms. Drives the remaining-day budget (the day
 *            starts at max(now, window open)). Never read from the clock here.
 */
export function assembleTodaysPath(
  input: AssembleTodaysPathInput,
  now: string | number,
): TodaysPathResult {
  const window = input.dayWindow ?? DEFAULT_WINDOW;
  const dwellMin = input.dwellMin ?? DEFAULT_DWELL_MIN;
  const origin = input.origin;

  const nowMs = toMs(now);

  // Working window on `now`'s calendar date, in UTC (deterministic; callers pass
  // an explicit-offset `now`). The remaining budget runs from max(now, open).
  const d = new Date(nowMs);
  const windowStartMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), window.startHour, 0, 0, 0);
  const windowEndMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), window.endHour, 0, 0, 0);
  const effectiveStartMs = Math.max(nowMs, windowStartMs);
  const totalWindowMin = Math.max(0, (windowEndMs - effectiveStartMs) / 60000);

  // 1. Fixed anchors: appointments always belong, ordered ascending by startAt
  //    (stable, with the original index as tiebreak for equal times).
  const anchors = input.appointments
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const dt = parseMs(x.a.startAt) - parseMs(y.a.startAt);
      return dt !== 0 && !Number.isNaN(dt) ? dt : x.i - y.i;
    })
    .map((x) => x.a);

  // Appointment time already committed within the remaining window.
  let apptOccupiedMin = 0;
  for (const a of anchors) {
    const s = parseMs(a.startAt);
    // No end -> assume a dwell-length hold so it still consumes some budget.
    const e = a.endAt ? parseMs(a.endAt) : s + dwellMin * 60000;
    apptOccupiedMin += overlapMinutes(s, e, effectiveStartMs, windowEndMs);
  }

  // 2. Flexible candidates in strict tier order (owed -> dueToday -> nearby),
  //    geocoded only.
  const flexible = prioritizedFlexible(input);

  // 3. Greedy budget selection in tier order. Per-stop cost is an independent
  //    estimate: drive(origin->stop) + dwell. Break on the first stop that does
  //    not fit so the un-selected tail stays a contiguous priority-ordered run
  //    (preserving strict tiering: a nearer, lower-tier stop can never jump a
  //    higher-tier one that did not fit).
  let remainingMin = Math.max(0, totalWindowMin - apptOccupiedMin);
  const selected: FlexibleStop[] = [];
  const overflow: FlexibleStop[] = [];
  let exhausted = false;
  for (const stop of flexible) {
    if (exhausted) {
      overflow.push(stop);
      continue;
    }
    const cost = driveMinutesBetween(origin, { lat: stop.lat, lng: stop.lng }) + dwellMin;
    if (cost <= remainingMin) {
      selected.push(stop);
      remainingMin -= cost;
    } else {
      exhausted = true;
      overflow.push(stop);
    }
  }

  // 4. Route the selected flexible stops (nearest-neighbor from origin) and
  //    interleave them with the fixed anchors. Non-dropping: every selected stop
  //    appears. A stop is placed in the current gap if it (plus the drive on to
  //    the next appointment) fits before that appointment starts; otherwise it
  //    is deferred to a later gap. The tail after the last appointment is
  //    unbounded, so nothing is lost.
  const order = nearestNeighborOrder(origin, selected.map((s) => ({ lat: s.lat, lng: s.lng })));
  const queue = order.map((i) => selected[i]!);

  const interleaved = interleaveAroundAnchors(anchors, queue, { origin, dwellMin, effectiveStartMs });
  const proposal: OrderedStop[] = interleaved.map((e) =>
    e.kind === "anchor" ? appointmentToOrdered(e.item) : flexibleToOrdered(e.item),
  );

  return { proposal, overflow, remainingMin, windowEndHour: window.endHour };
}
