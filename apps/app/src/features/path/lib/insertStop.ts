/**
 * insertStop (FR-PATH-UX-11): insert ONE flexible stop into an existing ordered
 * run WITHOUT re-sequencing the stops already placed.
 *
 * This is a fit CHECK, not a re-optimization. Every stop already in `ordered`
 * keeps its relative order in every trial; the candidate is simply spliced in at
 * the FIRST index where the whole day still holds. "Holds" means: no fixed
 * appointment becomes late, and the final departure stays within the working
 * window. Drive time uses the same straight-line estimate the assembler uses
 * (`driveMinutesBetween`), so this stays consistent with the day it is editing.
 *
 * Pure: `now` is a parameter, there is no Date.now() and no randomness.
 */

import type { LatLng } from "@/lib/distance";
import { driveMinutesBetween } from "./driveTime";
import { dwellMinutesForKind } from "./pathCapacityDefaults";
import type { OrderedStop, FlexibleStop } from "./todaysPath";

export interface InsertStopOptions {
  origin: LatLng;
  /** Fixed dwell override for EVERY stop. When omitted, dwell is derived per
   *  kind: 30 min for an appointment, 15 min for a flexible stop
   *  (`dwellMinutesForKind`). Pass a number only to force one flat value. */
  dwellMin?: number;
  /** Working-window end hour (0..24). The tail after the last stop must still
   *  finish by this hour on `now`'s UTC date. */
  windowEndHour: number;
  /** ISO/epoch clock start (callers pass an explicit now; pure, no Date.now()). */
  now: string | number;
}

const toMs = (now: string | number): number =>
  typeof now === "number" ? now : Date.parse(now);

const parseMs = (iso: string | null): number => (iso ? Date.parse(iso) : NaN);

const hasCoords = (s: {
  lat: number | null;
  lng: number | null;
}): s is { lat: number; lng: number } =>
  s.lat != null &&
  s.lng != null &&
  Number.isFinite(s.lat) &&
  Number.isFinite(s.lng);

/** Normalize a flexible candidate into an OrderedStop, matching the assembler. */
const candidateToOrdered = (s: FlexibleStop): OrderedStop => ({
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

/**
 * Walk a trial list from `origin` at `now`, driving between consecutive stops
 * and holding a per-kind dwell at each. Returns whether the trial is feasible:
 *   1. every appointment (kind !== "flexible", has startAt) is reached at or
 *      before its startAt, and
 *   2. the final departure is at or before the window end.
 *
 * Dwell is per-kind (v2.2 B default 3): a flexible stop holds 15 min, an
 * appointment 30. `dwellOverride`, when set, forces that flat value for every
 * stop instead.
 */
function isFeasible(
  trial: OrderedStop[],
  origin: LatLng,
  dwellOverride: number | undefined,
  windowEndMs: number,
  nowMs: number,
): boolean {
  const dwellFor = (kind: string): number =>
    dwellOverride ?? dwellMinutesForKind(kind);
  let cursorMs = nowMs;
  let cursorLoc: LatLng = origin;
  for (const stop of trial) {
    const driveMin = hasCoords(stop)
      ? driveMinutesBetween(cursorLoc, { lat: stop.lat, lng: stop.lng })
      : 0;
    const arriveMs = cursorMs + driveMin * 60000;
    if (stop.kind === "flexible") {
      // A flexible stop occupies its dwell (15 min by default).
      cursorMs = arriveMs + dwellFor(stop.kind) * 60000;
    } else {
      // A fixed appointment must be reached at or before it starts, and it holds
      // the rep until its endAt (mirroring the assembler): arriving early means
      // waiting for the window, then departing at endAt. With no endAt it holds
      // the appointment dwell (30 min). Under-modeling this is what let a
      // candidate wedge between two close appointments and make the later one late.
      const startMs = parseMs(stop.startAt);
      if (Number.isFinite(startMs) && arriveMs > startMs) return false;
      const fallbackEndMs = Number.isFinite(startMs)
        ? startMs + dwellFor(stop.kind) * 60000
        : NaN;
      const apptEndMs = stop.endAt ? parseMs(stop.endAt) : fallbackEndMs;
      cursorMs = Math.max(arriveMs, Number.isFinite(apptEndMs) ? apptEndMs : startMs);
    }
    if (hasCoords(stop)) cursorLoc = { lat: stop.lat, lng: stop.lng };
  }
  return cursorMs <= windowEndMs;
}

/**
 * Insert `candidate` into `ordered` at the FIRST feasible position without
 * moving or re-timing any placed stop. Returns a NEW ordered list with the
 * candidate inserted, or null when no position fits (or the candidate lacks
 * coords).
 */
export function insertStop(
  ordered: OrderedStop[],
  candidate: FlexibleStop,
  opts: InsertStopOptions,
): OrderedStop[] | null {
  if (!hasCoords(candidate)) return null;

  const dwellOverride = opts.dwellMin;
  const nowMs = toMs(opts.now);
  if (!Number.isFinite(nowMs)) return null;

  const d = new Date(nowMs);
  const windowEndMs = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    opts.windowEndHour,
    0,
    0,
    0,
  );

  const candidateStop = candidateToOrdered(candidate);

  for (let i = 0; i <= ordered.length; i++) {
    const trial = [...ordered.slice(0, i), candidateStop, ...ordered.slice(i)];
    if (isFeasible(trial, opts.origin, dwellOverride, windowEndMs, nowMs)) {
      return trial;
    }
  }
  return null;
}
