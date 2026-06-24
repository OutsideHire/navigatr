/**
 * useUnloggedDials — the rep's click-to-call dials that were never logged as a
 * Call activity within the 4h grace (SP0 nudge source). Fetches the rep's own
 * dials (coverage_signal, RLS-scoped) + own Call activities, matches them with
 * computeUnloggedDials (pure), and joins deal company names from useDeals.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { useDeals } from "@/features/pipeline/hooks/useDeals";
import { computeUnloggedDials } from "../lib/unloggedDials";

/** Shapes Supabase returns. Snake_case timestamps. */
interface DialRow {
  deal_id: string;
  detected_at: string;
}

interface CallRow {
  deal_id: string;
  occurred_at: string;
}

export interface UnloggedDialView {
  dealId: string;
  companyName: string;
  lastDetectedAt: string;
  dialCount: number;
}

export const UNLOGGED_DIALS_QUERY_KEY = (userId: string | undefined) =>
  ["coverage", "unlogged-dials", userId ?? "anon"] as const;

export function useUnloggedDials() {
  const userId = useAuth((s) => s.user?.id);
  const deals = useDeals();

  return useQuery({
    queryKey: UNLOGGED_DIALS_QUERY_KEY(userId),
    // Gate on deals being loaded too: the company-name join reads deals.data,
    // and the 30s staleTime would otherwise pin "Unknown deal" if this query
    // resolved before useDeals populated.
    enabled: Boolean(userId) && deals.isSuccess,
    queryFn: async (): Promise<UnloggedDialView[]> => {
      // Own dials (RLS restricts to user_id = auth.uid()), oldest first.
      const { data: dialRows, error: dialErr } = await supabase
        .from("coverage_signal")
        .select("deal_id, detected_at")
        .eq("channel", "phone")
        .eq("signal_type", "dial")
        .order("detected_at", { ascending: true });
      if (dialErr) throw dialErr;
      const dials = ((dialRows ?? []) as unknown as DialRow[]).map((r) => ({
        dealId: r.deal_id,
        detectedAt: r.detected_at,
      }));
      if (dials.length === 0) return [];

      // Own Call activities since the oldest dial. The explicit logged_by
      // filter is load-bearing: activities RLS is org-wide (managers can read),
      // so unlike the rep-only coverage_signal query above we cannot lean on
      // RLS for per-rep scoping here.
      const { data: callRows, error: callErr } = await supabase
        .from("activities")
        .select("deal_id, occurred_at")
        .eq("logged_by", userId)
        .eq("type", "call")
        .gte("occurred_at", dials[0].detectedAt);
      if (callErr) throw callErr;
      const calls = ((callRows ?? []) as unknown as CallRow[]).map((r) => ({
        dealId: r.deal_id,
        occurredAt: r.occurred_at,
      }));

      const unlogged = computeUnloggedDials(dials, calls, new Date());
      const nameOf = new Map((deals.data ?? []).map((d) => [d.id, d.companyName]));
      return unlogged.map((u) => ({
        dealId: u.dealId,
        companyName: nameOf.get(u.dealId) ?? "Unknown deal",
        lastDetectedAt: u.lastDetectedAt,
        dialCount: u.dialCount,
      }));
    },
    staleTime: 30_000,
  });
}
