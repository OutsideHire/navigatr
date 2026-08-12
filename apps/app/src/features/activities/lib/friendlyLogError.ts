/**
 * friendlyLogError. Turn a failed activity-log into a message a rep can act on.
 *
 * The common cause is a task whose deal is no longer in the rep's workspace
 * (removed, or stale/foreign sample data): the insert is rejected by the deal
 * foreign key (Postgres 23503) or the org row-level-security check (42501). The
 * client already hides "Log activity" for those rows, but a deal removed mid-
 * session can still race to here, so map those failures to a clear explanation
 * instead of a generic "could not log". Real Error messages (e.g. "Not signed
 * in") pass through; anything unrecognized falls back to the generic line.
 */

const DEAL_UNAVAILABLE =
  "This task is linked to a deal that's no longer in your workspace (it may be old sample data). Dismiss the task, or refresh and try again.";

export function friendlyLogError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null | undefined;
  const code = e?.code;
  const message = e?.message ?? "";
  // FK to a missing deal, RLS/org denial, or an org-mismatch trigger message.
  if (
    code === "23503" ||
    code === "42501" ||
    /row-level security|violates foreign key|org_id|different org/i.test(message)
  ) {
    return DEAL_UNAVAILABLE;
  }
  if (err instanceof Error && err.message) return err.message;
  return "Could not log activity";
}
