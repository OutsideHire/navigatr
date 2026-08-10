/**
 * useDrivingSequence (FR-PATH-UX-06). Gather the day's four LIVE sources and
 * feed them into the pure `drivingSequence` merge, producing the ordered,
 * one-at-a-time "driving cards" the Path Driving screen renders.
 *
 * The composition mirrors `useLiveDayTiers`: the same meetings + past-due +
 * due-today live tiers, plus the persisted native `path_stops` (pending only).
 * Everything time/clock-related stays in this hook; the pure `drivingSequence`
 * receives an explicit `now` and never reads the clock itself.
 */
import * as React from "react";
import { useMeetingStops } from "./useMeetingStops";
import { useOwedVisits } from "./useOwedVisits";
import { useDueTodayVisits } from "./useDueTodayVisits";
import { useTodayPath } from "./useTodayPath";
import { drivingSequence, type DrivingCard } from "../lib/drivingSequence";

/** Whole days between an ISO timestamp and now (floored, never negative) - the
 *  past-due staleness age, matching useLiveDayTiers / useTodaysPath's owed sort
 *  key. Reads Date.now(); only the pure `drivingSequence` stays clock-free. */
function ageDaysSince(iso: string): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

export interface UseDrivingSequenceResult {
  cards: DrivingCard[];
  isLoading: boolean;
}

/**
 * Compose the day's live sources into the ordered one-at-a-time driving cards.
 * @param pathDate local day (YYYY-MM-DD)
 * @param origin rep position for drive estimates
 * @param now ISO/epoch for the arrival clock (callers pass an explicit now)
 */
export function useDrivingSequence(
  pathDate: string,
  origin: { lat: number; lng: number },
  now: string | number,
): UseDrivingSequenceResult {
  const { stops: meetingStops, isLoading: meetingsLoading } = useMeetingStops(pathDate);
  const { owed, isLoading: owedLoading } = useOwedVisits(pathDate);
  const { dueToday, isLoading: dueTodayLoading } = useDueTodayVisits(pathDate);
  const { stops: nativeStops, isLoading: nativeLoading } = useTodayPath();

  const cards = React.useMemo(() => {
    // Past-due = the strictly-before-today slice of the opened owed window (the
    // equal-to-today rows are the disjoint due-today tier). Compare on the
    // YYYY-MM-DD date part (earliestAt is a date). Matches useLiveDayTiers.
    const pastDue = owed.filter((v) => v.earliestAt.slice(0, 10) < pathDate);

    return drivingSequence(
      {
        meetings: meetingStops.map((m) => ({
          id: m.id,
          kind: m.kind,
          title: m.title,
          address: m.address,
          dealId: m.dealId,
          appointmentId: m.appointmentId,
          startAt: m.startAt,
          endAt: m.endAt,
          lat: m.lat,
          lng: m.lng,
        })),
        pastDue: pastDue.map((v) => ({
          taskId: v.taskId,
          dealId: v.dealId,
          name: v.name,
          address: v.address,
          ageDays: ageDaysSince(v.createdAt),
          lat: v.lat,
          lng: v.lng,
        })),
        dueToday: dueToday.map((v) => ({
          taskId: v.taskId,
          dealId: v.dealId,
          name: v.name,
          address: v.address,
          lat: v.lat,
          lng: v.lng,
        })),
        native: nativeStops
          .filter((s) => s.status === "pending")
          .map((s) => ({
            merchantId: s.merchantId,
            name: s.name,
            address: s.address,
            lat: s.lat,
            lng: s.lng,
          })),
        origin,
      },
      now,
    );
  }, [meetingStops, owed, dueToday, nativeStops, pathDate, origin, now]);

  return {
    cards,
    isLoading: meetingsLoading || owedLoading || dueTodayLoading || nativeLoading,
  };
}
