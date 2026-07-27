/**
 * useFutureAppointmentDealIds: Persistence Index Wave 1 addendum.
 *
 * A deal with a scheduled (not-yet-occurred) appointment never had a fair
 * chance to be judged "silent", so re-engagement scoring excludes it (mirrors
 * the server-side snapshot pipeline's `fetchOrgDeals` lookup in
 * compute_persistence_snapshots/index.ts, so the client's live score matches
 * the nightly snapshot). RLS scopes `scheduled_appointments` rows to the
 * viewer's org (managers/admins) or their own rows (reps), same as deals.
 *
 * An RPC/query error is treated as no exclusions (empty set) rather than
 * surfaced. A missing appointment lookup should never block the Persistence
 * Index from rendering; it just means one fewer exclusion applied.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Deal } from "@/features/pipeline/mockData";

/** Stable empty-set reference so callers can default `query.data` without
 *  creating a new Set identity on every render (which would defeat memoization
 *  in the hooks that key off this value). */
export const EMPTY_DEAL_ID_SET: ReadonlySet<string> = new Set();

export function useFutureAppointmentDealIds() {
  return useQuery({
    queryKey: ["persistence-future-appointment-deal-ids"],
    queryFn: async (): Promise<Set<string>> => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("scheduled_appointments")
        .select("deal_id")
        .eq("status", "scheduled")
        .gt("start_at", nowIso);
      if (error) return new Set<string>();
      return new Set((data ?? []).map((r) => r.deal_id as string));
    },
    staleTime: 30_000,
  });
}

/**
 * Attach `has_future_appointment` to each deal from the exclusion id set.
 * `owner_changed_at` already rides along on the Deal from useDeals' SELECT,
 * so it needs no mapping here. Deals not in the set default to `false`
 * (no exclusion), the safe default when the lookup is still loading or
 * failed.
 */
export function withFutureAppointmentFlag(deals: Deal[], futureApptIds: ReadonlySet<string>): Deal[] {
  return deals.map((d) => ({ ...d, has_future_appointment: futureApptIds.has(d.id) }));
}
