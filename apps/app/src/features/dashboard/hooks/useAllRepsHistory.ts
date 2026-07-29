/**
 * useAllRepsHistory — one daily composite series per rep over the selected
 * range, for the "All reps" overlay on the Persistence Index trend chart
 * (SP-1). Each series aligns index-for-index with the team series (same `now`
 * + `rangeDays`), so the chart can plot them on the same x-scale. Computed from
 * the same cached deals+activities; only runs when `enabled` (the toggle is on).
 */
import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { computePersistenceHistory } from "../lib/persistenceIndex";
import {
  useFutureAppointmentDealIds,
  withFutureAppointmentFlag,
  EMPTY_DEAL_ID_SET,
} from "./useFutureAppointmentDealIds";

export interface RepHistorySeries {
  ownerId: string;
  /** Daily composite values (null where the rep has no score that day). */
  values: (number | null)[];
}

export function useAllRepsHistory(rangeDays: number, enabled: boolean): RepHistorySeries[] {
  const { data: deals = [] } = useDeals();
  const { data: activities = [] } = useActivitiesForOrg();
  const futureApptIds = useFutureAppointmentDealIds().data ?? EMPTY_DEAL_ID_SET;

  return React.useMemo(() => {
    if (!enabled) return [];
    const flagged = withFutureAppointmentFlag(deals, futureApptIds);
    const now = new Date();
    const owners = [...new Set(flagged.map((d) => d.owner_id).filter((x): x is string => x != null))];
    return owners.map((ownerId) => ({
      ownerId,
      values: computePersistenceHistory(flagged, activities, {
        now,
        rangeDays,
        ownerId,
        team: false,
      }).map((p) => p.composite),
    }));
  }, [enabled, deals, activities, futureApptIds, rangeDays]);
}
