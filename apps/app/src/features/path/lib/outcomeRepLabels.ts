import type { Disposition } from "@/lib/followUpScheduling";
import { DISPOSITIONS } from "@/lib/followUpScheduling";

interface RepLabel { label: string; subtitle: string; }

/** spec 6.2. Rep-facing only, logging surfaces. Reports keep DISPOSITIONS.label.
 *  Covers ONLY the ten drop-in outcomes; everything else falls back below.
 *  Intervals are intentionally absent from every subtitle. */
export const REP_OUTCOME_LABELS: Partial<Record<Disposition, RepLabel>> = {
  statement_secured: { label: "Got statements", subtitle: "Best case" },
  positive_engagement: { label: "Good conversation", subtitle: "Warm" },
  connected_with_dm: { label: "Met the owner", subtitle: "Introduced" },
  dm_unavailable: { label: "Owner not in", subtitle: "Try again" },
  followup_requested: { label: "They asked me back", subtitle: "Pick a date" },
  future_potential: { label: "Long shot", subtitle: "Check in later" },
  low_probability: { label: "Not likely", subtitle: "Cool for now" },
  wrong_number: { label: "Wrong place", subtitle: "No follow-up" },
  not_interested: { label: "Not interested", subtitle: "No follow-up" },
  closed_lost: { label: "Dead", subtitle: "No follow-up" },
};

/** Rep label for a disposition; formal DISPOSITIONS label for anything unmapped. */
export const repOutcomeLabel = (d: Disposition): string =>
  REP_OUTCOME_LABELS[d]?.label ?? DISPOSITIONS[d].label;

/** Rep subtitle for a disposition; DISPOSITIONS rationale for anything unmapped. */
export const repOutcomeSubtitle = (d: Disposition): string =>
  REP_OUTCOME_LABELS[d]?.subtitle ?? DISPOSITIONS[d].rationale;
