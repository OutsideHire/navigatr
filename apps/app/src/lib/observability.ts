/**
 * observability.ts — thin wrapper around Sentry.
 *
 * Why a wrapper instead of `import * as Sentry from "@sentry/react"` at call
 * sites:
 *   1. Sentry is OFF by default (no DSN = no init). The wrapper makes that
 *      a one-line check in one file, not scattered guards everywhere.
 *   2. Tests don't need to mock the whole Sentry SDK — they get a no-op.
 *   3. If we ever swap providers (Highlight, BetterStack, etc.), the call
 *      sites stay the same.
 *
 * Reads:
 *   - VITE_SENTRY_DSN   : if absent, Sentry stays uninitialized.
 *   - VITE_SENTRY_ENVIRONMENT : 'production' | 'staging' | 'dev' (default 'dev')
 *   - VITE_RELEASE      : usually set by CI (git SHA). Optional.
 *
 * Sample rates are conservative (trace 10%, replay 0%) for v1. We're not
 * chasing performance traces yet — we're chasing "did something break and
 * did anyone notice."
 */
import * as Sentry from "@sentry/react";
import {
  IGNORED_ERROR_PATTERNS,
  isExpectedPermissionError,
  normalizeError,
  normalizeSupabaseSentryEvent,
} from "./errorFilter";

let initialized = false;

export function initObservability(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    // No DSN = local dev or DSN not yet provisioned. Stay quiet; don't
    // crash, don't log scary warnings. The frontend works fine without it.
    return;
  }
  if (initialized) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? "dev",
    release: import.meta.env.VITE_RELEASE,
    // 10% trace sample — enough to spot N+1s and slow renders without
    // burning quota at scale.
    tracesSampleRate: 0.1,
    // Replays default OFF. They're storage-heavy and need a separate
    // privacy review (PII masking) before we turn them on for an ISO.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    // Drop noisy errors that aren't actionable.
    ignoreErrors: [
      // User cancelled a network request (route change mid-flight).
      "AbortError",
      // ResizeObserver loop warnings — benign browser noise.
      "ResizeObserver loop completed with undelivered notifications",
      "ResizeObserver loop limit exceeded",
      // Third-party / environmental noise (browser extensions, PWA
      // service-worker update churn, stale-tab-after-deploy chunk loads,
      // transient auth-lock contention). See errorFilter.ts.
      ...IGNORED_ERROR_PATTERNS,
    ],
    // Strip tokens AND user PII (emails, phone numbers) from every part
    // of the event before it leaves the browser. Sentry events are shared
    // across the dev team + retained by Sentry; an email or phone in an
    // error payload is a privacy leak any audit will flag.
    beforeSend(event, hint) {
      // Normalize a RAW Supabase error that reached Sentry OUTSIDE our
      // captureException wrapper (an unhandled promise rejection captured by
      // Sentry's global handlers). Without this it logs as the useless "Object
      // captured as exception with keys: code, details, hint, message"
      // (NAVIGATR-APP-7). Runs BEFORE redactPii so the raw details/hint it moves
      // into event.extra get PII-scrubbed. No-op for errors the wrapper already
      // normalized (their originalException is an Error, not a raw object).
      const { drop } = normalizeSupabaseSentryEvent(event, hint?.originalException);
      if (drop) return null;
      if (event.request?.url) {
        event.request.url = stripTokensFromUrl(event.request.url);
      }
      return redactPii(event);
    },
  });
  initialized = true;
}

/**
 * Attach the current user to outgoing Sentry events. Call after sign-in;
 * call with null on sign-out so subsequent errors aren't tagged with a
 * stale user.
 *
 * No PII beyond the auth user id. We do NOT send email or name — Sentry
 * accounts can be shared across the team, and a leaked invite email is
 * not great. `orgId` is optional and useful for correlating "is this an
 * ISO-wide outage or just this one rep" — pass it whenever the caller
 * has it loaded.
 */
export function setUser(user: { id: string; orgId?: string } | null): void {
  if (!initialized) return;
  if (user) {
    Sentry.setUser({ id: user.id });
    if (user.orgId) Sentry.setTag("org_id", user.orgId);
  } else {
    Sentry.setUser(null);
    Sentry.setTag("org_id", undefined);
  }
}

/**
 * Capture an explicit exception. Use for caught errors that shouldn't
 * propagate (background tasks, fire-and-forget mutations).
 *
 * No-op when Sentry isn't initialized — caller doesn't need to guard.
 */
export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  if (!initialized) return;
  // Authz working as designed (a user hit a report RLS/an RPC gate forbids) is
  // not a bug — the data is protected and the UI degrades to an empty widget.
  if (isExpectedPermissionError(err)) return;
  // A raw Supabase error object would log as the useless "Object captured as
  // exception with keys: code, details, hint, message" — normalize it to a
  // readable, groupable Error and move the raw fields to extra.
  const { error, extra } = normalizeError(err);
  const merged = { ...(extra ?? {}), ...(context ?? {}) };
  Sentry.captureException(
    error,
    Object.keys(merged).length > 0 ? { extra: merged } : undefined,
  );
}

/**
 * react-query cache error reporter. Returns an onError handler that reports a
 * non-offline cache error to Sentry, tagged by `source`. Shared by both the
 * QueryCache and the MutationCache in main.tsx so read AND write failures are
 * visible (a silently-failing mutation otherwise only toasts). Offline errors
 * are skipped — they are expected and noisy. captureException still drops
 * authz-working-as-designed and normalizes Supabase errors.
 */
export function reportCacheError(
  source: "react-query" | "react-query-mutation",
): (error: unknown) => void {
  return (error: unknown) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    captureException(error, { source });
  };
}

