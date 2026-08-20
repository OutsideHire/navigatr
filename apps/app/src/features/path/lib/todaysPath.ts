/**
 * Auto-built Today's Path (SP-A), the pure assembler.
 *
 * Composes a rep's prioritized day into a reviewable, fit-aware proposal:
 * fixed calendar anchors (appointments) plus a tiered, budget-capped selection
 * of the rep's real commitments (owed drop-ins, then due-today), ordered into a
 * single run list. Per v2.2 B 4.2 fill is MANUAL: the nearby discovery pool is
 * NOT auto-selected onto the day, it is held entirely in `overflow` for manual
 * fill (B-T4). SP-B renders this; SP-A never touches React, the network, or the
 * clock, `now` is a parameter and there is no randomness.
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
import type { BandPosition } from "./classD";
import { driveMinutesBetween } from "./driveTime";
import { interleaveAroundAnchors } from "./interleaveAroundAnchors";
import { dwellMinutesForKind } from "./pathCapacityDefaults";

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
  /** True when the follow-up date was asserted by the rep/merchant
   *  (date_source "asserted"). Drives the "you promised" label (v2.2 B 4.5).
   *  Defaults to false when absent. */
  datePromised?: boolean;
  /** The follow-up's band position (v2.2 B 4.6), from OwedVisit.bandPosition.
   *  Drives the aging COLOR (neutral/warm/hot via `agingStateFromBand`), never a
   *  day count. The assembler populates it; appointments/nearby leave it
   *  undefined. */
  bandPosition?: BandPosition;
}

/** A drop-in / follow-up due today. */
export interface DueTodayCandidate {
  id: string;
  dealId: string | null;
  name: string;
  lat: number | null;
  lng: number | null;
  /** True when the follow-up date was asserted (date_source "asserted"). */
  datePromised?: boolean;
  /** Band position for the aging color (v2.2 B 4.6). See OwedCandidate. */
  bandPosition?: BandPosition;
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
  /** Optional minute-precise close, minutes from local midnight (v2.2 B 4.3).
   *  When set it is AUTHORITATIVE for the working-window end (the per-rep
   *  end-of-day from `path_preferences.end_of_day_minutes`); `endHour` is then
   *  only the coarse fallback used when this is absent. `windowEndHour` in the
   *  result floors this to the hour for the full-day sentence. */
  endMinutes?: number;
}

export interface AssembleTodaysPathInput {
  appointments: PathAppointment[];
  owed: OwedCandidate[];
  dueToday: DueTodayCandidate[];
  nearbyPool: NearbyCandidate[];
  origin: LatLng;
  /** Working hours. Defaults to 9..17. */
  dayWindow?: DayWindow;
  /** Fixed dwell override for EVERY stop. When omitted, dwell is derived per
   *  kind: 30 min for an appointment, 15 min for a flexible stop
   *  (`dwellMinutesForKind`). Pass a number only to force one flat value. */
  dwellMin?: number;
  /** The rep's timezone offset in minutes BEHIND UTC, i.e. the device's
   *  `Date.getTimezoneOffset()` (300 for US Central UTC-5, -60 for CET UTC+1,
   *  0 for UTC). The working window's start/end are the rep's wall-clock
   *  business hours, so they are anchored to this offset: "Starts at", capacity,
   *  and end-of-day track the rep's local clock instead of UTC. Defaults to 0
   *  (UTC), which is the assembler's prior behavior. */
  tzOffsetMinutes?: number;
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
  /** Asserted follow-up date (date_source "asserted") -> "you promised" label
   *  (v2.2 B 4.5). Carried from the owed / due-today candidate; false for nearby. */
  datePromised?: boolean;
  /** Band position for the aging color (v2.2 B 4.6). Carried from the owed /
   *  due-today candidate; undefined for nearby. */
  bandPosition?: BandPosition;
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
  /** Asserted follow-up date (date_source "asserted") -> "you promised" label
   *  (v2.2 B 4.5). Threaded from the flexible stop; false for appointments. */
  datePromised?: boolean;
  /** Band position for the aging color (v2.2 B 4.6). Threaded from the flexible
   *  stop; undefined for appointments and nearby fills. */
  bandPosition?: BandPosition;
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
  /** Effective day start = max(now, window open), as ISO. Drives the landing
   *  subhead's "Starts at" clause (v2.2 A6). Always the current instant once the
   *  window is open; the window-open time earlier in the morning. */
  startsAtIso: string;
  /** True when `now` is BEFORE the working window opens, so `startsAtIso` is the
   *  future window-open time rather than the current instant. Lets the subhead
   *  say "Your day starts at 8:00 AM" (a scheduled opening) instead of a bare
   *  "Starts at 8:00" that reads as the current time and looks frozen off-hours. */
  dayNotYetOpen: boolean;
}

