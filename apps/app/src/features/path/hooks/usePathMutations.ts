/**
 * usePathMutations — write side of the path data layer. Each mutation invalidates
 * the affected queries (the list + the day's active path) so the UI refreshes.
 * RLS enforces ownership server-side; createPath upserts on (user_id, path_date)
 * to keep the one-path-per-day invariant.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import type { MerchantCategory } from "../mockData";
import type { StopStatus } from "../lib/pathTypes";
import { PATHS_QUERY_KEY } from "./usePaths";
import { ACTIVE_PATH_QUERY_KEY } from "./useActivePath";
import { todayISO, addDaysISO } from "../lib/today";
import { PREVIOUS_UNFINISHED_QUERY_KEY } from "./usePreviousUnfinishedPath";

export interface CreatePathInput {
  date: string;
  originLabel: string | null;
  originLat: number | null;
  originLng: number | null;
}
export interface StopSnapshot {
  prospectId: string;
  name: string;
  address: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  category: MerchantCategory;
  primaryType: string | null;
}
export interface AddStopsInput { pathId: string; basePosition: number; stops: StopSnapshot[]; }

export function usePathMutations() {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [...PATHS_QUERY_KEY, userId] });
    qc.invalidateQueries({ queryKey: [...ACTIVE_PATH_QUERY_KEY, userId] });
    qc.invalidateQueries({ queryKey: [...PREVIOUS_UNFINISHED_QUERY_KEY, userId] });
  };

  const createPath = useMutation({
    mutationFn: async (input: CreatePathInput): Promise<string> => {
      if (!userId) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("paths")
        .upsert(
          { user_id: userId, path_date: input.date, origin_label: input.originLabel,
            origin_lat: input.originLat, origin_lng: input.originLng },
          { onConflict: "user_id,path_date" },
        )
        .select("id")
        .single();
      if (error) throw error;
      return (data as unknown as { id: string }).id;
    },
    onSuccess: invalidate,
  });

  const addStops = useMutation({
    mutationFn: async (input: AddStopsInput): Promise<void> => {
      const rows = input.stops.map((s, i) => ({
        path_id: input.pathId, prospect_id: s.prospectId, name: s.name, address: s.address,
        phone: s.phone, lat: s.lat, lng: s.lng, category: s.category, primary_type: s.primaryType,
        position: input.basePosition + i,
      }));
      const { error } = await supabase
        .from("path_stops")
        .upsert(rows, { onConflict: "path_id,prospect_id", ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const removeStop = useMutation({
    mutationFn: async (stopId: string): Promise<void> => {
      const { error } = await supabase.from("path_stops").delete().eq("id", stopId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const reorderStops = useMutation({
    mutationFn: async (input: { orderedStopIds: string[] }): Promise<void> => {
      for (let i = 0; i < input.orderedStopIds.length; i++) {
        const { error } = await supabase.from("path_stops").update({ position: i }).eq("id", input.orderedStopIds[i]);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const setStopStatus = useMutation({
    mutationFn: async (input: { stopId: string; status: StopStatus }): Promise<void> => {
      const { error } = await supabase.from("path_stops").update({ status: input.status }).eq("id", input.stopId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const setStopDisposition = useMutation({
    mutationFn: async (input: { stopId: string; disposition: string }): Promise<void> => {
      const { error } = await supabase.from("path_stops").update({ disposition: input.disposition }).eq("id", input.stopId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const markDealCreated = useMutation({
    mutationFn: async (stopId: string): Promise<void> => {
      const { error } = await supabase.from("path_stops").update({ deal_created: true }).eq("id", stopId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deletePath = useMutation({
    mutationFn: async (pathId: string): Promise<void> => {
      const { error } = await supabase.from("paths").delete().eq("id", pathId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Mark every still-unfinished path older than `beforeDate` completed and skip
  // its leftover pending stops. RLS scopes all of this to the current user.
  const finalizeOlderThan = async (beforeDate: string): Promise<void> => {
    const { data, error } = await supabase
      .from("paths").select("id").lt("path_date", beforeDate).neq("status", "completed");
    if (error) throw error;
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) return;
    const { error: e1 } = await supabase
      .from("path_stops").update({ status: "skipped" }).in("path_id", ids).eq("status", "pending");
    if (e1) throw e1;
    const { error: e2 } = await supabase.from("paths").update({ status: "completed" }).in("id", ids);
    if (e2) throw e2;
  };

  // Finalize a single path: skip its pending stops, mark it completed.
  const finalizeSingle = async (pathId: string): Promise<void> => {
    const { error: e1 } = await supabase
      .from("path_stops").update({ status: "skipped" }).eq("path_id", pathId).eq("status", "pending");
    if (e1) throw e1;
    const { error: e2 } = await supabase.from("paths").update({ status: "completed" }).eq("id", pathId);
    if (e2) throw e2;
  };

  const continuePreviousPath = useMutation({
    mutationFn: async (input: { prevPathId: string; prevPathDate: string }): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { data: todayRow, error: e0 } = await supabase
        .from("paths")
        .upsert(
          { user_id: userId, path_date: todayISO(), origin_label: null, origin_lat: null, origin_lng: null },
          { onConflict: "user_id,path_date" },
        )
        .select("id").single();
      if (e0) throw e0;
      const todayId = (todayRow as unknown as { id: string }).id;
      const { data: pend, error: e1 } = await supabase
        .from("path_stops").select("id")
        .eq("path_id", input.prevPathId).eq("status", "pending")
        .order("position", { ascending: true });
      if (e1) throw e1;
      const pendingIds = ((pend ?? []) as { id: string }[]).map((r) => r.id);
      // Reparent the old path's pending stops onto today. SAFE because the
      // ResumePathCard that triggers this is only rendered on the empty entry
      // view (no today stops), so no (path_id, prospect_id) collision is
      // possible and each update is idempotent / retry-safe. If a caller ever
      // invokes this with a non-empty today path, switch to an upsert with
      // onConflict:"path_id,prospect_id" + a delete of the old pending rows.
      if (pendingIds.length > 0) {
        // Single bulk reparent — NOT a per-stop loop (that was ~N sequential
        // round-trips and left the UI disabled for seconds on a big path).
        // Positions are advisory; the stops keep their existing relative order.
        const { error } = await supabase
          .from("path_stops").update({ path_id: todayId }).in("id", pendingIds);
        if (error) throw error;
      }
      const { error: e2 } = await supabase.from("paths").update({ status: "completed" }).eq("id", input.prevPathId);
      if (e2) throw e2;
      await finalizeOlderThan(input.prevPathDate);
    },
    onSuccess: invalidate,
  });

  const carryToTomorrow = useMutation({
    mutationFn: async (input: { pathId: string; pathDate: string }): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const tomorrow = addDaysISO(input.pathDate, 1);
      const { data: toRow, error: e0 } = await supabase
        .from("paths")
        .upsert(
          { user_id: userId, path_date: tomorrow, origin_label: null, origin_lat: null, origin_lng: null },
          { onConflict: "user_id,path_date" },
        )
        .select("id").single();
      if (e0) throw e0;
      const toId = (toRow as unknown as { id: string }).id;
      const { data: pend, error: e1 } = await supabase
        .from("path_stops").select("id")
        .eq("path_id", input.pathId).eq("status", "pending")
        .order("position", { ascending: true });
      if (e1) throw e1;
      const pendingIds = ((pend ?? []) as { id: string }[]).map((r) => r.id);
      // Reparent today's pending stops onto tomorrow's (normally empty) path.
      // Same precondition as continuePreviousPath: no (path_id, prospect_id)
      // collision since tomorrow's path is typically empty.
      if (pendingIds.length > 0) {
        const { error } = await supabase.from("path_stops").update({ path_id: toId }).in("id", pendingIds);
        if (error) throw error;
      }
      const { error: e2 } = await supabase.from("paths").update({ status: "completed" }).eq("id", input.pathId);
      if (e2) throw e2;
    },
    onSuccess: invalidate,
  });

  // Finalize THIS path now: skip its pending stops + mark it completed. Wraps the
  // finalizeSingle helper so the End-route "Mark route complete" action gets
  // mutateAsync + isPending + the shared cache invalidation.
  const finalizeCurrentPath = useMutation({
    mutationFn: (pathId: string) => finalizeSingle(pathId),
    onSuccess: invalidate,
  });

  const closePreviousPath = useMutation({
    mutationFn: async (input: { prevPathId: string; prevPathDate: string }): Promise<void> => {
      await finalizeSingle(input.prevPathId);
      await finalizeOlderThan(input.prevPathDate);
    },
    onSuccess: invalidate,
  });

  return { createPath, addStops, removeStop, reorderStops, setStopStatus, setStopDisposition, markDealCreated, deletePath, continuePreviousPath, carryToTomorrow, closePreviousPath, finalizeCurrentPath };
}
