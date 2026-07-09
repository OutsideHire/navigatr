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
import { dateOnlyToNoonUtcIso, toDateOnly } from "./calendarDate";

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
  | "closed_lost"
  // Path field drop-in outcomes (Slice 3)
  | "met_dm"
  | "gatekeeper"
  | "left_collateral"
  | "scheduled_callback"
  | "not_in_office"
  | "closed_locked"
  | "do_not_contact"
  | "out_of_business"
  | "other";

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
    rationale: "Highest urgency. 1 day.",
    tier: "positive",
    businessDays: 1,
  },
  positive_engagement: {
    key: "positive_engagement",
    label: "Positive Engagement",
    rationale: "Warm. 3 days.",
    tier: "positive",
    businessDays: 3,
  },
  connected_with_dm: {
    key: "connected_with_dm",
    label: "Connected with DM",
    rationale: "Relationship. 7 days.",
    tier: "positive",
    businessDays: 7,
  },
  dm_unavailable: {
    key: "dm_unavailable",
    label: "DM Unavailable",
    rationale: "Retry. 3 days.",
    tier: "neutral",
    businessDays: 3,
  },
  followup_requested: {
    key: "followup_requested",
    label: "Follow-Up Requested",
    rationale: "Custom date.",
    tier: "neutral",
    // null = rep picks a date manually. Sprint 1 keeps this out of the
    // active UI; the spec stays so Sprint 2 can wire the manual picker.
    businessDays: null,
  },
  future_potential: {
    key: "future_potential",
    label: "Future Potential",
    rationale: "Long cycle. 30 days.",
    tier: "neutral",
    businessDays: 30,
  },
  low_probability: {
    key: "low_probability",
    label: "Low Probability",
    rationale: "Cool. 15 days.",
    tier: "cool",
    businessDays: 15,
  },
  not_interested: {
    key: "not_interested",
    label: "Not Interested",
    rationale: "No follow-up.",
    tier: "negative",
    businessDays: null,
  },
  wrong_number: {
    key: "wrong_number",
    label: "Wrong Person",
    rationale: "No follow-up.",
    tier: "cool",
    businessDays: null,
  },
  closed_lost: {
    key: "closed_lost",
    label: "Closed Lost",
    rationale: "No follow-up.",
    tier: "negative",
    businessDays: null,
  },
  met_dm: {
    key: "met_dm",
    label: "Met with decision maker",
    rationale: "Strong field signal · 3 day follow-up",
    tier: "positive",
    businessDays: 3,
  },
  gatekeeper: {
    key: "gatekeeper",
    label: "Spoke with gatekeeper",
    rationale: "Made contact · 3 day follow-up",
    tier: "neutral",
    businessDays: 3,
  },
  left_collateral: {
    key: "left_collateral",
    label: "Left collateral",
    rationale: "Dropped materials · 5 day follow-up",
    tier: "neutral",
    businessDays: 5,
  },
  scheduled_callback: {
    key: "scheduled_callback",
    label: "Scheduled callback",
    rationale: "Booked a time · 2 day follow-up",
    tier: "positive",
    businessDays: 2,
  },
  not_in_office: {
    key: "not_in_office",
    label: "Not in office",
    rationale: "No one available · no follow-up",
    tier: "neutral",
    businessDays: null,
  },
  closed_locked: {
    key: "closed_locked",
    label: "Closed / locked",
    rationale: "Location closed · no follow-up",
    tier: "neutral",
    businessDays: null,
  },
  do_not_contact: {
    key: "do_not_contact",
    label: "Do not contact",
    rationale: "Opted out · no follow-up",
    tier: "negative",
    businessDays: null,
  },
  out_of_business: {
    key: "out_of_business",
    label: "Out of business",
    rationale: "Permanently closed · no follow-up",
    tier: "negative",
    businessDays: null,
  },
  other: {
    key: "other",
    label: "Other",
    rationale: "Misc outcome · no follow-up",
    tier: "neutral",
    businessDays: null,
  },
};

/**
 * Compute the next-touch date for a given disposition.
 *
 * @returns ISO instant at NOON UTC of the follow-up's calendar day, or null
 *          when the disposition is terminal / manual-pick. Noon UTC keeps the
 *          day stable whether callers slice it (UTC day) or render it in local
 *          time — see `lib/calendarDate`.
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
  // addBusinessDays operates in local wall-clock, so `next` already lands on
  // the correct local business day (never a weekend). Take that LOCAL calendar
  // day and pin it to noon UTC — flooring to UTC midnight instead would shift
  // the day (and could land on a weekend) for reps west of UTC.
  const next = addBusinessDays(from, spec.businessDays);
  return dateOnlyToNoonUtcIso(toDateOnly(next));
}

/** True when this disposition schedules a follow-up (and thus creates a deal):
 *  any interval disposition, plus followup_requested whose date is rep-picked. */
export function schedulesFollowUp(d: Disposition): boolean {
  return DISPOSITIONS[d].businessDays != null || d === "followup_requested";
}

/** Pretty short-form for toasts and chips: "Mon, May 18". */
export function formatFollowUpDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
