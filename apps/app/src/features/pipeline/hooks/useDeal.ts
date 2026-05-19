/**
 * useDeal(dealId) — single-deal lookup, subscribed to the deals list query.
 *
 * Composes useDeals() so the deal detail page sees the same source of
 * truth as the pipeline list. React Query dedupes the underlying fetch
 * by query key — no duplicate network request fires when both /pipeline
 * and /pipeline/:dealId are mounted in the same session.
 *
 * Earlier versions read from queryClient.getQueryData inside a useMemo.
 * That snapshots the cache once and never re-runs, so a fresh navigation
 * where the cache was cold would render NotFound even after the list
 * query resolved. Subscribing via useDeals fixes that — when data arrives,
 * the component re-renders and the find() picks the right deal up.
 */

import * as React from "react";
import { type Deal } from "../mockData";
import { useDeals } from "./useDeals";

export interface UseDealResult {
  deal: Deal | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function useDeal(dealId: string | undefined): UseDealResult {
  const { data: deals, isLoading, isError } = useDeals();

  const deal = React.useMemo<Deal | undefined>(() => {
    if (!dealId || !deals) return undefined;
    return deals.find((d) => d.id === dealId);
  }, [dealId, deals]);

  return { deal, isLoading, isError };
}
