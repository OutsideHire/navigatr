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
import type { OrderedStop, FlexibleStop } from "./todaysPath";

export interface InsertStopOptions {
  origin: LatLng;
  /** Minutes spent at each flexible stop. Default 20. */
  dwellMin?: number;
  /** Working-window end hour (0..24). The tail after the last stop must still
   *  finish by this hour on `now`'s UTC date. */
  windowEndHour: number;
  /** ISO/epoch clock start (callers pass an explicit now; pure, no Date.now()). */
  now: string | number;
}

const DEFAULT_DWELL_MIN = 20;

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
 * and holding `dwellMin` at each. Returns whether the trial is feasible:
 *   1. every appointment (kind !== "flexible", has startAt) is reached at or
 *      before its startAt, and
 *   2. the final departure is at or before the window end.
 */
function isFeasible(
  trial: OrderedStop[],
  origin: LatLng,
  dwellMin: number,
  windowEndMs: number,
  nowMs: number,
): boolean {
  let cursorMs = nowMs;
  let cursorLoc: LatLng = origin;
  for (const stop of trial) {
    const driveMin = hasCoords(stop)
      ? driveMinutesBetween(cursorLoc, { lat: stop.lat, lng: stop.lng })
      : 0;
    const arriveMs = cursorMs + driveMin * 60000;
    if (stop.kind !== "flexible") {
      const startMs = parseMs(stop.startAt);
      if (Number.isFinite(startMs) && arriveMs > startMs) return false;
    }
    cursorMs = arriveMs + dwellMin * 60000;
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

  const dwellMin = opts.dwellMin ?? DEFAULT_DWELL_MIN;
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
    if (isFeasible(trial, opts.origin, dwellMin, windowEndMs, nowMs)) {
      return trial;
    }
  }
  return null;
}
