/**
 * dispositionSets — which outcome options each activity type offers.
 *
 * Call/Appointment/Email use the call-centric disposition set; Drop-in uses
 * the field-visit set (met_dm, gatekeeper, …). The Disposition enum + DB enum
 * already carry every value here; this only governs which are *shown* per type.
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

export interface DispositionSet {
  /** Shown by default (the "top" tiles). */
  top: Disposition[];
  /** Shown after "show all". */
  all: Disposition[];
}

export const DISPOSITIONS_BY_TYPE: Record<ActivityType, DispositionSet> = {
  call: { top: CALL_TOP, all: CALL_ALL },
  appointment: { top: CALL_TOP, all: CALL_ALL },
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
] as const;
