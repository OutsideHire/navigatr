import { DISPOSITIONS, type Disposition } from "@/lib/followUpScheduling";
import type { DispositionMetaTone, DispositionTier } from "@/components/navigatr/DispositionTile";

/**
 * The follow-up-timing line shown on each Path drop-in outcome tile.
 *
 * Outcomes drive all future follow-up, so each tile states plainly what it
 * schedules: a fixed N-business-day interval, "You pick the date" for the one
 * outcome the rep sets themselves (scheduled_callback / "Asked me to come
 * back"), or "No follow-up" for the two terminal outcomes. The tone drives the
 * tile's timing color + icon (see DispositionTile.META_TONE).
 */
export interface OutcomeFollowUpMeta {
  label: string;
  tone: DispositionMetaTone;
}

/** Fixed-interval outcomes take their timing color from the outcome's tier. */
const TIER_TONE: Record<DispositionTier, DispositionMetaTone> = {
  positive: "success",
  neutral: "warning",
  negative: "danger",
  cool: "accent",
};

export function outcomeFollowUpMeta(d: Disposition): OutcomeFollowUpMeta {
  // The owner named a time, so the rep sets the exact date (the sheet reveals a
  // picker). Surface that instead of the 2-day fallback interval underneath.
  if (d === "scheduled_callback") return { label: "You pick the date", tone: "accent" };
  const spec = DISPOSITIONS[d];
  if (spec.businessDays == null) return { label: "No follow-up", tone: "muted" };
  return { label: `${spec.businessDays}-day follow-up`, tone: TIER_TONE[spec.tier] };
}
