import type { Disposition } from "@/lib/followUpScheduling";
import { DISPOSITIONS } from "@/lib/followUpScheduling";

interface RepLabel { label: string; subtitle: string; }

/** Rep-facing tile copy for the field drop-in outcomes (the product's "Desired
 *  Outcome set"). Reports keep the formal DISPOSITIONS.label; these are the
 *  words the rep sees on the Path drop-in tiles. Intervals are intentionally
 *  absent from every subtitle. Keyed by the underlying disposition. */
export const REP_OUTCOME_LABELS: Partial<Record<Disposition, RepLabel>> = {
  statement_secured: { label: "Got their statement", subtitle: "Walked out with a statement" },
  met_dm: { label: "Met with decision maker", subtitle: "Talked to the owner" },
  scheduled_callback: { label: "Asked me to come back", subtitle: "He named a time" },
  gatekeeper: { label: "Spoke with gatekeeper", subtitle: "Talked to staff, owner not available" },
  left_collateral: { label: "Left materials", subtitle: "Dropped off info, nobody to talk to" },
  not_in_office: { label: "Closed right now", subtitle: "Wrong time of day, try again" },
  closed_locked: { label: "Not now", subtitle: "Locked in a contract or not ready" },
  do_not_contact: { label: "Do not contact", subtitle: "Told me not to come back" },
  out_of_business: { label: "Out of business", subtitle: "Gone for good" },
};

/** Rep label for a disposition; formal DISPOSITIONS label for anything unmapped. */
export const repOutcomeLabel = (d: Disposition): string =>
  REP_OUTCOME_LABELS[d]?.label ?? DISPOSITIONS[d].label;

/** Rep subtitle for a disposition; DISPOSITIONS rationale for anything unmapped. */
export const repOutcomeSubtitle = (d: Disposition): string =>
  REP_OUTCOME_LABELS[d]?.subtitle ?? DISPOSITIONS[d].rationale;
