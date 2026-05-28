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
    ],
    // Strip access tokens from URLs before they hit Sentry.
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = stripTokensFromUrl(event.request.url);
      }
      return event;
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
  Sentry.captureException(err, context ? { extra: context } : undefined);
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
