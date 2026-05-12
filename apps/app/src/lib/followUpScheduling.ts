/**
 * Smart follow-up scheduling — the navigatr differentiator made code.
 *
 * Every activity disposition determines the optimal next-touch window.
 * The product surfaces this to the rep automatically so they don't have
 * to remember the rules, and supervisors can trust the cadence is
 * consistent across the org.
 *
 * Source of truth: PRD § Smart Follow-up Scheduling.
 *
 * IMPORTANT — business days only. We skip Sat/Sun via date-fns. Future
 * iterations (Sprint 2+) will add per-tenant holiday calendars and per-
 * rep working hours. For now, weekdays.
 */

import { addBusinessDays } from "date-fns";

export type Disposition =
  | "statement_secured"
  | "positive_engagement"
  | "connected_with_dm"
  | "dm_unavailable"
  | "followup_requested"
  | "future_potential"
  | "low_probability"
  | "not_interested"
  | "wrong_number"
  | "closed_lost";

export interface DispositionSpec {
  /** Canonical disposition slug — used as the schema enum value. */
  key: Disposition;
  /** Human-readable label shown to the rep on the disposition tile. */
  label: string;
  /** Short rationale shown beneath the tile's title. */
  rationale: string;
  /** Tier drives the tile's accent band + smart-followup chip color. */
  tier: "positive" | "neutral" | "negative" | "cool";
  /**
   * Business days from today to schedule the next touch.
   * `null` = no follow-up scheduled (terminal outcomes + manual-pick cases).
   */
  businessDays: number | null;
}

export const DISPOSITIONS: Record<Disposition, DispositionSpec> = {
  statement_secured: {
    key: "statement_secured",
    label: "Statement Secured",
    rationale: "Highest urgency · 1 day follow-up",
    tier: "positive",
    businessDays: 1,
  },
  positive_engagement: {
    key: "positive_engagement",
    label: "Positive Engagement",
    rationale: "Warm signal · 3 day follow-up",
    tier: "positive",
    businessDays: 3,
  },
  connected_with_dm: {
    key: "connected_with_dm",
    label: "Connected with DM",
    rationale: "Spoke with decision-maker · 7 day follow-up",
    tier: "positive",
    businessDays: 7,
  },
  dm_unavailable: {
    key: "dm_unavailable",
    label: "Decision Maker Unavailable",
    rationale: "Try again · 3 day follow-up",
    tier: "neutral",
    businessDays: 3,
  },
  followup_requested: {
    key: "followup_requested",
    label: "Follow-up Requested",
    rationale: "Prospect picked a time · manual date",
    tier: "neutral",
    // null = rep picks a date manually. Sprint 1 keeps this out of the
    // active UI; the spec stays so Sprint 2 can wire the manual picker.
    businessDays: null,
  },
  future_potential: {
    key: "future_potential",
    label: "Future Potential",
    rationale: "Long-term play · 30 day follow-up",
    tier: "cool",
    businessDays: 30,
  },
  low_probability: {
    key: "low_probability",
    label: "Low Probability",
    rationale: "Worth one more shot · 15 day follow-up",
    tier: "cool",
    businessDays: 15,
  },
  not_interested: {
    key: "not_interested",
    label: "Not Interested",
    rationale: "Closed out · no follow-up",
    tier: "negative",
    businessDays: null,
  },
  wrong_number: {
    key: "wrong_number",
    label: "Wrong Number",
    rationale: "Bad contact data · no follow-up",
    tier: "negative",
    businessDays: null,
  },
  closed_lost: {
    key: "closed_lost",
    label: "Closed Lost",
    rationale: "Deal lost · no follow-up",
    tier: "negative",
    businessDays: null,
  },
};

/**
 * Compute the next-touch date for a given disposition.
 *
 * @returns ISO date string at start-of-day UTC, or null when the
 *          disposition is terminal / manual-pick.
 *
 * Expected outputs (relative to a Wednesday `from`):
 *   statement_secured    → Wed + 1bd  = Thu
 *   positive_engagement  → Wed + 3bd  = Mon (next week, skips Sat/Sun)
 *   connected_with_dm    → Wed + 7bd  = Fri (next week)
 *   dm_unavailable       → Wed + 3bd  = Mon
 *   followup_requested   → null
 *   future_potential     → Wed + 30bd
 *   low_probability      → Wed + 15bd
 *   not_interested       → null
 *   wrong_number         → null
 *   closed_lost          → null
 */
export function calculateFollowUpDate(
  disposition: Disposition,
  from: Date = new Date(),
): string | null {
  const spec = DISPOSITIONS[disposition];
  if (spec.businessDays === null) return null;
  const next = addBusinessDays(from, spec.businessDays);
  // Normalize to start-of-day UTC so client tz doesn't drift the date.
  next.setUTCHours(0, 0, 0, 0);
  return next.toISOString();
}

/** Pretty short-form for toasts and chips: "Mon, May 18". */
export function formatFollowUpDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
