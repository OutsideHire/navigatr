import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";

export type LeaderboardStatus = "active" | "invited" | "revoked";

export interface LeaderboardRow {
  agent_id: string;
  full_name: string | null;
  email: string;
  role: "rep" | "manager" | "admin";
  status: LeaderboardStatus;
  manager_id: string | null;
  open_deals: number;
  pipeline_cents: number;
  won_deals_window: number;
  won_cents_window: number;
  lost_deals_window: number;
  lost_cents_window: number;
  activities_window: number;
  last_activity: string | null;
}

export const TEAM_LEADERBOARD_QUERY_KEY = (userId: string | undefined, windowDays: number) =>
  ["admin", "leaderboard", userId ?? "anon", windowDays] as const;

export function useTeamLeaderboard(windowDays: number = 30) {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: TEAM_LEADERBOARD_QUERY_KEY(userId, windowDays),
    enabled: Boolean(userId),
    queryFn: async (): Promise<LeaderboardRow[]> => {
      const { data, error } = await supabase.rpc("team_leaderboard", {
        p_window_days: windowDays,
      });
      if (error) throw error;
      return (data ?? []) as LeaderboardRow[];
    },
    staleTime: 30_000,
  });
}
