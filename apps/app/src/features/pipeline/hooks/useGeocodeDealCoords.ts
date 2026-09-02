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
 * `force` (an address EDIT via useUpdateDeal) syncs the deal's coords to its
 * NEW address: it re-geocodes an already-located deal, and CLEARS the coords
 * when the address was removed or the new address is unlocatable (a clean
 * geocode miss) so the deal stops pinning at the old spot. A place_id deal is
 * still never touched (its Google coords are authoritative), and a transient
 * geocoder outage keeps the existing coords rather than wiping good data.
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
  /** Re-geocode even when the deal already has coordinates. Used when the rep
   *  EDITS the address (useUpdateDeal), so a moved/corrected address re-places
   *  the deal on Path. A place_id deal is STILL skipped (its coords are the
   *  authoritative Google location), so force never overrides a Places deal. */
  force?: boolean;
}

interface DealCoordRow {
  address: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
}

interface GeocodeResult {
  /** True when a fresh lat/lng was stamped onto the deal. */
  geocoded: boolean;
  /** True when stale coords were CLEARED (address removed or the new address is
   *  unlocatable), so the deal leaves the route. Both outcomes need a re-read. */
  cleared?: boolean;
}

/** Null out a deal's coords so it drops off the map/Path. Returns cleared:true
 *  only when the write actually landed (so onSuccess re-reads on a real change). */
async function clearDealCoords(dealId: string): Promise<GeocodeResult> {
  const { error } = await supabase.from("deals").update({ lat: null, lng: null }).eq("id", dealId);
  return { geocoded: false, cleared: !error };
}

export function useGeocodeDealCoords() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ dealId, force = false }: GeocodeDealCoordsInput): Promise<GeocodeResult> => {
      // Read the live guard fields. If the read fails we simply do nothing.
      const { data, error } = await supabase
        .from("deals")
        .select("address, lat, lng, place_id")
        .eq("id", dealId)
        .single();
      if (error || !data) return { geocoded: false };
      const deal = data as unknown as DealCoordRow;
      const hasCoords = deal.lat != null || deal.lng != null;

      // A place_id deal takes its coords from its originating prospect; never
      // touch it, even on a force address edit.
      if (deal.place_id) return { geocoded: false };

      // No address. A force edit that CLEARED the address drops the now-orphaned
      // coords so the deal leaves the route; otherwise it is a plain no-op.
      if (!deal.address) {
        if (force && hasCoords) return clearDealCoords(dealId);
        return { geocoded: false };
      }

      // Default (non-force): only a coord-less deal is a candidate. `force` (an
      // address edit) lifts this so an already-located deal re-geocodes.
      if (!force && hasCoords) return { geocoded: false };

      // Geocode the current address. A THROW is transient (keep existing coords
      // and retry later); a clean miss (a response with no result) means the
      // address is genuinely unlocatable.
      let lat: number | null = null;
      let lng: number | null = null;
      let threw = false;
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
        threw = true;
      }

      if (lat == null || lng == null) {
        // A force edit to an unlocatable address clears the stale coords so the
        // deal stops pinning at the OLD location; a transient outage keeps them.
        if (force && !threw && hasCoords) return clearDealCoords(dealId);
        return { geocoded: false };
      }

      const { error: updateErr } = await supabase.from("deals").update({ lat, lng }).eq("id", dealId);
      if (updateErr) return { geocoded: false };

      return { geocoded: true };
    },
    onSuccess: (res) => {
      if (!res.geocoded && !res.cleared) return;
      // Prefix keys (exact:false) so every user/pathDate variant re-reads.
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
      void queryClient.invalidateQueries({ queryKey: ["path", "owed-visits"] });
      void queryClient.invalidateQueries({ queryKey: ["path", "due-today-visits"] });
    },
  });
}
