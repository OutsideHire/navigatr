/**
 * useActivityToWin — the Activity-to-Win aggregate for the current viewer.
 *
 * Reads the RLS-scoped deals query (so managers see their team and reps see
 * their own automatically) and aggregates the per-deal snapshot columns via
 * the pure `computeActivityToWin`. No display here — the headline widget
 * (slice 3) and the drill-down (slice 4) consume this.
 */

import * as React from "react";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import {
  computeActivityToWin,
  type AwFilters,
  type ActivityToWinAggregate,
} from "../lib/activityToWin";
import type { DateRange } from "../lib/dateRange";

export function useActivityToWin(range: DateRange, filters?: AwFilters): ActivityToWinAggregate {
  const { data: deals = [] } = useDeals();
  return React.useMemo(
    () => computeActivityToWin(deals, { range, filters }),
    [deals, range, filters],
  );
}
