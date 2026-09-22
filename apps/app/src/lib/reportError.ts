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
   * Stable label for WHAT failed, e.g. "auth.reset-password-request". Sent as a
   * Sentry TAG, not extra: tags are indexed, so this is what an alert rule can
   * actually key on ("notify me when action starts with auth."). Extra is not
   * filterable, which is the whole reason this is a tag.
   */
  action: string;
  /** Shown to the user when the caught value carries no readable message. */
  fallback: string;
  /**
   * Show this exact copy instead of deriving it from the error. For callers
   * whose thrown value is a Supabase error OBJECT (not an Error instance), so
   * the user keeps seeing the real message rather than the generic fallback.
   */
  message?: string;
  /** Extra context for the Sentry event. Never put tokens or secrets here. */
  extra?: Record<string, unknown>;
}

export function reportError(err: unknown, options: ReportErrorOptions): void {
  // Same message the user saw before this helper existed, so adding
  // observability changes nothing about the experience.
  toast.error(options.message ?? (err instanceof Error ? err.message : options.fallback));
  // action goes in TAGS and caller context goes in EXTRA: separate namespaces,
  // so a caller passing extra.action cannot clobber the grouping tag.
  captureException(err, options.extra, { action: options.action });
}
