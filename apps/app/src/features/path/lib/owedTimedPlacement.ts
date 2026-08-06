/**
 * Owed-visit timed placement (SP3 / Screen Content Spec §6, item 2). Turns the
 * drop-in follow-ups a rep owes into TIMED route stops with an approximate
 * arrival ("around 11:20 AM"), by feeding them into the existing day scheduler
 * as urgency-bearing prospects alongside the day's fixed calendar. Runtime only
 * (like calendar waypoints); nothing is persisted.
 *
 * Pure: the caller supplies the owed visits (from useOwedVisits) + the day's
 * fixed spans; this returns each visit's rounded arrival, plus the ids that
 * couldn't fit (the "Couldn't fit today" spill).
 */
import { scheduleDay, type FixedWaypoint, type SchedLatLng, type SchedTimeBlock } from "./scheduleDay";
import type { BandPosition } from "./classD";
import type { OwedVisit } from "./owedVisits";

/** A drop-in that dwells less than a cold prospect (15 vs 20 min). */
const OWED_DWELL_MIN = 15;

export interface OwedTimedStop {
  taskId: string;
  dealId: string;
  name: string;
  bandPosition: BandPosition;
  sourceOutcome: string | null;
  createdAt: string;
  /** Arrival rounded to 5 min — shown as an APPROXIMATE time ("around HH:MM"),
   *  never an exact promise. */
  aroundIso: string;
}

export interface OwedPlacementResult {
  placed: OwedTimedStop[];
  /** Owed visits the day couldn't fit — the "Couldn't fit today" spill. */
  spilledTaskIds: string[];
}

/** Round an instant to the nearest 5 minutes for the approximate arrival. */
function roundTo5(iso: string): string {
  const five = 5 * 60_000;
  return new Date(Math.round(Date.parse(iso) / five) * five).toISOString();
}

export function placeOwedVisits(
  owed: OwedVisit[],
  ctx: {
    windowStart: string;
    windowEnd: string;
    origin: SchedLatLng;
    waypoints: FixedWaypoint[];
    timeBlocks: SchedTimeBlock[];
  },
): OwedPlacementResult {
  if (owed.length === 0) return { placed: [], spilledTaskIds: [] };
  const byId = new Map(owed.map((o) => [o.taskId, o]));

  const result = scheduleDay({
    windowStart: ctx.windowStart,
    windowEnd: ctx.windowEnd,
    origin: ctx.origin,
    waypoints: ctx.waypoints,
    timeBlocks: ctx.timeBlocks,
    prospects: owed.map((o) => ({
      id: o.taskId,
      name: o.name,
      lat: o.lat,
      lng: o.lng,
      urgency: o.urgency,
      dwellMin: OWED_DWELL_MIN,
    })),
  });

  const placed: OwedTimedStop[] = [];
  for (const e of result.timeline) {
    if (e.kind !== "prospect") continue;
    const o = byId.get(e.id);
    if (!o) continue;
    placed.push({
      taskId: o.taskId,
      dealId: o.dealId,
      name: o.name,
      bandPosition: o.bandPosition,
      sourceOutcome: o.sourceOutcome,
      createdAt: o.createdAt,
      aroundIso: roundTo5(e.arrive),
    });
  }
  return { placed, spilledTaskIds: result.unscheduledProspectIds };
}
