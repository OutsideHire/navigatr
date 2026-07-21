/**
 * usePersistenceHistory — client-side daily Persistence Index series for the
 * selected range. Rep → own; manager/admin → team median. An optional
 * `targetOwnerId` (manager drill-down into a specific rep) overrides the
 * role-based default and returns that rep's own series. Recomputed from the
 * already-cached deals + activities (no backend).
 */
import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { useProfile } from "@/features/auth/useProfile";
import { useAuth } from "@/stores/auth";
import { computePersistenceHistory, type PersistencePoint } from "../lib/persistenceIndex";

export function usePersistenceHistory(rangeDays: number, targetOwnerId?: string): PersistencePoint[] {
  const { data: deals = [] } = useDeals();
  const { data: activities = [] } = useActivitiesForOrg();
  const role = useProfile().data?.role;
  const viewerId = useAuth((s) => s.user?.id);

  // Targeting a specific rep (drill-down) overrides the role-based default.
  const team = !targetOwnerId && (role === "manager" || role === "admin");
  const ownerId = targetOwnerId ?? viewerId;

  return React.useMemo(() => {
    if (!team && !ownerId) return [];
    return computePersistenceHistory(deals, activities, { now: new Date(), rangeDays, ownerId, team });
  }, [deals, activities, team, ownerId, rangeDays]);
}
