/**
 * useActivePath — a single working day's path plus its stops, ordered by
 * position. Returns { path: null, stops: [] } when the rep has no path that day.
 * RLS scopes to the user; the cache key carries user id + date.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { rowToPath, rowToStop, type Path, type PathRow, type PathStop, type PathStopRow } from "../lib/pathTypes";

export const ACTIVE_PATH_QUERY_KEY = ["paths", "active"] as const;

type PathWithStopsRow = PathRow & { path_stops: PathStopRow[] };

export interface ActivePathResult {
  path: Path | null;
  stops: PathStop[];
}

export function useActivePath(date: string) {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: [...ACTIVE_PATH_QUERY_KEY, userId, date],
    enabled: !!userId && !!date,
    queryFn: async (): Promise<ActivePathResult> => {
      const { data, error } = await supabase
        .from("paths")
        .select(
          "id, path_date, origin_label, origin_lat, origin_lng, status, started_at, " +
          "path_stops(id, path_id, prospect_id, name, address, phone, lat, lng, category, primary_type, position, status, disposition, notes, deal_created, added_at)",
        )
        .eq("path_date", date)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { path: null, stops: [] };
      const row = data as unknown as PathWithStopsRow;
      const stops = (row.path_stops ?? []).map(rowToStop).sort((a, b) => a.position - b.position);
      return { path: rowToPath(row, stops.length), stops };
    },
  });
}
