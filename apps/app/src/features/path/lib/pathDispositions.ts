import { schedulesFollowUp, type Disposition } from "@/lib/followUpScheduling";
import { DISPOSITIONS_BY_TYPE } from "@/features/activities/lib/dispositionSets";

/**
 * The field drop-in outcomes and their display order. RE-EXPORTED from the single
 * source of truth (dispositionSets.drop_in) so every drop-in surface renders the
 * identical set: the nearby-card sheet (DropInSheet, which imports this) and the
 * Path stop logger + Activities logger (LogActivitySheet, which reads
 * dispositionSets directly). Keeping one list is what stops the two from drifting
 * apart again. See the DROPIN note in dispositionSets.ts for the history. Tiers
 * map to the tile colors: positive = Green, neutral = Amber, negative = Red.
 */
export const PATH_DISPOSITION_KEYS: Disposition[] = DISPOSITIONS_BY_TYPE.drop_in.all;

/** True when this outcome should create a Pipeline deal + scheduled follow-up.
 *  Rule: any disposition that schedules a follow-up. (Kept under the original
 *  name so DropInSheet's import is unchanged.) */
export function isEngagedDisposition(d: Disposition): boolean {
  return schedulesFollowUp(d);
}
