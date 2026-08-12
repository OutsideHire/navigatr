/**
 * placeInterstitial — turns a tiered duplicate match into the interstitial the
 * Add-Deal-via-Places sheet should show (slice D). Pure + tested so the copy and
 * the block/soft/second-location decision stay in one place.
 *
 * Modes:
 *   none             no match -> proceed to create
 *   block            same record (place_id / name+address) -> cannot duplicate;
 *                    open the existing deal, or ATTACH (backfill place data onto
 *                    a legacy record that has no place_id yet)
 *   confirm          likely-same (shared phone or name) -> soft; add anyway or
 *                    open the existing
 *   second_location  same base name, different site -> offer to link as a
 *                    sibling (parent_deal_id), add as separate, or open existing
 */

import type { DuplicateTier } from "./placeDedupe";
import { isBlockingTier } from "./placeDedupe";

export type InterstitialMode = "none" | "block" | "confirm" | "second_location";

/** The normalized match the planner reasons over (mirrors the RPC row). */
export interface PlaceDuplicateMatch {
  tier: DuplicateTier;
  dealId: string;
  companyName: string;
  /** Whether the matched existing deal already carries a Google place_id. */
  dealHasPlaceId: boolean;
}

export interface InterstitialPlan {
  mode: InterstitialMode;
  tier: DuplicateTier | null;
  dealId: string | null;
  companyName: string | null;
  /** True only when attaching would enrich a legacy record: a blocking match
   *  whose existing deal has no place_id while the candidate does. */
  canAttach: boolean;
  title: string;
  body: string;
}

const NONE: InterstitialPlan = {
  mode: "none",
  tier: null,
  dealId: null,
  companyName: null,
  canAttach: false,
  title: "",
  body: "",
};

/**
 * Plan the interstitial for a candidate business against its strongest existing
 * match. `candidateHasPlaceId` gates the attach/backfill affordance (only a
 * candidate resolved from Google carries a place_id to backfill with).
 */
export function planInterstitial(
  match: PlaceDuplicateMatch | null,
  candidateHasPlaceId: boolean,
): InterstitialPlan {
  if (!match) return NONE;
  const { tier, dealId, companyName, dealHasPlaceId } = match;

  if (isBlockingTier(tier)) {
    const canAttach = candidateHasPlaceId && !dealHasPlaceId;
    return {
      mode: "block",
      tier,
      dealId,
      companyName,
      canAttach,
      title: `${companyName} is already in your pipeline`,
      body: canAttach
        ? "An active deal for this exact business already exists. Open it, or attach these Google details to that record so it becomes routable."
        : "An active deal for this exact business already exists. Open it instead of adding a duplicate.",
    };
  }

  if (tier === "base_name") {
    return {
      mode: "second_location",
      tier,
      dealId,
      companyName,
      canAttach: false,
      title: "Looks like a second location",
      body: `This shares a name with ${companyName} but sits at a different address. Add it as a second location linked to that deal, or add it as a separate business.`,
    };
  }

  // phone / name -> soft confirm
  return {
    mode: "confirm",
    tier,
    dealId,
    companyName,
    canAttach: false,
    title: "This might already be in your pipeline",
    body:
      tier === "phone"
        ? `${companyName} shares this phone number. Confirm it is a different business before adding, or open the existing deal.`
        : `${companyName} has the same business name. Confirm it is a different location before adding, or open the existing deal.`,
  };
}
