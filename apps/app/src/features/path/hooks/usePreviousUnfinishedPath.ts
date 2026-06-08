/**
 * usePreviousUnfinishedPath — detects the rep's most-recent PAST path that still
 * has pending stops, so the Path page can offer to continue or close it. Lazy
 * (runs on render), RLS-scoped to the user. Returns null when nothing qualifies.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { todayISO } from "../lib/today";

export const PREVIOUS_UNFINISHED_QUERY_KEY = ["paths", "previous-unfinished"] as const;

export interface PreviousUnfinishedPath {
  pathId: string;
  pathDate: string;
  pendingCount: number;
}

interface Row {
  id: string;
  path_date: string;
  status: string;
  path_stops: { status: string }[];
}

export function usePreviousUnfinishedPath() {
  const userId = useAuth((s) => s.user?.id);
  const today = todayISO();
  return useQuery({
    queryKey: [...PREVIOUS_UNFINISHED_QUERY_KEY, userId, today],
    enabled: !!userId,
    queryFn: async (): Promise<PreviousUnfinishedPath | null> => {
      const { data, error } = await supabase
        .from("paths")
        .select("id, path_date, status, path_stops(status)")
        .lt("path_date", today)
        .neq("status", "completed")
        .order("path_date", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as Row[];
      const hit = rows.find((r) => (r.path_stops ?? []).some((s) => s.status === "pending"));
      if (!hit) return null;
      const pendingCount = hit.path_stops.filter((s) => s.status === "pending").length;
      return { pathId: hit.id, pathDate: hit.path_date, pendingCount };
    },
  });
}
