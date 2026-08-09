/**
 * useDueTodayVisits (SP-B1). The drop-in follow-ups whose window OPENS today on
 * `pathDate`, assembled into routable candidates. The sibling of `useOwedVisits`:
 * same task -> deal -> coordinates join, same eligibility, same coord resolution
 * (originating prospect by place_id, else the deal's own geocoded lat/lng). The
 * ONLY difference is the band bound.
 *
 *   - `useOwedVisits` reads `.lte("earliest_at", pathDate)` (the whole opened
 *     window) and the composing hook keeps the PAST-DUE slice (earliest < today).
 *   - `useDueTodayVisits` reads `.eq("earliest_at", pathDate)` (the window opens
 *     TODAY), which is the DUE-TODAY slice.
 *
 * The two bands are disjoint on `earliest_at` (strictly-before vs equal-to
 * `pathDate`), so a task is in exactly one tier and is never double-counted.
 * Coordinates come from `assembleOwedVisits`, so a task with no resolvable coords
 * is dropped here too and never reaches the assembler.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import {
  assembleOwedVisits,
  type OwedVisit,
  type OwedTaskRow,
  type OwedDealRow,
  type OwedProspectRow,
} from "../lib/owedVisits";

export const DUE_TODAY_VISITS_QUERY_KEY = (userId: string | undefined, pathDate: string) =>
  ["path", "due-today-visits", userId ?? "anon", pathDate] as const;

const TASK_COLS =
  "id, deal_id, type, status, earliest_at, target_at, latest_at, date_source, exclude_from_path, source_outcome, snooze_count, created_at";

/** UTC ISO bounds of the local calendar day named by `pathDate` (YYYY-MM-DD).
 *  `new Date("YYYY-MM-DDT00:00:00")` parses in local time, so this brackets the
 *  rep's day regardless of timezone. Mirrors `useOwedVisits`. */
function localDayBounds(pathDate: string): { startIso: string; endIso: string } {
  const start = new Date(`${pathDate}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function useDueTodayVisits(pathDate: string): { dueToday: OwedVisit[]; isLoading: boolean } {
  const userId = useAuth((s) => s.user?.id);
  const query = useQuery({
    queryKey: DUE_TODAY_VISITS_QUERY_KEY(userId, pathDate),
    enabled: Boolean(userId) && Boolean(pathDate),
    staleTime: 30_000,
    queryFn: async (): Promise<OwedVisit[]> => {
      // 1. Open drop-in tasks whose window OPENS exactly on pathDate (the
      //    due-today band). `.eq` here is the only line that differs from the
      //    owed query's `.lte`. exclude_from_path and stage are filtered in the
      //    pure assembler (stage needs the deal join).
      const { data: taskData, error: taskErr } = await supabase
        .from("task")
        .select(TASK_COLS)
        .eq("type", "drop_in")
        .eq("status", "open")
        .eq("earliest_at", pathDate)
        .not("deal_id", "is", null);
      if (taskErr) throw taskErr;
      const tasks = (taskData ?? []) as unknown as OwedTaskRow[];
      if (tasks.length === 0) return [];

      // 2. Their deals: stage (won/lost excluded) + place_id (the coord key) +
      //    the deal's own coords (manual-deal fallback).
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

      // 4. Deals with a scheduled appointment TODAY. The appointment supersedes
      //    the drop-in (spec §7), so those due-today visits are suppressed.
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
  return { dueToday: query.data ?? [], isLoading: query.isLoading && query.fetchStatus !== "idle" };
}
