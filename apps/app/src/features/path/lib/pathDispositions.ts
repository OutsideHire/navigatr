/**
 * pathDispositions — the field drop-in disposition picker config.
 *
 * Ordered list of the 10 tiles shown in DropInSheet (labels + tiers come from
 * the shared DISPOSITIONS map so there's one source of truth), plus the
 * engaged-set predicate that decides which outcomes create a Pipeline deal.
 *
 * Engaged = the rep made contact worth a follow-up (met the DM, spoke to a
 * gatekeeper, left collateral, or booked a callback). Everything else records
 * the visit without seeding Pipeline.
 */
import type { Disposition } from "@/lib/followUpScheduling";

/** Display order for the drop-in tile grid (matches the field-rep mockup). */
export const PATH_DISPOSITION_KEYS: Disposition[] = [
  "met_dm",
  "gatekeeper",
  "left_collateral",
  "scheduled_callback",
  "not_in_office",
  "closed_locked",
  "not_interested",
  "do_not_contact",
  "out_of_business",
  "other",
];

const ENGAGED: ReadonlySet<Disposition> = new Set<Disposition>([
  "met_dm",
  "gatekeeper",
  "left_collateral",
  "scheduled_callback",
]);

/** True when this outcome should create a Pipeline deal + scheduled follow-up. */
export function isEngagedDisposition(d: Disposition): boolean {
  return ENGAGED.has(d);
}