/**
 * Capture a non-Error event (e.g., a fetch returned 500 with no thrown
 * exception). Use sparingly — every captureMessage counts against quota.
 */
export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
): void {
  if (!initialized) return;
  Sentry.captureMessage(message, level);
}

// --- helpers ----------------------------------------------------------------

/**
 * Remove auth-ish tokens from URL query strings before they ship to Sentry.
 * Conservative regex: any param ending in 'token', 'key', or 'code' gets
 * redacted. We'd rather lose a useful debug hint than leak a long-lived
 * invite token in a Sentry breadcrumb.
 */
function stripTokensFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const REDACT_KEYS = /(^|_)(token|key|code|secret)$/i;
    u.searchParams.forEach((_value, key) => {
      if (REDACT_KEYS.test(key)) {
        u.searchParams.set(key, "[redacted]");
      }
    });
    return u.toString();
  } catch {
    // Not a parseable URL (could be a relative path). Best-effort redact.
    return url.replace(/([?&](?:[^=&]*(?:token|key|code|secret)[^=&]*)=)[^&]+/gi, "$1[redacted]");
  }
}

// ---------------------------------------------------------------------------
// PII redaction
// ---------------------------------------------------------------------------
//
// Sentry events carry strings that originated from anywhere — error
// messages, fetch payloads, breadcrumbs, the user's clipboard, JSX prop
// names that happened to include user data. We can't know in advance
// where PII will surface, so we walk the event structure and mask any
// string that *looks like* an email or a phone number.
//
// This is best-effort. A determined attacker who controls error content
// could craft a payload that evades these regexes. But we cover the
// 99% case: form-input bleed, RPC error messages containing the user's
// row, etc.
//
// We export the redactor for unit testing without spinning up Sentry.

// Email: anything-anything@anything.tld. Deliberately lax — better to
// over-redact than under-redact.
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

// Phone: E.164 (`+15551234567`) and common US formats. The US-formatted
// regex requires explicit separators so we don't accidentally redact
// long random integers (deal IDs, timestamps).
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}|\+\d{10,15}/g;

// Object KEYS whose value is a credential regardless of type: redact the whole
// value. Mirrors stripTokensFromUrl's REDACT_KEYS but for object properties in
// extra / contexts / breadcrumb data. This matters now that a captured error
// OBJECT flows into event.extra (extra.captured_object, supabase_details): a 401
// body or fetch error can carry an Authorization header, api key, or cookie.
// Targeted (not a bare `key`/`auth`) so it doesn't nuke benign fields like
// `primaryKey`; over-redaction here only costs a debug hint, never correctness.
const SENSITIVE_KEY_RE = /(authorization|password|passwd|secret|cookie|token|api[-_]?key)/i;

export function redactString(input: string): string {
  return input.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
}

/**
 * Walk an arbitrary value and redact strings. Mutates structurally —
 * objects/arrays are visited in-place. Non-string scalars (numbers,
 * booleans, null, undefined) pass through untouched. Circular refs
 * are guarded by a WeakSet so we don't loop forever on Sentry's
 * event objects (which sometimes self-reference).
 */
function redactDeep(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = redactDeep(value[i], seen);
    }
    return value;
  }

  // Plain object: redact each enumerable property in place. A property whose
  // KEY names a credential is masked wholesale (any type); everything else
  // recurses so nested strings still get email/phone scrubbing.
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    obj[key] = SENSITIVE_KEY_RE.test(key) ? "[redacted]" : redactDeep(obj[key], seen);
  }
  return obj;
}

/**
 * Walk a Sentry event and redact PII from the surfaces most likely to
 * contain it. Returns the (mutated) event so beforeSend can return it
 * directly.
 *
 * Surfaces covered:
 *   - event.message            (raw captureMessage string)
 *   - event.exception.values[].value  (error message text)
 *   - event.breadcrumbs[].message + .data
 *   - event.extra              (anything passed via captureException context)
 *   - event.contexts           (Sentry-managed but sometimes echoes input)
 *   - event.request.data       (POST body if Sentry captures one)
 *   - event.fingerprint        (custom grouping keys; scrubbed so a future
 *                               fingerprint built from error text can't leak PII)
 *
 * NOT covered:
 *   - event.user               (we only set { id } — no PII expected)
 *   - event.tags               (we control these; org_id is opaque)
 *   - event.request.url        (already handled by stripTokensFromUrl above)
 *
 * Typed loosely so it accepts both the unit-test fixture shape AND the
 * Sentry ErrorEvent (which has many optional + heterogeneous fields).
 * We cast through `unknown` at call sites where needed.
 */
export function redactPii<T>(event: T): T {
  if (!event || typeof event !== "object") return event;
  const e = event as Record<string, unknown>;
  const seen = new WeakSet<object>();

  if (typeof e.message === "string") {
    e.message = redactString(e.message);
  }
  if (e.exception && typeof e.exception === "object") {
    redactDeep(e.exception, seen);
  }
  if (Array.isArray(e.breadcrumbs)) {
    redactDeep(e.breadcrumbs, seen);
  }
  if (e.extra && typeof e.extra === "object") {
    redactDeep(e.extra, seen);
  }
  if (e.contexts && typeof e.contexts === "object") {
    redactDeep(e.contexts, seen);
  }
  const req = e.request as { data?: unknown; url?: unknown } | undefined;
  if (req?.data) {
    req.data = redactDeep(req.data, seen);
  }
  if (Array.isArray(e.fingerprint)) {
    redactDeep(e.fingerprint, seen);
  }

  return event;
}
