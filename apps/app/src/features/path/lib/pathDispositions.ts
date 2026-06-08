import { schedulesFollowUp, type Disposition } from "@/lib/followUpScheduling";

/** Display order for the drop-in tile grid (matches the field-rep screenshot). */
export const PATH_DISPOSITION_KEYS: Disposition[] = [
  "statement_secured",
  "positive_engagement",
  "connected_with_dm",
  "dm_unavailable",
  "followup_requested",
  "future_potential",
  "low_probability",
  "wrong_number",
  "not_interested",
  "closed_lost",
];

/** True when this outcome should create a Pipeline deal + scheduled follow-up.
 *  Rule: any disposition that schedules a follow-up. (Kept under the original
 *  name so DropInSheet's import is unchanged.) */
export function isEngagedDisposition(d: Disposition): boolean {
  return schedulesFollowUp(d);
}
