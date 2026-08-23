/**
 * useLocationCaptureHealth — the weekly capture-health figure (FR-HIER-37).
 * Calls the admin-gated location_capture_health RPC; a non-admin gets an empty
 * set (the RPC enforces this), so the card simply renders empty for them.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { CaptureHealthRow } from "../lib/captureHealth";

export const CAPTURE_HEALTH_QUERY_KEY = (userId: string | undefined, days: number) =>
  ["location-capture-health", userId ?? "anon", days] as const;

export function useLocationCaptureHealth(days = 7) {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: CAPTURE_HEALTH_QUERY_KEY(userId, days),
    enabled: Boolean(userId),
    queryFn: async (): Promise<CaptureHealthRow[]> => {
      const { data, error } = await supabase.rpc("location_capture_health", { p_days: days });
      if (error) throw error;
      return (data ?? []) as CaptureHealthRow[];
    },
    staleTime: 5 * 60_000,
  });
}
