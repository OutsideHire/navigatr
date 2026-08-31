/**
 * errorFilter — decide what reaches Sentry, and make what does readable.
 *
 * Two jobs, both pure + unit-tested:
 *   1. IGNORED_ERROR_PATTERNS: third-party / environmental noise that isn't a
 *      navigatr bug (browser extensions, PWA service-worker update churn, a
 *      stale tab requesting an old chunk after a deploy, transient auth-lock
 *      contention). Fed to Sentry's `ignoreErrors` (substring match).
 *   2. Supabase error handling: a raw PostgREST error is a plain object
 *      { code, message, details, hint }, so Sentry logs it as the useless
 *      "Object captured as exception with keys: code, details, hint, message".
 *      normalizeError() turns it into a readable, groupable Error, and
 *      isExpectedPermissionError() flags the ones that are authz working as
 *      designed (a user asked for something RLS forbids) so they don't page.
 */

/**
 * Environmental / third-party error signatures that add Sentry noise without
 * being navigatr bugs. Matched by substring against the error message, the same
 * mechanism Sentry's `ignoreErrors` uses. Each entry maps to a real production
 * issue seen in Sentry.
 */
export const IGNORED_ERROR_PATTERNS: string[] = [
  // A browser extension injecting into the page. Well-known Sentry noise
  // signature; not our code.
  "Object Not Found Matching Id",
  // PWA service-worker auto-update hiccups. The app keeps working and retries;
  // there is nothing for a user or us to do.
  "newestWorker is null",
  "Failed to update a ServiceWorker",
  "Failed to register a ServiceWorker",
  // A stale browser tab (open across a deploy) requests an old hashed chunk.
  // installChunkReloadHandler already reloads once to recover.
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
  // Transient Supabase auth token-lock contention (multiple tabs / Safari).
  "LockManager lock",
  // Sentry narrating its OWN filtering: when an event we told it to ignore is
  // dropped, the SDK can surface "An event processor returned `null`, will not
  // send event." That is a note about the filter working, not an app error.
  // (Safe today: observability.ts registers no console-capturing integration,
  // so this SDK log is never itself re-captured. If one is ever added, revisit.)
  "An event processor returned",
];

/** The raw PostgREST/Supabase error object shape (not an Error instance). */
export interface SupabaseLikeError {
  code: string;
  message: string;
  details?: unknown;
  hint?: unknown;
}

/** True when `err` is a raw Supabase error object (has code + message and the
 *  details/hint keys PostgREST always includes), and is NOT already an Error. */
export function isSupabaseError(err: unknown): err is SupabaseLikeError {
  if (!err || typeof err !== "object" || err instanceof Error) return false;
  const e = err as Record<string, unknown>;
  return (
    typeof e.message === "string" &&
    typeof e.code === "string" &&
    "details" in e &&
    "hint" in e
  );
}

/**
 * A Supabase error that is authz working as designed: the caller hit one of our
 * RPC gates that raises `forbidden` (e.g. a rep opening a manager-only report).
 * The data is protected and the UI degrades to an empty widget, so it is not a
 * bug worth paging on.
 *
 * Deliberately NARROW — only `P0001 forbidden`. We do NOT suppress:
 *   - `42501 "permission denied for table X"`: that is a FORGOTTEN `GRANT` in a
 *     migration (a recurring deploy bug in this repo), which must stay visible.
 *     (An RLS row-read denial returns zero rows, not 42501, so 42501 is never
 *     the "expected" case.)
 *   - `P0001 not_authenticated`: for a query on an authed screen that means the
 *     app thinks it is signed in but the token did not attach — a real bug.
 * Those still flow through and are made readable by normalizeError().
 */
export function isExpectedPermissionError(err: unknown): boolean {
  return isSupabaseError(err) && err.code === "P0001" && /\bforbidden\b/i.test(err.message);
}

/**
 * Make an error readable for Sentry. A Supabase error object becomes an Error
 * titled "[code] message" (so Sentry groups it) with the raw fields moved to
 * `extra`. Everything else passes through untouched.
 */
export function normalizeError(err: unknown): { error: unknown; extra?: Record<string, unknown> } {
  if (isSupabaseError(err)) {
    const error = new Error(`[${err.code}] ${err.message}`);
    error.name = "SupabaseError";
    return {
      error,
      extra: {
        supabase_code: err.code,
        supabase_details: err.details ?? null,
        supabase_hint: err.hint ?? null,
      },
    };
  }
  return { error: err };
}

/** Minimal shape of a Sentry event we mutate in beforeSend. Kept structural so
 *  it accepts the real Sentry ErrorEvent and a test fixture alike. */
export interface SentryEventLike {
  exception?: { values?: Array<{ type?: string; value?: string }> };
  extra?: Record<string, unknown>;
}

/**
 * Normalize a Sentry event whose ORIGINAL exception is a raw Supabase error
 * object that reached Sentry OUTSIDE our captureException wrapper.
 *
 * When a raw {code,message,details,hint} object rejects unhandled, Sentry's
 * global handlers capture it and synthesize the useless "Object captured as
 * exception with keys: code, details, hint, message" event (NAVIGATR-APP-7).
 * captureException never runs for that path, so normalizeError never sees it.
 * beforeSend, however, runs for EVERY event and receives the original throwable
 * via `hint.originalException`, so this rewrites the synthesized event in place
 * into a readable, groupable SupabaseError, or signals to drop it (authz working
 * as designed, matching the wrapper's suppression).
 *
 * No-op (drop:false, event untouched) when `originalException` is not a RAW
 * Supabase object, in particular an Error the wrapper already normalized
 * (isSupabaseError rejects Error instances), so the wrapper path is never
 * double-processed.
 */
export function normalizeSupabaseSentryEvent(
  event: SentryEventLike,
  originalException: unknown,
): { drop: boolean } {
  if (!isSupabaseError(originalException)) return { drop: false };
  if (isExpectedPermissionError(originalException)) return { drop: true };

  const readable = `[${originalException.code}] ${originalException.message}`;
  const values = event.exception?.values;
  if (values && values.length > 0) {
    values[0].type = "SupabaseError";
    values[0].value = readable;
  } else {
    // Exception-less synthesized event (rare): fabricate one so the title is
    // readable rather than silently staying "Object captured...".
    event.exception = { values: [{ type: "SupabaseError", value: readable }] };
  }
  // Deliberately set NO fingerprint. Sentry groups by the rewritten type +
  // value ("SupabaseError: [code] message"), which redactPii scrubs before the
  // event ships. Keying a fingerprint on the raw message would (a) ship that
  // message UNREDACTED, since redactPii historically did not walk fingerprint,
  // and (b) fragment on Postgres errors that interpolate a value (e.g. 22P02
  // "invalid input syntax for type uuid: <value>"). Value-grouping avoids both:
  // it groups on the scrubbed message and matches how the captureException
  // wrapper path (normalizeError) already groups the caught case.
  event.extra = {
    ...(event.extra ?? {}),
    supabase_code: originalException.code,
    supabase_details: originalException.details ?? null,
    supabase_hint: originalException.hint ?? null,
  };
  return { drop: false };
}
