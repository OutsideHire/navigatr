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
 * WHAT THE DEADLINE DOES AND DOES NOT DO. Aborting ends ONE attempt: auth-js
 * wraps the abort as AuthRetryableFetchError, keeps the stored session, and
 * its OWN existing backoff tries again on a fresh connection (no retry is
 * added here). It does NOT release the lock early. _refreshAccessToken's
 * retry loop runs inside the lock, retrying while the next send would still
 * fall within 30s of the first, so with this deadline a fully stalled link
 * sends at about 0s, 8.2s, 16.6s and 25.4s and holds the lock for up to about
 * 33s before auth-js gives up retryably and releases it. What the deadline
 * buys is that the hold is BOUNDED (it was unbounded: a dead socket could
 * hold it for minutes) and that each retry uses a fresh connection, which is
 * usually what a resumed device needs. Waiting out that window without
 * bouncing the rep is the job of the store's provisional hold.
 *
 * 8s is under Supabase's 10s refresh_token_reuse_interval, which covers the
 * FIRST retry only: if the server rotated the token on the first send but
 * its answer was lost, the retry at about 8.2s reuses the old token inside
 * the window and gets the same new session back. Later retries fall outside
 * that window; they only matter when the first retry also got no answer.
 *
 * The deadline also covers reading the (small) response body, so a stall
 * after the headers is bounded the same way.
 */
export const AUTH_REFRESH_TIMEOUT_MS = 8000;

function isRefreshTokenRequest(url: string): boolean {
  return url.includes(`${AUTH_PATH}token`) && url.includes("grant_type=refresh_token");
}

/** Statuses whose Response may not carry a body (the constructor throws). */
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

function abortError(): DOMException {
  return new DOMException("The auth request took too long and was aborted.", "AbortError");
}

/** Run one auth request with an abort deadline that covers the headers AND
 *  the body. The body is read here (it is a small token payload) and handed
 *  back as a fresh Response with the same status and headers. Only used when
 *  the caller brought no signal of its own, so we never override someone
 *  else's. */
async function withDeadline(
  base: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  // A real fetch errors its body stream on abort; a body stuck in some other
  // layer might not, so race the read against the abort as well.
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
  aborted.catch(() => undefined);
  try {
    const res = await Promise.race([base(input, { ...init, signal: controller.signal }), aborted]);
    const body = await Promise.race([res.text(), aborted]);
    return new Response(NULL_BODY_STATUS.has(res.status) ? null : body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
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
