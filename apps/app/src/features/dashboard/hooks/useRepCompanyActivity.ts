/**
 * useRepCompanyActivity: the Activities by Sales Rep and Company aggregate for
 * the current viewer. Composes the org activity feed with the RLS-scoped deals
 * (for owner and company) and member names, then delegates to the pure
 * aggregation. Managers see their team automatically via RLS on both feeds.
 */
import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { useActivitiesForOrg } from "@/features/activities/hooks/useActivities";
import { useOrgMemberNames } from "../hooks/useOrgMemberNames";
import {
  attributeActivities,
  repCompanyAggregate,
  type RepCompanyAggregate,
} from "../lib/repCompanyActivity";
import type { DateRange } from "../lib/dateRange";

export interface UseRepCompanyActivityResult extends RepCompanyAggregate {
  nameOf: (ownerId: string | null) => string;
  isLoading: boolean;
}

export function useRepCompanyActivity(range: DateRange): UseRepCompanyActivityResult {
  const activitiesQ = useActivitiesForOrg();
  const dealsQ = useDeals();
  const names = useOrgMemberNames(true);

  const agg = React.useMemo(
    () => repCompanyAggregate(attributeActivities(activitiesQ.data ?? [], dealsQ.data ?? [], range)),
    [activitiesQ.data, dealsQ.data, range],
  );

  const nameOf = React.useCallback(
    (ownerId: string | null) => (ownerId ? names.get(ownerId) ?? "Unknown rep" : "Unassigned"),
    [names],
  );

  return { ...agg, nameOf, isLoading: activitiesQ.isLoading || dealsQ.isLoading };
}
