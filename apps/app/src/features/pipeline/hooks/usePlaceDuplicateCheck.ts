/**
 * usePlaceDuplicateCheck — tiered "is this business already in the pipeline?"
 * lookup for the Add-Deal-via-Places sheet (slice D).
 *
 * Calls find_place_duplicate_candidates (migration 20260808000004), which
 * returns active deals in the caller's org that relate to the business being
 * added, strongest tier first. We take the strongest (rows[0]) and hand it to
 * planInterstitial. Advisory only: a lookup error resolves to null so a
 * transient failure never blocks a legitimate add — the hard-block trigger is
 * still the guarantee on submit.
 */
import * as React from "react";
import { supabase } from "@/lib/supabase";
import type { DuplicateTier } from "../lib/placeDedupe";
import type { PlaceDuplicateMatch } from "../lib/placeInterstitial";

interface CandidateInput {
  placeId: string | null;
  name: string;
  phone: string | null;
  address: string | null;
}

interface DuplicateRpcRow {
  id: string;
  company_name: string;
  stage: string;
  owner_id: string | null;
  place_id: string | null;
  match_tier: DuplicateTier;
}

export function usePlaceDuplicateCheck(): {
  checkPlaceDuplicate: (candidate: CandidateInput) => Promise<PlaceDuplicateMatch | null>;
} {
  const checkPlaceDuplicate = React.useCallback(
    async (candidate: CandidateInput): Promise<PlaceDuplicateMatch | null> => {
      // Nothing keyable -> the guards won't fire, so skip the round-trip.
      if (!candidate.name?.trim()) return null;
      const { data, error } = await supabase.rpc("find_place_duplicate_candidates", {
        p_place_id: candidate.placeId,
        p_name: candidate.name,
        p_phone: candidate.phone,
        p_address: candidate.address,
      });
      if (error) return null; // advisory only
      const row = ((data ?? []) as unknown as DuplicateRpcRow[])[0];
      if (!row) return null;
      return {
        tier: row.match_tier,
        dealId: row.id,
        companyName: row.company_name,
        dealHasPlaceId: !!row.place_id,
      };
    },
    [],
  );
  return { checkPlaceDuplicate };
}
