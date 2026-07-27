/**
 * useTeamPersistenceIndex — team-aggregate Persistence Index for a
 * manager/admin: median across the reps in their RLS scope. Reads the same
 * cached deals + activities as the individual hook.
 */

import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { computeTeamPersistenceIndex, type TeamPersistenceIndexResult } from "../lib/persistenceIndex";
import { useFutureAppointmentDealIds, withFutureAppointmentFlag, EMPTY_DEAL_ID_SET } from "./useFutureAppointmentDealIds";

export function useTeamPersistenceIndex(): TeamPersistenceIndexResult {
  const { data: deals = [] } = useDeals();
  const { data: activities = [] } = useActivitiesForOrg();
  const futureApptIds = useFutureAppointmentDealIds().data ?? EMPTY_DEAL_ID_SET;
  return React.useMemo(
    () => computeTeamPersistenceIndex(withFutureAppointmentFlag(deals, futureApptIds), activities, { now: new Date() }),
    [deals, activities, futureApptIds],
  );
}
