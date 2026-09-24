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

export interface SessionGuardHooks {
  /** Recover the session. MUST be single-flight: many callers, one attempt. */
  recover: () => Promise<boolean>;
  /** The access token after a successful recovery, or null. */
  getAccessToken: () => Promise<string | null>;
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
    if (urlOf(input).includes(AUTH_PATH)) return base(input, init);

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    // The signature of the bug: the SDK fell back to the publishable key.
    if (headers.get("Authorization") !== `Bearer ${config.anonKey}`) {
      return base(input, init);
    }
    // No stored session means this is a genuine signed-out request (the login
    // screen, a public read). Nothing to repair.
    if (!hasPersistedSession(config.storageKey)) return base(input, init);
    if (!hooks) return base(input, init);

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
