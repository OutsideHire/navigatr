/**
 * reportError: show the user a failure AND tell Sentry about it.
 *
 * Sentry only sees UNHANDLED errors. Every place we catch an error and show a
 * friendly toast (good for the user) makes that failure invisible to us. When
 * this was written the app had 106 `toast.error` sites and 4 Sentry reports,
 * so roughly a hundred ways for a rep to hit a wall in silence.
 *
 * That gap has cost us for real: on 2026-09-22 a beta customer could not reset
 * his password for a week because Supabase Auth's project-wide email rate limit
 * was still at its default of 2/hour. He saw an error toast. We saw nothing, in
 * Sentry or anywhere else, until he complained. See [[auth-email-rate-limit]].
 *
 * USE THIS FOR A CAUGHT EXCEPTION. Do NOT use it for input validation the user
 * can fix ("enter a valid email", "missing invite token"). Those are expected,
 * are not a system failure, and reporting them would recreate the noise problem
 * the Sentry filter was built to solve.
 *
 * Callers need no guards: captureException already no-ops when Sentry is not
 * initialised, drops authz-working-as-designed and transient network failures,
 * and normalises a raw Supabase error object into something readable.
 */
import { toast } from "sonner";
import { captureException } from "./observability";

export interface ReportErrorOptions {
  /**
   * Stable label for WHAT failed, e.g. "auth.reset-password-request". Attached
   * to the Sentry event so related failures group and can be alerted on.
   */
  action: string;
  /** Shown to the user when the caught value carries no readable message. */
  fallback: string;
  /** Extra context for the Sentry event. Never put tokens or secrets here. */
  extra?: Record<string, unknown>;
}

export function reportError(err: unknown, options: ReportErrorOptions): void {
  // Same message the user saw before this helper existed, so adding
  // observability changes nothing about the experience.
  toast.error(err instanceof Error ? err.message : options.fallback);
  captureException(err, { action: options.action, ...(options.extra ?? {}) });
}
