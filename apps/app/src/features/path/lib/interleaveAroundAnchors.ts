import type { LatLng } from "@/lib/distance";
import { driveMinutesBetween } from "./driveTime";

export interface AnchorLike {
  startAt: string;
  endAt: string | null;
  lat: number | null;
  lng: number | null;
}
export interface FlexibleLike {
  lat: number;
  lng: number;
}
export type Interleaved<A, F> = { kind: "anchor"; item: A } | { kind: "flexible"; item: F };

export interface InterleaveOptions {
  origin: LatLng;
  dwellMin: number;
  /** ms clock the day starts at (max(now, window open)). */
  effectiveStartMs: number;
}

/**
 * Interleave a routed flexible queue around fixed appointment anchors by time.
 * Anchors MUST be pre-sorted ascending by startAt; queue is in routed order.
 * A flexible stop is emitted before an anchor only if it (plus the drive on to
 * that anchor) fits before the anchor's start. Leftovers follow the last anchor.
 * Pure: no Date.now, drive estimate via driveMinutesBetween.
 */
export function interleaveAroundAnchors<A extends AnchorLike, F extends FlexibleLike>(
  anchors: A[],
  queue: F[],
  opts: InterleaveOptions,
): Interleaved<A, F>[] {
  const { origin, dwellMin, effectiveStartMs } = opts;
  const out: Interleaved<A, F>[] = [];
  let cursorMs = effectiveStartMs;
  let cursorLoc: LatLng = origin;
  let qi = 0;

  for (const anchor of anchors) {
    const apptStartMs = Date.parse(anchor.startAt);
    const apptLoc: LatLng | null =
      anchor.lat != null &&
      anchor.lng != null &&
      Number.isFinite(anchor.lat) &&
      Number.isFinite(anchor.lng)
        ? { lat: anchor.lat, lng: anchor.lng }
        : null;
    while (qi < queue.length) {
      const stop = queue[qi]!;
      const arriveMs = cursorMs + driveMinutesBetween(cursorLoc, { lat: stop.lat, lng: stop.lng }) * 60000;
      const departMs = arriveMs + dwellMin * 60000;
      const driveOnMin = apptLoc ? driveMinutesBetween({ lat: stop.lat, lng: stop.lng }, apptLoc) : 0;
      const fitsBeforeAppt = Number.isNaN(apptStartMs)
        ? true
        : departMs + driveOnMin * 60000 <= apptStartMs;
      if (!fitsBeforeAppt) break;
      out.push({ kind: "flexible", item: stop });
      cursorMs = departMs;
      cursorLoc = { lat: stop.lat, lng: stop.lng };
      qi++;
    }
    out.push({ kind: "anchor", item: anchor });
    const apptEndMs = anchor.endAt ? Date.parse(anchor.endAt) : apptStartMs;
    if (Number.isFinite(apptEndMs)) cursorMs = Math.max(cursorMs, apptEndMs);
    if (apptLoc) cursorLoc = apptLoc;
  }
  // Remaining flexible stops go after the last anchor, in queue order.
  while (qi < queue.length) {
    out.push({ kind: "flexible", item: queue[qi]! });
    qi++;
  }

  return out;
}
