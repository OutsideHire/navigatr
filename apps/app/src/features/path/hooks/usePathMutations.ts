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

  return { createPath, addStops, removeStop, reorderStops, setStopStatus, setStopDisposition, markDealCreated, deletePath };
}
