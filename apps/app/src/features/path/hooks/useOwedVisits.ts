/**
 * useOwedVisits (SP3 T3) — the drop-in follow-ups the rep owes on `pathDate`,
 * assembled into routable candidates (name + coords + urgency). Three cheap
 * reads, RLS-scoped to the org:
 *   1. open drop-in tasks (the `task` table),
 *   2. their deals (stage + place_id + name), and
 *   3. the prospects that supply coordinates, matched on place_id.
 * The join + eligibility + ordering live in the pure `assembleOwedVisits`.
 *
 * Coordinates come from the deal's originating prospect (SP3 decision): a
 * manual deal with no place_id, or one whose prospect isn't cached, is not
 * routable in v1 and simply doesn't appear.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import {
  assembleOwedVisits,
  type AssembledOwedVisits,
  type OwedVisit,
  type OwedVisitNoCoords,
  type OwedTaskRow,
  type OwedDealRow,
  type OwedProspectRow,
} from "../lib/owedVisits";

export const OWED_VISITS_QUERY_KEY = (userId: string | undefined, pathDate: string) =>
  ["path", "owed-visits", userId ?? "anon", pathDate] as const;

const TASK_COLS =
  "id, deal_id, type, status, earliest_at, target_at, latest_at, date_source, exclude_from_path, source_outcome, snooze_count, created_at";

/** UTC ISO bounds of the local calendar day named by `pathDate` (YYYY-MM-DD).
 *  `new Date("YYYY-MM-DDT00:00:00")` parses in local time, so this brackets the
 *  rep's day regardless of timezone. */
function localDayBounds(pathDate: string): { startIso: string; endIso: string } {
  const start = new Date(`${pathDate}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function useOwedVisits(
  pathDate: string,
): { owed: OwedVisit[]; noLocation: OwedVisitNoCoords[]; isLoading: boolean } {
  const userId = useAuth((s) => s.user?.id);
  const query = useQuery({
    queryKey: OWED_VISITS_QUERY_KEY(userId, pathDate),
    enabled: Boolean(userId) && Boolean(pathDate),
    staleTime: 30_000,
    queryFn: async (): Promise<AssembledOwedVisits> => {
      // 1. Open drop-in tasks whose window has opened by pathDate. exclude_from_path
      //    and stage are filtered in the pure assembler (stage needs the deal join).
      const { data: taskData, error: taskErr } = await supabase
        .from("task")
        .select(TASK_COLS)
        .eq("type", "drop_in")
        .eq("status", "open")
        .lte("earliest_at", pathDate)
        .not("deal_id", "is", null);
      if (taskErr) throw taskErr;
      const tasks = (taskData ?? []) as unknown as OwedTaskRow[];
      if (tasks.length === 0) return { routable: [], noLocation: [] };

      // 2. Their deals — stage (won/lost excluded) + place_id (the coord key).
      const dealIds = [...new Set(tasks.map((t) => t.deal_id).filter((id): id is string => id != null))];
      const { data: dealData, error: dealErr } = await supabase
        .from("deals")
        .select("id, company_name, address, stage, place_id, lat, lng")
        .in("id", dealIds);
      if (dealErr) throw dealErr;
      const deals = (dealData ?? []) as unknown as OwedDealRow[];

      // 3. Prospects supplying coordinates for those deals' place_ids.
      const placeIds = [...new Set(deals.map((d) => d.place_id).filter((p): p is string => p != null))];
      let prospects: OwedProspectRow[] = [];
      if (placeIds.length > 0) {
        const { data: pData, error: pErr } = await supabase
          .from("prospects")
          .select("place_id, lat, lng")
          .in("place_id", placeIds);
        if (pErr) throw pErr;
        prospects = (pData ?? []) as unknown as OwedProspectRow[];
      }

      // 4. Deals with a scheduled appointment TODAY — the appointment supersedes
      //    the drop-in (spec §7), so those owed visits are suppressed.
      const { startIso, endIso } = localDayBounds(pathDate);
      const { data: apptData, error: apptErr } = await supabase
        .from("scheduled_appointments")
        .select("deal_id")
        .in("deal_id", dealIds)
        .eq("status", "scheduled")
        .gte("start_at", startIso)
        .lt("start_at", endIso);
      if (apptErr) throw apptErr;
      const supersededDealIds = new Set(
        ((apptData ?? []) as unknown as Array<{ deal_id: string }>).map((r) => r.deal_id),
      );

      return assembleOwedVisits(tasks, deals, prospects, pathDate, {
        supersededDealIds,
        excludeCreatedAtOrAfter: startIso,
      });
    },
  });
  return {
    owed: query.data?.routable ?? [],
    noLocation: query.data?.noLocation ?? [],
    isLoading: query.isLoading && query.fetchStatus !== "idle",
  };
}
