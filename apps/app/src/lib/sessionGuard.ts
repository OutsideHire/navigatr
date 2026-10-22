/**
 * sessionGuard: repair a request that is about to go out WITHOUT the rep's token.
 *
 * THE BUG THIS EXISTS FOR (production, 2026-09). supabase-js never fails a query
 * for lack of a session. It silently substitutes the publishable key:
 *
 *   return data.session?.access_token ?? this.supabaseKey
 *
 * PostgREST then runs the request as role `anon`, and migration
 * 20260813000002 revoked everything from `anon`, so the rep gets
 * "42501 permission denied for table <whatever that screen queried first>".
 * Three screens, three different tables, one cause. Meanwhile nothing tells the
 * app: no SIGNED_OUT event fires, so the auth store keeps its `user`,
 * ProtectedRoute never bounces, and the rep just sees a screen that will not
 * load. The window opens when the access token expires while the phone sleeps,
 * which is why it hits field reps mid-day.
 *
 * WHY HERE. This is the one place the substitution happens, so a single wrapper
 * covers every `.from()`, `.rpc()`, `.functions.invoke()` and storage call
 * without touching a single feature hook.
 *
 * WHY IT CANNOT CAUSE A REQUEST STORM. It issues NO additional requests. It
 * inspects a request that is already leaving and, at most, rewrites one header
 * before it goes. There is no replay, no retry and no backoff here, so it
 * cannot override `useMerchants`' `retry: 0` (the guard that stopped the
 * 2026-09-10 Places quota outage) or add any request volume of its own.
 * Recovery itself is single-flight in the auth store.
 */

/** Auth endpoints must NEVER be intercepted. Sign-in, the PKCE exchange and the
 *  token refresh legitimately travel with only the anon key, and recovery calls
 *  them itself: intercepting would recurse, or deadlock waiting on the very
 *  request that would fix it. */
const AUTH_PATH = "/auth/v1/";

/**
 * Ceiling on the refresh-token request. THE ROOT CAUSE of the 2026-10
 * "Session recovery failed ... reason=timeout" events: auth-js sends this
 * request with NO timeout and sends it while HOLDING the auth lock
 * (GoTrueClient _callRefreshToken under _acquireLock). getSession and
 * refreshSession queue behind that lock (the in-tab pendingInLock queue has no
 * timeout at all), so one stalled refresh, typically a dead socket after the
 * device slept, froze every auth read in the tab while the device reported
 * itself online.
 *
 * Aborting turns the stall into the same thing a dropped connection produces:
 * auth-js wraps it as AuthRetryableFetchError, releases the lock, and its OWN
 * existing backoff tries again on a fresh connection. This adds no retry.
 *
 * 8s, deliberately under Supabase's 10s refresh_token_reuse_interval: if the
 * server rotated the token but its answer was lost, the next attempt reuses
 * the old token and, inside that window, gets the same new session back
 * instead of having the whole token family revoked (which signs the rep out).
 */
export const AUTH_REFRESH_TIMEOUT_MS = 8000;

function isRefreshTokenRequest(url: string): boolean {
  return url.includes(`${AUTH_PATH}token`) && url.includes("grant_type=refresh_token");
}

/** Run one auth request with an abort deadline. Only used when the caller
 *  brought no signal of its own, so we never override someone else's. */
async function withDeadline(
  base: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await base(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** A PostgREST TABLE request (not an RPC). `anon` holds no table grants
 *  (migration 20260813000002), so one sent with only the publishable key can
 *  only ever come back 42501. RPCs are excluded: some are callable without a
 *  session on purpose. */
function isTableRequest(url: string): boolean {
  return url.includes("/rest/v1/") && !url.includes("/rest/v1/rpc/");
}

export interface SessionGuardHooks {
  /** Recover the session. MUST be single-flight: many callers, one attempt. */
  recover: () => Promise<boolean>;
  /** The access token after a successful recovery, or null. */
  getAccessToken: () => Promise<string | null>;
  /** True when the APP believes a user is signed in, whatever storage says.
   *  Optional so an older registration keeps working unchanged. */
  believesSignedIn?: () => boolean;
  /** True for a short while after the app observed a definitive sign-out.
   *  Queries that were already waiting on the token resolve AFTER the session
   *  is gone and would otherwise leave as anon (prod 2026-10-22, three 42501s
   *  in the second after a rep was sent to /login). */
  refuseAnonTableRequests?: () => boolean;
}

let hooks: SessionGuardHooks | null = null;

/** Wired by the auth store at import time. Until it is, the guard passes every
 *  request straight through, so the app behaves exactly as it does today. */
export function setSessionGuardHooks(next: SessionGuardHooks | null): void {
  hooks = next;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** A session row in storage means the rep IS signed in as far as the app is
 *  concerned. Distinguishes "token failed to attach" (recoverable, the bug)
 *  from "genuinely signed out" (leave alone: no session to repair). */
function hasPersistedSession(storageKey: string): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    return typeof raw === "string" && raw.length > 0;
  } catch {
    // Blocked storage (private mode, embedded webview) reads as not persisted.
    return false;
  }
}

export function createSessionGuardFetch(config: {
  anonKey: string;
  storageKey: string;
  baseFetch?: typeof fetch;
}): typeof fetch {
  const base = config.baseFetch ?? globalThis.fetch.bind(globalThis);

  return async function sessionGuardFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = urlOf(input);
    if (url.includes(AUTH_PATH)) {
      if (isRefreshTokenRequest(url) && !init?.signal) {
        return withDeadline(base, input, init, AUTH_REFRESH_TIMEOUT_MS);
      }
      return base(input, init);
    }

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    // The signature of the bug: the SDK fell back to the publishable key.
    if (headers.get("Authorization") !== `Bearer ${config.anonKey}`) {
      return base(input, init);
    }
    if (!hooks) return base(input, init);
    // No stored session USUALLY means a genuine signed-out request (the login
    // screen, a public read), and there is nothing to repair.
    //
    // But storage is not the only word on the subject, and trusting it alone
    // was a hole: this early return sent a known-anon request straight to the
    // wire in two states where the rep is in fact signed in.
    //   1. A non-retryable refresh failure makes the SDK delete the storage row
    //      BEFORE the app hears about it. SIGNED_OUT only arrives on a later
    //      tick, so queries already in flight left as anon.
    //   2. A WebKit PWA can fail the storage read on resume while the session
    //      is alive (the same ITP timing that caused the original mobile
    //      logout bug), and no auth event fires at all.
    // In both, the app is still rendering a signed-in rep. Ask it, and if it
    // says someone is signed in, treat the request as repairable.
    if (!hasPersistedSession(config.storageKey) && !hooks.believesSignedIn?.()) {
      // Signed out. If that just happened, a table request still carrying the
      // publishable key is a query that was waiting on the token when the
      // session ended. It can only be refused (anon has no table grants), so
      // refuse it here instead of on the wire. AbortError is what a cancelled
      // request already looks like to every caller and to the Sentry filter.
      if (isTableRequest(url) && hooks.refuseAnonTableRequests?.()) {
        throw new DOMException("Signed out; request not sent", "AbortError");
      }
      return base(input, init);
    }

    const recovered = await hooks.recover();
    if (!recovered) return base(input, init);

    const token = await hooks.getAccessToken();
    if (!token || token === config.anonKey) return base(input, init);

    headers.set("Authorization", `Bearer ${token}`);
    return input instanceof Request
      ? base(new Request(input, { headers }))
      : base(input, { ...init, headers });
  };
}
