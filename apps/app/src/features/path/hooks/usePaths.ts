/**
 * usePaths — the signed-in rep's paths (newest day first), each with a stop
 * count. RLS scopes rows to the user, so no explicit user filter is needed; the
 * cache key is tailed with the user id so sign-out/in invalidates cleanly.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { rowToPath, type Path, type PathRow } from "../lib/pathTypes";

export const PATHS_QUERY_KEY = ["paths", "list"] as const;

/** Row shape with the embedded aggregate count PostgREST returns. */
type PathListRow = PathRow & { path_stops: { count: number }[] };

export function usePaths() {
  const userId = useAuth((s) => s.user?.id);
  return useQuery({
    queryKey: [...PATHS_QUERY_KEY, userId],
    enabled: !!userId,
    queryFn: async (): Promise<Path[]> => {
      const { data, error } = await supabase
        .from("paths")
        .select("id, path_date, origin_label, origin_lat, origin_lng, status, path_stops(count)")
        .order("path_date", { ascending: false });
      if (error) throw error;
      return (data as PathListRow[] | null ?? []).map((r) =>
        rowToPath(r, r.path_stops?.[0]?.count ?? 0),
      );
    },
  });
}
