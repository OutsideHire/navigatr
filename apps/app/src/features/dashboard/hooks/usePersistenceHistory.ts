/**
 * usePersistenceHistory — client-side daily Persistence Index series for the
 * selected range. Rep → own; manager/admin → team median. Recomputed from the
 * already-cached deals + activities (no backend).
 */
import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { useProfile } from "@/features/auth/useProfile";
import { useAuth } from "@/stores/auth";
import { computePersistenceHistory, type PersistencePoint } from "../lib/persistenceIndex";

export function usePersistenceHistory(rangeDays: number): PersistencePoint[] {
  const { data: deals = [] } = useDeals();
  const { data: activities = [] } = useActivitiesForOrg();
  const role = useProfile().data?.role;
  const ownerId = useAuth((s) => s.user?.id);
  const team = role === "manager" || role === "admin";

  return React.useMemo(() => {
    if (!team && !ownerId) return [];
    return computePersistenceHistory(deals, activities, { now: new Date(), rangeDays, ownerId, team });
  }, [deals, activities, team, ownerId, rangeDays]);
}
