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

const CALL_TOP: Disposition[] = [
  "statement_secured",
  "positive_engagement",
  "dm_unavailable",
  "not_interested",
];

const CALL_ALL: Disposition[] = [
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
];

const DROPIN_TOP: Disposition[] = [
  "met_dm",
  "gatekeeper",
  "left_collateral",
  "not_in_office",
];

const DROPIN_ALL: Disposition[] = [
  "met_dm",
  "gatekeeper",
  "left_collateral",
  "not_in_office",
  "scheduled_callback",
  "closed_locked",
  "do_not_contact",
  "out_of_business",
  "other",
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
  email: { top: CALL_TOP, all: CALL_ALL },
  drop_in: { top: DROPIN_TOP, all: DROPIN_ALL },
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
