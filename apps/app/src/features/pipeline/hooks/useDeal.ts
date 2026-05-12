/**
 * useDeal(dealId) — Sprint 1 client-side lookup.
 *
 * Reads from the cached ['deals','mock'] TanStack Query data populated by
 * PipelinePage (Session 13). If the cache hasn't been hydrated yet (e.g.
 * user deep-linked to /pipeline/:dealId without visiting /pipeline first),
 * falls back to MOCK_DEALS directly so the page still renders.
 *
 * Sprint 2: replace with `Deals.getDeal(dealId)` from the generated SDK.
 */

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MOCK_DEALS, type Deal } from "../mockData";
import { activitiesForDeal, type Activity } from "@/features/activities/mockData";

export interface UseDealResult {
  deal: Deal | undefined;
  activities: Activity[];
  /** Bumps after a successful activity log so consumers re-read. */
  activitiesVersion: number;
  refreshActivities: () => void;
}

export function useDeal(dealId: string | undefined): UseDealResult {
  const queryClient = useQueryClient();
  const [activitiesVersion, setActivitiesVersion] = React.useState(0);

  const deal = React.useMemo<Deal | undefined>(() => {
    if (!dealId) return undefined;
    const cached = queryClient.getQueryData<Deal[]>(["deals", "mock"]);
    const list = cached ?? MOCK_DEALS;
    return list.find((d) => d.id === dealId);
  }, [dealId, queryClient, activitiesVersion]);

  const activities = React.useMemo<Activity[]>(() => {
    if (!dealId) return [];
    return activitiesForDeal(dealId);
    // `activitiesVersion` invalidates the memo without changing the underlying call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, activitiesVersion]);

  const refreshActivities = React.useCallback(() => {
    setActivitiesVersion((v) => v + 1);
  }, []);

  return { deal, activities, activitiesVersion, refreshActivities };
}