// --- helpers -----------------------------------------------------------------

const DEFAULT_WINDOW: DayWindow = { startHour: 8, endHour: 17 };

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
    out.push({ id: o.id, dealId: o.dealId, name: o.name, lat: o.lat, lng: o.lng, tier: "past_due", ageDays: o.ageDays, datePromised: o.datePromised ?? false, bandPosition: o.bandPosition });
  }
  for (const d of input.dueToday) {
    if (!hasCoords(d)) continue;
    out.push({ id: d.id, dealId: d.dealId, name: d.name, lat: d.lat, lng: d.lng, tier: "due_today", ageDays: null, datePromised: d.datePromised ?? false, bandPosition: d.bandPosition });
  }
  for (const n of input.nearbyPool) {
    if (!hasCoords(n)) continue;
    out.push({ id: n.id, dealId: n.dealId ?? null, name: n.name, lat: n.lat, lng: n.lng, tier: "nearby", ageDays: null, datePromised: false });
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
  datePromised: s.datePromised ?? false,
  bandPosition: s.bandPosition,
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
  datePromised: false,
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
  // Per-kind dwell (v2.2 B default 3), with an optional flat override. When
  // `dwellMin` is given every stop uses it; otherwise appointments hold 30 and
  // flexible stops hold 15 via `dwellMinutesForKind`.
  const dwellOverride = input.dwellMin;
  const dwellFor = (kindOrTier: string): number =>
    dwellOverride ?? dwellMinutesForKind(kindOrTier);
  const origin = input.origin;

  const nowMs = toMs(now);

  // Working window on `now`'s LOCAL calendar date. startHour / endMinutes are the
  // rep's wall-clock business hours, so they anchor to the rep's timezone offset,
  // NOT UTC. `tzOffsetMinutes` is the device offset (minutes BEHIND UTC). Keeping
  // this a parameter (rather than reading the machine clock) keeps the assembler
  // pure and deterministic: tests pass an explicit offset and the result never
  // depends on the runner's timezone. Offset 0 == UTC == the prior behavior. The
  // remaining budget runs from max(now, open).
  const offsetMs = (input.tzOffsetMinutes ?? 0) * 60000;
  // Shift by the offset then read UTC parts to recover the rep-LOCAL Y/M/D of
  // `now` independent of the JS runtime's own timezone.
  const localNow = new Date(nowMs - offsetMs);
  const ly = localNow.getUTCFullYear();
  const lmo = localNow.getUTCMonth();
  const lda = localNow.getUTCDate();
  // Build each wall-clock boundary on that local date, then add the offset back
  // to convert the local wall clock to a true UTC instant.
  const windowStartMs = Date.UTC(ly, lmo, lda, window.startHour, 0, 0, 0) + offsetMs;
  // Per-rep end-of-day (endMinutes, minutes from midnight) is authoritative when
  // present; otherwise fall back to the coarse endHour. Date.UTC normalizes the
  // minutes overflow (e.g. 990 -> 16:30, 1020 -> 17:00).
  const endMinutesFromMidnight = window.endMinutes ?? window.endHour * 60;
  const windowEndMs = Date.UTC(ly, lmo, lda, 0, endMinutesFromMidnight, 0, 0) + offsetMs;
  const effectiveStartMs = Math.max(nowMs, windowStartMs);
  const totalWindowMin = Math.max(0, (windowEndMs - effectiveStartMs) / 60000);
  // Before the window opens, effectiveStart is the future open time, not now.
  const dayNotYetOpen = effectiveStartMs > nowMs;

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
    // No end -> assume an appointment-dwell hold so it still consumes budget.
    const e = a.endAt ? parseMs(a.endAt) : s + dwellFor("appointment") * 60000;
    apptOccupiedMin += overlapMinutes(s, e, effectiveStartMs, windowEndMs);
  }

  // 2. Flexible candidates in strict tier order (owed -> dueToday -> nearby),
  //    geocoded only. v2.2 B 4.2 splits this into the rep's real commitments,
  //    which auto-assemble on load, and the nearby discovery pool, which is held
  //    entirely for MANUAL fill and never lands on the day automatically.
  const flexible = prioritizedFlexible(input);
  //    - auto-eligible = owed (past_due) + due_today: these go through the greedy
  //      budget selection and appear on the day today.
  //    - pool-only = nearby: NEVER auto-selected. Every nearby candidate routes
  //      to overflow (the retained fill pool) regardless of remaining budget, so
  //      it is available for manual fill (B-T4) but is absent from the load-time
  //      proposal. Both partitions preserve the ranked order from
  //      prioritizedFlexible, so the pool order stays owed-overflow ->
  //      due-overflow -> nearby, which is exactly what B-T4 consumes.
  const autoEligible = flexible.filter((s) => s.tier !== "nearby");
  const poolOnly = flexible.filter((s) => s.tier === "nearby");

  // 3. Greedy budget selection over the auto-eligible tiers only. Per-stop cost
  //    is an independent estimate: drive(origin->stop) + dwell. Break on the
  //    first stop that does not fit so the un-selected tail stays a contiguous
  //    priority-ordered run (preserving strict tiering: a nearer, lower-tier stop
  //    can never jump a higher-tier one that did not fit). The nearby pool is
  //    appended to overflow AFTER any owed/due-today overflow, preserving the
  //    ranked pool order for manual fill.
  let remainingMin = Math.max(0, totalWindowMin - apptOccupiedMin);
  const selected: FlexibleStop[] = [];
  const overflow: FlexibleStop[] = [];
  let exhausted = false;
  for (const stop of autoEligible) {
    if (exhausted) {
      overflow.push(stop);
      continue;
    }
    const cost = driveMinutesBetween(origin, { lat: stop.lat, lng: stop.lng }) + dwellFor(stop.tier);
    if (cost <= remainingMin) {
      selected.push(stop);
      remainingMin -= cost;
    } else {
      exhausted = true;
      overflow.push(stop);
    }
  }
  // Nearby: held entirely in the pool, after the owed/due overflow tail.
  overflow.push(...poolOnly);

  // 4. Route the selected flexible stops (nearest-neighbor from origin) and
  //    interleave them with the fixed anchors. Non-dropping: every selected stop
  //    appears. A stop is placed in the current gap if it (plus the drive on to
  //    the next appointment) fits before that appointment starts; otherwise it
  //    is deferred to a later gap. The tail after the last appointment is
  //    unbounded, so nothing is lost.
  const order = nearestNeighborOrder(origin, selected.map((s) => ({ lat: s.lat, lng: s.lng })));
  const queue = order.map((i) => selected[i]!);

  // The interleave queue is entirely flexible stops, so it holds the flexible
  // dwell (anchors carry their own start/end occupancy inside the helper).
  const interleaved = interleaveAroundAnchors(anchors, queue, {
    origin,
    dwellMin: dwellFor("flexible"),
    effectiveStartMs,
  });
  const proposal: OrderedStop[] = interleaved.map((e) =>
    e.kind === "anchor" ? appointmentToOrdered(e.item) : flexibleToOrdered(e.item),
  );

  return {
    proposal,
    overflow,
    remainingMin,
    // Hour label for the full-day sentence. Track the per-rep EOD when set
    // (floored to the hour), else the coarse endHour.
    windowEndHour: window.endMinutes != null ? Math.floor(window.endMinutes / 60) : window.endHour,
    startsAtIso: new Date(effectiveStartMs).toISOString(),
    dayNotYetOpen,
  };
}
