/**
 * useAppointmentsAwaitingRollup — manager/admin per-rep count of scheduled
 * appointments awaiting an outcome (W2d). Calls the appointments_awaiting_
 * rollup RPC (hierarchy + role scoped server-side, mirrors coverage_rollup)
 * and maps to camelCase. An RPC error (incl. a non-manager hitting it) is
 * treated as no-data so the card renders its empty/null state.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export interface AppointmentsAwaitingRollupRow {
  userId: string;
  fullName: string | null;
  awaitingCount: number;
}

interface RollupRpcRow {
  user_id: string;
  full_name: string | null;
  awaiting_count: number;
}

export const APPOINTMENTS_AWAITING_ROLLUP_QUERY_KEY = (userId: string | undefined) =>
  ["appointments", "awaiting-rollup", userId ?? "anon"] as const;

export function useAppointmentsAwaitingRollup(): {
  rows: AppointmentsAwaitingRollupRow[];
  isLoading: boolean;
} {
  const userId = useAuth((s) => s.user?.id);
  const query = useQuery({
    queryKey: APPOINTMENTS_AWAITING_ROLLUP_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<AppointmentsAwaitingRollupRow[]> => {
      const { data, error } = await supabase.rpc("appointments_awaiting_rollup");
      if (error) throw error;
      return ((data ?? []) as unknown as RollupRpcRow[]).map((r) => ({
        userId: r.user_id,
        fullName: r.full_name,
        awaitingCount: r.awaiting_count,
      }));
    },
    staleTime: 30_000,
  });
  return { rows: query.data ?? [], isLoading: query.isLoading };
}
