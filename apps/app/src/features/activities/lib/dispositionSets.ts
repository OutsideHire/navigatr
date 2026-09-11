/**
 * dispositionSets — which outcome options each activity type offers.
 *
 * Call/Email use the call-centric disposition set; Drop-in uses the
 * field-visit set (met_dm, gatekeeper, …); Appointment has its own set
 * (appt_*, W2a-2) since a scheduled appointment's outcomes (presented,
 * statements collected, verbal commitment, no show, …) are meaningfully
 * different from a cold call's. The Disposition enum + DB enum already
 * carry every value here; this only governs which are *shown* per type.
 */
import type { ActivityType } from "../mockData";
import type { Disposition } from "@/lib/followUpScheduling";

// SP2: dedicated call set. Primary = one-tap; secondary behind "More".
// wrong_number is the "Bad number" outcome (flags the phone). Closed Lost is
// gone from the grid (Mark-as-lost lives in deal Quick actions).
const CALL_TOP: Disposition[] = [
  "no_answer",
  "voicemail",
  "callback",
  "verbal_commitment",
  "not_interested",
];

const CALL_ALL: Disposition[] = [
  "no_answer",
  "voicemail",
  "callback",
  "verbal_commitment",
  "not_interested",
  "gatekeeper",
  "send_info",
  "pending_decision",
  "bad_number",
  "do_not_call",
];

// SP2: dedicated email set (no longer reuses the call set).
const EMAIL_TOP: Disposition[] = [
  "sent_pricing",
  "sent_application",
  "reply_received",
  "no_reply",
];

const EMAIL_ALL: Disposition[] = [
  "sent_pricing",
  "sent_application",
  "reply_received",
  "no_reply",
  "introduction_sent",
  "sent_information",
  "declined_by_email",
  "bad_address",
  "unsubscribed",
];

// The field drop-in outcomes, in the product's Desired Outcome order. This is the
// SINGLE SOURCE for drop-in outcomes: the Path stop logger (LogActivitySheet) AND
// the nearby-card sheet (DropInSheet, via pathDispositions.PATH_DISPOSITION_KEYS,
// which re-exports this) both read it, so they can never diverge again. That
// divergence is exactly what broke this: an Aug-2026 driving-view redesign pointed
// the stop logger at LogActivitySheet's separate list, and a later outcome fix
// only touched DropInSheet's list. No "other" (drop-ins are a fixed field
// taxonomy), and top == all so a rep sees every option at once with no "show more".
const DROPIN: Disposition[] = [
  "statement_secured",  // Got their statement
  "met_dm",             // Met with decision maker
  "scheduled_callback", // Asked me to come back (rep picks the date)
  "gatekeeper",         // Spoke with gatekeeper
  "left_collateral",    // Left materials
  "not_in_office",      // Closed right now
  "closed_locked",      // Not now
  "do_not_contact",     // Do not contact
  "out_of_business",    // Out of business
];

const APPOINTMENT_TOP: Disposition[] = [
  "appt_presented_awaiting",
  "appt_statements_collected",
  "appt_verbal_commitment",
  "appt_no_show",
  "appt_rescheduled",
];

const APPOINTMENT_ALL: Disposition[] = [
  "appt_presented_awaiting",
  "appt_statements_collected",
  "appt_verbal_commitment",
  "appt_no_show",
  "appt_rescheduled",
  "appt_application_signed",
  "appt_dm_unavailable",
  "appt_cancelled_by_merchant",
  "appt_not_interested",
];

export interface DispositionSet {
  /** Shown by default (the "top" tiles). */
  top: Disposition[];
  /** Shown after "show all". */
  all: Disposition[];
}

export const DISPOSITIONS_BY_TYPE: Record<ActivityType, DispositionSet> = {
  call: { top: CALL_TOP, all: CALL_ALL },
  appointment: { top: APPOINTMENT_TOP, all: APPOINTMENT_ALL },
  email: { top: EMAIL_TOP, all: EMAIL_ALL },
  drop_in: { top: DROPIN, all: DROPIN },
};

/**
 * Every selectable disposition across all types — the source for the zod enum
 * in the Log/Edit sheets. `as const` so z.enum() gets a literal tuple.
 */
export const DISPOSITION_VALUES = [
  "statement_secured",
  "positive_engagement",
  "connected_with_dm",
  "dm_unavailable",
  "followup_requested",
  "future_potential",
  "low_probability",
  "not_interested",
  "wrong_number",
  "closed_lost",
  "met_dm",
  "gatekeeper",
  "left_collateral",
  "not_in_office",
  "scheduled_callback",
  "closed_locked",
  "do_not_contact",
  "out_of_business",
  "other",
  "no_answer",
  "voicemail",
  "callback",
  "verbal_commitment",
  "send_info",
  "pending_decision",
  "bad_number",
  "do_not_call",
  "sent_pricing",
  "sent_application",
  "reply_received",
  "no_reply",
  "introduction_sent",
  "sent_information",
  "declined_by_email",
  "bad_address",
  "unsubscribed",
  "appt_presented_awaiting",
  "appt_statements_collected",
  "appt_verbal_commitment",
  "appt_no_show",
  "appt_rescheduled",
  "appt_application_signed",
  "appt_dm_unavailable",
  "appt_cancelled_by_merchant",
  "appt_not_interested",
] as const;
