/**
 * useGeocodeDealCoords — geocode an EXISTING deal's street address and stamp
 * lat/lng onto the deal so an owed drop-in on it becomes routable (Path QA
 * B2-ii). Deals with an address but no coordinates otherwise sit in the "No
 * location yet" group and never join the route.
 *
 * Mirrors the geocode-and-stamp already done at deal-create time
 * (useCreateDeal): geocode ONLY when the deal has an address, no coordinates,
 * and no place_id (a place_id deal takes its coords from its originating
 * prospect). The guard is read from the live deal row rather than trusted from
 * the caller, so a stale coord/place_id snapshot can never trigger a needless
 * geocode. Same geocoder edge function (`geocode`), same body shape.
 *
 * Best-effort: a geocode miss or any failure resolves quietly ({ geocoded:
 * false }) and never rejects — the deal simply stays unlocated. On a successful
 * stamp it invalidates the owed / due-today Path bands (and the deals list) so
 * the deal re-reads as routable and leaves the no-location group.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface GeocodeDealCoordsInput {
  dealId: string;
}

interface DealCoordRow {
  address: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
}

export function useGeocodeDealCoords() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ dealId }: GeocodeDealCoordsInput): Promise<{ geocoded: boolean }> => {
      // Read the live guard fields. If the read fails we simply do nothing.
      const { data, error } = await supabase
        .from("deals")
        .select("address, lat, lng, place_id")
        .eq("id", dealId)
        .single();
      if (error || !data) return { geocoded: false };
      const deal = data as unknown as DealCoordRow;

      // Same guard as useCreateDeal: only an addressed, coord-less, place_id-less
      // deal is a geocode candidate.
      if (deal.lat != null || deal.lng != null) return { geocoded: false };
      if (!deal.address || deal.place_id) return { geocoded: false };

      let lat: number | null = null;
      let lng: number | null = null;
      try {
        const { data: geo } = await supabase.functions.invoke<{ result?: { lat: number; lng: number } }>(
          "geocode",
          { body: { query: deal.address } },
        );
        if (geo?.result) {
          lat = geo.result.lat;
          lng = geo.result.lng;
        }
      } catch {
        // swallow — coordinates are optional, the deal stays unlocated
        return { geocoded: false };
      }
      if (lat == null || lng == null) return { geocoded: false };

      const { error: updateErr } = await supabase.from("deals").update({ lat, lng }).eq("id", dealId);
      if (updateErr) return { geocoded: false };

      return { geocoded: true };
    },
    onSuccess: (res) => {
      if (!res.geocoded) return;
      // Prefix keys (exact:false) so every user/pathDate variant re-reads.
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
      void queryClient.invalidateQueries({ queryKey: ["path", "owed-visits"] });
      void queryClient.invalidateQueries({ queryKey: ["path", "due-today-visits"] });
    },
  });
}
