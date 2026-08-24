/**
 * emailConnection — decides whether connecting a calendar should also register
 * the mailbox for Automatic Email Activity Capture (Phase 1).
 *
 * The poll (capture_sent_email) iterates email_connection rows; nothing else
 * creates them. So when a rep connects Outlook AND capture is enabled, the OAuth
 * callback must provision an email_connection row, or the poll has nothing to
 * watch. Pure + unit-tested so that gate lives in one obvious place.
 *
 * Note the provider rename: the calendar provider id is "microsoft", but the
 * email_connection table (and the poll) key on provider = 'outlook'.
 */

export interface EmailConnectionRow {
  org_id: string;
  user_id: string;
  provider: "outlook";
  health: "ok";
  last_error: null;
}

/**
 * The email_connection row to upsert when a calendar connect completes, or null
 * when none should be created (capture disabled, or a non-Outlook provider).
 * Deliberately omits capture_start_date so the table default (now()) anchors it
 * on first connect and a reconnect never rewinds it (upsert only updates the
 * columns present here). Health resets to 'ok' on reconnect, clearing a prior
 * needs_reauth.
 */
export function emailConnectionRowForConnect(params: {
  provider: string;
  orgId: string;
  userId: string;
  emailCaptureEnabled: boolean;
}): EmailConnectionRow | null {
  if (!params.emailCaptureEnabled) return null;
  if (params.provider !== "microsoft") return null;
  return {
    org_id: params.orgId,
    user_id: params.userId,
    provider: "outlook",
    health: "ok",
    last_error: null,
  };
}

/** Whether disconnecting this calendar provider should also drop the mailbox's
 *  email_connection row (so the poll stops and it leaves the health card).
 *  Independent of the capture flag: cleaning up on disconnect is always right. */
export function shouldRemoveEmailConnectionOnDisconnect(provider: string): boolean {
  return provider === "microsoft";
}
