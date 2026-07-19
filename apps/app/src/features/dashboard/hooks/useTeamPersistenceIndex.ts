/**
 * useTeamPersistenceIndex — team-aggregate Persistence Index for a
 * manager/admin: median across the reps in their RLS scope. Reads the same
 * cached deals + activities as the individual hook.
 */

import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { computeTeamPersistenceIndex, type TeamPersistenceIndexResult } from "../lib/persistenceIndex";

export function useTeamPersistenceIndex(): TeamPersistenceIndexResult {
  const { data: deals = [] } = useDeals();
  const { data: activities = [] } = useActivitiesForOrg();
  return React.useMemo(
    () => computeTeamPersistenceIndex(deals, activities, { now: new Date() }),
    [deals, activities],
  );
}
