/**
 * useCronHealth — freshness facts for the scheduled background jobs, from the
 * admin-gated cron_health() RPC. Returns {} for a non-admin (the RPC enforces
 * it), which the card renders as hidden.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { CronHealthFacts } from "../lib/cronHealth";

export const CRON_HEALTH_QUERY_KEY = (userId: string | undefined) =>
  ["cron-health", userId ?? "anon"] as const;

export function useCronHealth() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: CRON_HEALTH_QUERY_KEY(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<CronHealthFacts> => {
      const { data, error } = await supabase.rpc("cron_health");
      if (error) throw error;
      return (data ?? {}) as CronHealthFacts;
    },
    staleTime: 5 * 60_000,
  });
}
