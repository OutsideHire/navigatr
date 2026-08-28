import { schedulesFollowUp, type Disposition } from "@/lib/followUpScheduling";

/**
 * The field drop-in outcomes and their display order, per the product's
 * "Desired Outcome set". These are the real field-visit dispositions (not the
 * generic call/activity list the tiles were mistakenly wired to before). Their
 * tiers already map to the intended tile colors: positive = Green,
 * neutral = Amber, negative = Red.
 */
export const PATH_DISPOSITION_KEYS: Disposition[] = [
  "statement_secured", // Got their statement
  "met_dm", // Met with decision maker
  "scheduled_callback", // Asked me to come back (rep picks the date)
  "gatekeeper", // Spoke with gatekeeper
  "left_collateral", // Left materials
  "not_in_office", // Closed right now
  "closed_locked", // Not now
  "do_not_contact", // Do not contact
  "out_of_business", // Out of business
];

/** True when this outcome should create a Pipeline deal + scheduled follow-up.
 *  Rule: any disposition that schedules a follow-up. (Kept under the original
 *  name so DropInSheet's import is unchanged.) */
export function isEngagedDisposition(d: Disposition): boolean {
  return schedulesFollowUp(d);
}
