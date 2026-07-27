/**
 * usePerRepPersistence — per-rep Persistence Index scores in the viewer's
 * scope, for the manager roster on the detail page. Reads the same cached
 * deals + activities. Callers gate rendering by role.
 */
import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { computePerRepPersistence, type PerRepScore } from "../lib/persistenceIndex";
import { useFutureAppointmentDealIds, withFutureAppointmentFlag, EMPTY_DEAL_ID_SET } from "./useFutureAppointmentDealIds";

export function usePerRepPersistence(): PerRepScore[] {
  const { data: deals = [] } = useDeals();
  const { data: activities = [] } = useActivitiesForOrg();
  const futureApptIds = useFutureAppointmentDealIds().data ?? EMPTY_DEAL_ID_SET;
  return React.useMemo(
    () => computePerRepPersistence(withFutureAppointmentFlag(deals, futureApptIds), activities, { now: new Date() }),
    [deals, activities, futureApptIds],
  );
}
