/**
 * useAttachPlaceToDeal — backfill a resolved Google Place onto an EXISTING deal
 * instead of creating a duplicate (Add-Deal-via-Places slice D, FR-ADD-DUP-03).
 *
 * When a rep searches a business that turns out to already be in the pipeline as
 * a legacy record with no place_id, "Attach" enriches that record: it writes the
 * place_id, formatted address, coordinates, industry, and place_synced_at so the
 * existing deal becomes routable and de-dup-anchored. No new deal is created.
 *
 * Only the missing/enrichable fields are written; we never overwrite an address
 * or industry the rep already curated with a blank. place_id is set only when
 * the deal has none (the attach precondition), so this can't collide with the
 * active-place_id unique index for a different business.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/stores/auth";
import { DEALS_QUERY_KEY } from "./useDeals";
import type { ResolvedPlace } from "./placeResolverTypes";

export interface AttachPlaceInput {
  dealId: string;
  place: ResolvedPlace;
}

export function useAttachPlaceToDeal() {
  const queryClient = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  return useMutation({
    mutationFn: async ({ dealId, place }: AttachPlaceInput): Promise<{ id: string }> => {
      if (!userId) throw new Error("Not signed in");

      // Build a sparse patch: place_id + sync stamp always; address / coords /
      // industry only when Google supplied a value (never clobber with null).
      const patch: Record<string, unknown> = {
        place_id: place.placeId,
        place_synced_at: new Date().toISOString(),
      };
      if (place.formattedAddress) patch.address = place.formattedAddress;
      if (place.lat != null) patch.lat = place.lat;
      if (place.lng != null) patch.lng = place.lng;
      if (place.industry) patch.industry = place.industry;

      const { data, error } = await supabase
        .from("deals")
        .update(patch)
        .eq("id", dealId)
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id as string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY(userId) });
    },
  });
}
