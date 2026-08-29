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
 * A Supabase error that is authz working as designed: the caller asked for
 * something an RLS policy or an RPC gate forbids. The data is protected and the
 * UI degrades to an empty widget, so it is not a bug worth paging on.
 *   - 42501: Postgres insufficient_privilege (a blocked table read)
 *   - P0001 + forbidden / not_authenticated: our RPC gates' raised message
 */
export function isExpectedPermissionError(err: unknown): boolean {
  if (!isSupabaseError(err)) return false;
  if (err.code === "42501") return true;
  return err.code === "P0001" && /\b(forbidden|not_authenticated)\b/i.test(err.message);
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
