/**
 * Referral vocabulary for the in-app (rep-facing) surfaces. Partner-facing
 * labels (Received, In Progress, Not Moving Forward) are a Phase 1 portal
 * concern and must never be mixed in here.
 */
import type { BadgeKind } from "@/components/navigatr/Badge";

export type ReferralStatus =
  | "submitted" | "accepted" | "working" | "won" | "lost" | "declined" | "withdrawn";
export type ReferralDirection = "inbound" | "outbound";
export type DeclineReason =
  | "duplicate" | "outside_footprint" | "outside_icp" | "insufficient_contact"
  | "existing_customer" | "withdrawn_by_partner";

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  submitted: "Submitted",
  accepted: "Accepted",
  working: "Working",
  won: "Won",
  lost: "Lost",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export const REFERRAL_STATUS_BADGE: Record<ReferralStatus, BadgeKind> = {
  submitted: "status-due-soon",
  accepted: "stage-new",
  working: "stage-contacted",
  won: "stage-won",
  lost: "priority-low",
  declined: "priority-low",
  withdrawn: "priority-low",
};

export const DECLINE_REASON_OPTIONS: Array<{ value: DeclineReason; label: string }> = [
  { value: "duplicate", label: "Duplicate of an existing opportunity" },
  { value: "outside_footprint", label: "Outside our service area" },
  { value: "outside_icp", label: "Not a fit for us" },
  { value: "insufficient_contact", label: "Not enough contact info" },
  { value: "existing_customer", label: "Already a customer" },
  { value: "withdrawn_by_partner", label: "Partner withdrew it" },
];

export function isLiveLink(status: ReferralStatus): boolean {
  return status !== "declined" && status !== "withdrawn";
}

const ERROR_COPY: Array<[token: string, copy: string]> = [
  ["referral_not_submitted", "This referral was already handled."],
  ["referral_closed", "This referral is already closed."],
  ["referral_not_found", "That referral no longer exists."],
  ["already_linked", "That deal is already linked to this partner."],
  ["deal_not_visible", "You can't see that deal."],
  ["partner_not_visible", "You can't see that partner."],
  ["assignee_invalid", "That teammate can't take this referral."],
  ["company_required", "Add the business name."],
  ["invalid_direction", "That link could not be removed."],
  ["not_authorized", "You don't have access to do that."],
];

export function referralErrorMessage(err: unknown, fallback: string): string {
  const message =
    err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
      ? (err as { message: string }).message
      : "";
  const hit = ERROR_COPY.find(([token]) => message.includes(token));
  return hit ? hit[1] : fallback;
}
