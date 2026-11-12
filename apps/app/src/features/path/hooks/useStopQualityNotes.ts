/**
 * useStopQualityNotes (Path Data Quality Fix v1.2, R4). For the deals behind
 * the stops on the rep's day, the one-line note explaining why a business looks
 * closed or was flagged by a teammate. The stop itself is never removed.
 *
 * Asks the `path_quality_flags` function, which honors the same global switch
 * as discovery (switched off -> no notes) and never calls Google: a "closed"
 * note only appears when Path's saved search results already say so.
 *
 * A note is decoration on a row that must render regardless, so a failure
 * yields no notes, never an error the screen has to handle.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { stopQualityNotes, type StopQualityFlag } from "../lib/stopQualityNote";

const EMPTY = new Map<string, string>();

export function useStopQualityNotes(dealIds: ReadonlyArray<string | null | undefined>): Map<string, string> {
  const ids = [...new Set(dealIds.filter((d): d is string => typeof d === "string" && d.length > 0))].sort();
  const query = useQuery({
    queryKey: ["path", "quality-notes", ids],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase.functions.invoke<{ enabled?: boolean; flags?: StopQualityFlag[] }>(
        "path_quality_flags",
        { body: { deal_ids: ids } },
      );
      if (error) {
        console.error("path_quality_flags_failed", error);
        return EMPTY;
      }
      return stopQualityNotes(data?.flags ?? []);
    },
  });
  return query.data ?? EMPTY;
}
