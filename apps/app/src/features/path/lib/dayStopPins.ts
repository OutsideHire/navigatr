/**
 * dayStopPins — the pure OrderedStop[] -> map-pin-model builder for DayStopsMap
 * (Robert Path v2.2, Section 2.1 map view + 3.1 color rule).
 *
 * One pin per routable stop, NUMBERED in route order (1..N), colored by AGING
 * ONLY (Section 3.1): color never encodes commitment type. Whether a stop is an
 * appointment is carried on `isAppointment` so the renderer can mark it by SHAPE
 * / an outer RING, never by color.
 *
 * Stops with no coordinates are not routable on a map, so they are excluded and
 * do not consume a route number (the remaining pins stay a contiguous 1..N).
 */

import type { OrderedStop } from "./todaysPath";

/** The three aging states from the band (Section 3.1, warm range):
 *  - neutral: before target (on time / not yet due)
 *  - warm:    past target
 *  - hot:     past the latest acceptable point */
export type AgingState = "neutral" | "warm" | "hot";

export interface StopPin {
  id: string;
  /** 1-based position in the day's route order. */
  index: number;
  lat: number;
  lng: number;
  kind: OrderedStop["kind"];
  agingState: AgingState;
  /** Marked by shape/ring in the renderer, NEVER by color (Section 3.1). */
  isAppointment: boolean;
}

/**
 * Aging state for a stop.
 *
 * v2.2 A5 approximation: derive from the data OrderedStop carries TODAY —
 * `past_due` maps to "warm", everything else (appointments, due_today, nearby)
 * to "neutral". We deliberately do NOT emit "hot" yet and do NOT hardcode a
 * day-count threshold: Ticket B 4.6 rewires this to the true three-state band
 * via `bandPosition` (neutral before target / warm past target / hot past
 * latest). Until then a single past_due -> warm rule is the honest signal.
 */
function agingStateForStop(stop: OrderedStop): AgingState {
  return stop.tier === "past_due" ? "warm" : "neutral";
}

const hasCoords = (s: OrderedStop): s is OrderedStop & { lat: number; lng: number } =>
  s.lat != null && s.lng != null && Number.isFinite(s.lat) && Number.isFinite(s.lng);

/**
 * Build the numbered, aging-colored pin models from the ordered run list.
 * Input order IS the route order; pins are numbered 1..N over the coordinate-
 * bearing stops (null-coord stops are dropped and skip a number).
 */
export function buildDayStopPins(stops: OrderedStop[]): StopPin[] {
  const pins: StopPin[] = [];
  let index = 0;
  for (const stop of stops) {
    if (!hasCoords(stop)) continue;
    index += 1;
    pins.push({
      id: stop.id,
      index,
      lat: stop.lat,
      lng: stop.lng,
      kind: stop.kind,
      agingState: agingStateForStop(stop),
      isAppointment: stop.tier === "appointment",
    });
  }
  return pins;
}
