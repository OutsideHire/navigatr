/**
 * Partner portal access vocabulary for the in-app partner record (rep-facing).
 * Partner-facing copy lives in features/portal and never mixes with this.
 */
export type PortalUserStatus = "invited" | "active" | "suspended" | "revoked";
export type PortalAccessChange = "suspended" | "revoked" | "invited";

export const PORTAL_STATUS_LABEL: Record<PortalUserStatus, string> = {
  invited: "Invited",
  active: "Active",
  suspended: "Suspended",
  revoked: "Revoked",
};

const ERROR_COPY: Array<[token: string, copy: string]> = [
  ["portal_disabled", "The partner portal is turned off. An admin can turn it on in Settings."],
  ["partner_email_required", "Add an email for this partner first."],
  ["portal_already_active", "This partner already has portal access."],
  ["portal_email_in_use", "Another partner already uses this email for the portal."],
  ["email_failed", "The invite was created but the email didn't send. Try Resend invite."],
  ["invite_failed", "Couldn't create the invite. Try again."],
  ["partner_not_found", "We couldn't find that partner."],
  ["portal_user_not_found", "This partner hasn't been invited yet."],
  ["portal_not_restorable", "This partner's access is already open."],
  ["partner_not_visible", "You don't have access to do that."],
  ["not_authorized", "You don't have access to do that."],
];

export function portalAccessErrorMessage(err: unknown): string {
  const message =
    err !== null && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : "";
  const hit = ERROR_COPY.find(([token]) => message.includes(token));
  return hit ? hit[1] : "Something went wrong. Try again.";
}

/**
 * supabase.functions.invoke reports a non-2xx as an error whose `context` is the
 * raw Response. Read our `{ error: "<token>" }` body out of it.
 */
export async function functionErrorCode(error: unknown, fallback: string): Promise<string> {
  const context =
    error !== null && typeof error === "object" ? (error as { context?: unknown }).context : undefined;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      if (typeof body.error === "string") return body.error;
    } catch {
      // Not JSON; fall through to the generic token.
    }
  }
  return fallback;
}
