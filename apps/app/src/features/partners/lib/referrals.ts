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

/** Decline reasons for a public form submission: no partner can have withdrawn it. */
export const SUBMISSION_DECLINE_REASON_OPTIONS = DECLINE_REASON_OPTIONS.filter(
  (o) => o.value !== "withdrawn_by_partner",
);

/**
 * Where a public form submission came from (queue and review sheet). A personal
 * link says "your" only when the viewer holds it, so a manager looking at a
 * rep's submission is not told it came through their own form.
 */
export function formSubmissionSourceLabel(linkType: "user" | "tenant", assignedToViewer: boolean): string {
  if (linkType === "tenant") return "From the company form";
  return assignedToViewer ? "From your referral form" : "From a rep's referral form";
}

/** What a merge did (merge_referral / merge_referral_override, 20261027000003). */
export interface MergeResult {
  result: "merged" | "closed_duplicate";
  /** Only set when the rep can see the partner who keeps credit. */
  creditedPartnerName: string | null;
}

/** The toast after a merge. Names the partner who keeps credit only when the server gave a name. */
export function mergeResultMessage(res: MergeResult): string {
  if (res.result !== "closed_duplicate") return "Merged into the existing deal";
  const who = res.creditedPartnerName?.trim() || "Another partner";
  return `Closed as a duplicate. ${who} keeps credit for that deal.`;
}

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
  ["override_reason_required", "Add a short reason to go ahead with a possible duplicate."],
  ["update_required", "Write the update first."],
  ["update_too_long", "Keep the update under 1,000 characters."],
  ["note_too_long", "Keep the note under 1,000 characters."],
  ["partner_message_too_long", "Keep the message to the partner under 1,000 characters."],
  ["referral_not_reinstatable", "This referral can't be reinstated now."],
  ["submission_not_found", "That referral no longer exists."],
  ["submission_handled", "This referral was already handled."],
  ["invalid_reason", "Pick a reason."],
  ["portal_disabled", "Turn on the partner portal first."],
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

/**
 * Who may reassign a referral: the same gate as reassign_referral (a manager or
 * admin role, or the administrator level). The server re-checks; this only
 * decides whether to show the action.
 */
export function canReassignReferrals(
  profile: { role?: string | null; role_level?: string | null } | null | undefined,
): boolean {
  if (!profile) return false;
  return profile.role === "manager" || profile.role === "admin" || profile.role_level === "administrator";
}

/** Advisory ICP lines for triage (FR-PORT-58). Unknown flags are dropped. */
export function icpFlagLabels(flags: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const flag of flags ?? []) {
    if (!flag.startsWith("chain:")) continue;
    // The sheet adds ". Check before accepting.", so drop a trailing period here.
    const brand = flag.slice("chain:".length).trim().replace(/\.+$/, "").trim();
    if (brand) out.push(`Looks like a chain: ${brand}`);
  }
  return out;
}
