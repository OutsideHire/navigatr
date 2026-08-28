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
import type { DealStage } from "@/features/pipeline/mockData";

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
  | "other"
  // Call set (SP2). no_answer/voicemail close the "85% of dials" gap.
  | "no_answer"
  | "voicemail"
  | "callback"
  | "verbal_commitment"
  | "send_info"
  | "pending_decision"
  | "bad_number"
  | "do_not_call"
  // Email set (SP2).
  | "sent_pricing"
  | "sent_application"
  | "reply_received"
  | "no_reply"
  | "introduction_sent"
  | "sent_information"
  | "declined_by_email"
  | "bad_address"
  | "unsubscribed"
  // Appointment outcomes (W2a-2). Prefixed appt_ so they never collide with
  // the call/drop-in dispositions above.
  | "appt_presented_awaiting"
  | "appt_statements_collected"
  | "appt_verbal_commitment"
  | "appt_no_show"
  | "appt_rescheduled"
  | "appt_application_signed"
  | "appt_dm_unavailable"
  | "appt_cancelled_by_merchant"
  | "appt_not_interested";

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
  // ── Call set (SP2) ──
  bad_number: {
    key: "bad_number",
    label: "Bad number",
    rationale: "Invalid — flags the number.",
    tier: "cool",
    businessDays: null,
  },
  no_answer: {
    key: "no_answer",
    label: "No answer",
    rationale: "Rings out or declined · 1 day.",
    tier: "neutral",
    businessDays: 1,
  },
  voicemail: {
    key: "voicemail",
    label: "Voicemail",
    rationale: "Left a message · 3 days.",
    tier: "neutral",
    businessDays: 3,
  },
  callback: {
    key: "callback",
    label: "Callback",
    rationale: "Promised time — you set the date.",
    tier: "positive",
    businessDays: null, // date is captured (asserted)
  },
  verbal_commitment: {
    key: "verbal_commitment",
    label: "Verbal commitment",
    rationale: "Committed to move forward · 1 day.",
    tier: "positive",
    businessDays: 1,
  },
  send_info: {
    key: "send_info",
    label: "Send info",
    rationale: "Send materials, then follow up · 3 days.",
    tier: "neutral",
    businessDays: 3,
  },
  pending_decision: {
    key: "pending_decision",
    label: "Pending decision",
    rationale: "Committee or corporate · 5 days.",
    tier: "neutral",
    businessDays: 5,
  },
  do_not_call: {
    key: "do_not_call",
    label: "Do not call",
    rationale: "No further contact.",
    tier: "negative",
    businessDays: null,
  },
  // ── Email set (SP2) ──
  sent_pricing: {
    key: "sent_pricing",
    label: "Sent pricing",
    rationale: "Rate sheet out · 3 days.",
    tier: "positive",
    businessDays: 3,
  },
  sent_application: {
    key: "sent_application",
    label: "Sent application",
    rationale: "Out for signature · 2 days.",
    tier: "positive",
    businessDays: 2,
  },
  reply_received: {
    key: "reply_received",
    label: "Reply received",
    rationale: "Merchant responded · 1 day.",
    tier: "positive",
    businessDays: 1,
  },
  no_reply: {
    key: "no_reply",
    label: "No reply",
    rationale: "Chasing silence · 3 days.",
    tier: "neutral",
    businessDays: 3,
  },
  introduction_sent: {
    key: "introduction_sent",
    label: "Introduction sent",
    rationale: "First touch · 5 days.",
    tier: "neutral",
    businessDays: 5,
  },
  sent_information: {
    key: "sent_information",
    label: "Sent information",
    rationale: "Materials out · 5 days.",
    tier: "neutral",
    businessDays: 5,
  },
  declined_by_email: {
    key: "declined_by_email",
    label: "Declined by email",
    rationale: "Merchant passed.",
    tier: "negative",
    businessDays: null,
  },
  bad_address: {
    key: "bad_address",
    label: "Bad address",
    rationale: "Bounced — flags the email.",
    tier: "cool",
    businessDays: null,
  },
  unsubscribed: {
    key: "unsubscribed",
    label: "Unsubscribed",
    rationale: "Opted out of email.",
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
    rationale: "Wrong time of day · 2 day follow-up",
    tier: "neutral",
    businessDays: 2,
  },
  closed_locked: {
    key: "closed_locked",
    label: "Closed / locked",
    rationale: "Locked in or not ready · 30 day follow-up",
    tier: "neutral",
    businessDays: 30,
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
  appt_presented_awaiting: {
    key: "appt_presented_awaiting",
    label: "Presented, awaiting decision",
    rationale: "Pitch made, decision pending · 3 day follow-up",
    tier: "positive",
    businessDays: 3,
  },
  appt_statements_collected: {
    key: "appt_statements_collected",
    label: "Statements collected",
    rationale: "Documents in hand · 1 day follow-up",
    tier: "positive",
    businessDays: 1,
  },
  appt_verbal_commitment: {
    key: "appt_verbal_commitment",
    label: "Verbal commitment",
    rationale: "Verbal yes · 1 day follow-up",
    tier: "positive",
    businessDays: 1,
  },
  appt_no_show: {
    key: "appt_no_show",
    label: "No show",
    rationale: "Merchant missed the appointment · 2 day follow-up",
    tier: "neutral",
    businessDays: 2,
  },
  // Static default: 2 business days. The capture path (W2b-2) overrides this
  // to no follow-up when a future appointment already exists on the deal, so
  // the rep isn't double-scheduled.
  appt_rescheduled: {
    key: "appt_rescheduled",
    label: "Rescheduled on the spot",
    rationale: "New appointment set · 2 day follow-up",
    tier: "neutral",
    businessDays: 2,
  },
  appt_application_signed: {
    key: "appt_application_signed",
    label: "Application signed",
    rationale: "Paperwork signed · 2 day follow-up",
    tier: "positive",
    businessDays: 2,
  },
  appt_dm_unavailable: {
    key: "appt_dm_unavailable",
    label: "Decision maker not available",
    rationale: "Retry · 2 day follow-up",
    tier: "neutral",
    businessDays: 2,
  },
  appt_cancelled_by_merchant: {
    key: "appt_cancelled_by_merchant",
    label: "Cancelled by merchant",
    rationale: "Merchant cancelled · 3 day follow-up",
    tier: "negative",
    businessDays: 3,
  },
  appt_not_interested: {
    key: "appt_not_interested",
    label: "Not interested",
    rationale: "No follow-up",
    tier: "negative",
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

/**
 * Pretty short-form for toasts and chips: "Mon, May 18".
 *
 * A follow-up is a calendar date stored at noon/midnight UTC — render it on its
 * UTC calendar day (`timeZone:'UTC'`) so the toast/chip/Activities row agree
 * with the UTC-based day headings and the notification bell for every viewer.
 * In the viewer's local time it would drift a day (early west of UTC, late at
 * +12). See `lib/calendarDate`.
 */
export function formatFollowUpDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Appointment outcomes that advance the deal stage (addendum 3.3.B.12 2.8).
 *  Only forward advancement; never sets won (closed-won stays merchant boarding). */
export const APPOINTMENT_STAGE_EFFECT: Partial<Record<Disposition, DealStage>> = {
  appt_verbal_commitment: "proposal",
  appt_application_signed: "submitted",
};
