/**
 * usePerRepPersistence — per-rep Persistence Index scores in the viewer's
 * scope, for the manager roster on the detail page. Reads the same cached
 * deals + activities. Callers gate rendering by role.
 */
import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { computePerRepPersistence, type PerRepScore } from "../lib/persistenceIndex";

export function usePerRepPersistence(): PerRepScore[] {
  const { data: deals = [] } = useDeals();
  const { data: activities = [] } = useActivitiesForOrg();
  return React.useMemo(
    () => computePerRepPersistence(deals, activities, { now: new Date() }),
    [deals, activities],
  );
}
